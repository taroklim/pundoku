/**
 * PD-70: замер веса лога и живая проверка таймлапса на реальных партиях движка.
 *
 *   pnpm --filter @pundoku/engine build
 *   pnpm --filter @pundoku/api exec tsx ../../packages/engine/scripts/timelapse-measure.ts [seedOffset=0]
 *
 * Берёт СОБРАННЫЙ движок (`dist`), генерирует сетки всех классов, «играет» их 4 стилями × 3 профилями
 * заметок, кодирует лог кодеком снапшота (`apps/web/src/sync/codec.ts`), меряет размеры и прогоняет
 * `timelapseFrames`/`timelapseFingerprint`: финальный кадр == решение, время монотонно, кодек не теряет ходы.
 * Игрок синтетический (ПРНГ, не настоящие люди): цифры — порядок стилей, паузы/ошибки/undo — вероятностные
 * модели; ориентир порядка величин, не статистика по людям.
 */
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  DIFFICULTIES,
  PEERS,
  appendMove,
  candidates,
  generate,
  humanSolve,
  summary,
  timelapseFingerprint,
  timelapseFrames,
  type Difficulty,
  type Digit,
  type Move,
  type MoveLog,
} from "../dist/index.js";
import { decodeMoveLog, encodeMoveLog } from "../../../apps/web/src/sync/codec.ts";

type Style = "scanner" | "blocker" | "snake" | "sniper";
type NotesProfile = "none" | "light" | "heavy";
const STYLES: Style[] = ["scanner", "blocker", "snake", "sniper"];
const NOTES: NotesProfile[] = ["none", "light", "heavy"];

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function order(style: Style, mission: string, solution: string): number[] {
  const empty = [...mission].map((g, i) => (g === "0" ? i : -1)).filter((i) => i >= 0);
  const row = (c: number) => Math.floor(c / 9);
  const col = (c: number) => c % 9;
  const box = (c: number) => Math.floor(row(c) / 3) * 3 + Math.floor(col(c) / 3);
  switch (style) {
    case "scanner":
      return [...empty].sort((a, b) => Number(solution[a]) - Number(solution[b]) || a - b);
    case "blocker":
      return [...empty].sort((a, b) => box(a) - box(b) || a - b);
    case "snake": {
      const left = new Set(empty);
      const out: number[] = [];
      let cur = empty[0]!;
      while (left.size > 0) {
        left.delete(cur);
        out.push(cur);
        let best = -1;
        let bd = 1e9;
        for (const c of left) {
          const d = Math.abs(row(c) - row(cur)) + Math.abs(col(c) - col(cur));
          if (d < bd || (d === bd && c < best)) (bd = d), (best = c);
        }
        if (best < 0) break;
        cur = best;
      }
      return out;
    }
    case "sniper": {
      const steps = humanSolve(mission).steps.filter((s) => s.cell !== undefined).map((s) => s.cell!);
      const seen = new Set<number>();
      const out: number[] = [];
      for (const c of steps) if (!seen.has(c) && mission[c] === "0") (seen.add(c), out.push(c));
      for (const c of empty) if (!seen.has(c)) out.push(c);
      return out;
    }
  }
}

function play(mission: string, solution: string, difficulty: Difficulty, style: Style, notes: NotesProfile, seed: number): MoveLog {
  const rnd = rng(seed);
  const slow = { easy: 1, medium: 1.3, hard: 1.8, expert: 2.5, master: 3 }[difficulty];
  let t = 0;
  const tick = (medianMs: number): number => {
    // логнормальный шаг; 4% — долгая пауза (звонок, отвлёкся): 40–400 с
    const z = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    t += Math.round(medianMs * Math.exp(0.6 * z));
    if (rnd() < 0.04) t += Math.round(40000 + rnd() * 360000);
    return t;
  };
  let log: MoveLog = [];
  const add = (m: Move) => void (log = appendMove(log, m));
  const values = [...mission].map(Number);
  const noteMask = new Array<number>(81).fill(0);
  const cur = () => values.join("");

  const addNote = (cell: number, d: number) => {
    if (noteMask[cell]! & (1 << d)) return;
    noteMask[cell]! |= 1 << d;
    add({ t: tick(700), cell, kind: "note_add", digit: d as Digit });
  };
  if (notes === "heavy") {
    // карандашом по всем пустым клеткам сразу: кандидаты по подсказкам
    for (let c = 0; c < 81; c++) if (values[c] === 0) for (const d of candidates(cur(), c)) addNote(c, d);
  }
  for (const cell of order(style, mission, solution)) {
    const digit = Number(solution[cell]) as Digit;
    if (notes === "light" && rnd() < 0.3) for (const d of candidates(cur(), cell)) if (rnd() < 0.8) addNote(cell, d);
    if (rnd() < 0.05 * slow) tick(8000 * slow); // задумался
    if (rnd() < 0.05 * slow) {
      const wrong = ((digit % 9) + 1) as Digit;
      add({ t: tick(2500 * slow), cell, kind: "place", digit: wrong, correct: false });
      const r = rnd();
      if (r < 0.5) add({ t: tick(1200), cell, kind: "erase" });
      else if (r < 0.8) add({ t: tick(1200), cell, kind: "undo", cell, digit: wrong });
      // иначе — сразу перезапись верной цифрой
    }
    add({ t: tick(2600 * slow), cell, kind: "place", digit, correct: true });
    noteMask[cell] = 0;
    values[cell] = digit;
    if (rnd() < 0.03) {
      add({ t: tick(1500), cell, kind: "undo", digit }); // передумал: откат верной цифры и повтор
      add({ t: tick(1800), cell, kind: "place", digit, correct: true });
    }
    if (notes === "heavy") {
      for (const p of PEERS[cell]!) if (noteMask[p]! & (1 << digit)) {
        noteMask[p]! &= ~(1 << digit);
        add({ t: tick(450), cell: p, kind: "note_remove", digit });
      }
    }
  }
  return log;
}

const b64len = (buf: Buffer): number => Math.ceil(buf.length / 3) * 4;
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

interface Row {
  difficulty: Difficulty; style: Style; notes: NotesProfile;
  moves: number; durationMin: number; raw: number; codec: number; codecNoNotes: number; gzipB64: number; brotliB64: number; frames: number;
}
const offset = Number(process.argv[2] ?? 0);
const rows: Row[] = [];
let checks = 0;
let k = 0;
for (const difficulty of DIFFICULTIES) {
  const p = generate({ difficulty, seed: `pd70-${difficulty}-${offset}` });
  for (const style of STYLES) for (const notes of NOTES) {
    const log = play(p.mission, p.solution, difficulty, style, notes, 1000 + offset * 97 + k++);
    const enc = encodeMoveLog(log);

    // --- проверки таймлапса ---
    const dec = decodeMoveLog(enc);
    if (JSON.stringify(dec) !== JSON.stringify(log)) throw new Error(`codec lost data: ${difficulty}/${style}/${notes}`);
    const tl = timelapseFrames(log, p, { notes: true, durationMs: 30000 });
    const tlPlain = timelapseFrames(dec!, { mission: p.mission }, { notes: false });
    if (tl.frames.at(-1)!.values.join("") !== p.solution) throw new Error(`final frame != solution: ${difficulty}/${style}/${notes}`);
    if (tlPlain.frames.at(-1)!.values.join("") !== p.solution) throw new Error("decoded-log final frame != solution");
    for (let i = 1; i < tl.frames.length; i++) if (tl.frames[i]!.t < tl.frames[i - 1]!.t) throw new Error("time not monotonic");
    if (tl.durationMs !== 30000) throw new Error("durationMs target missed");
    const fp = timelapseFingerprint(log, p);
    const empties = [...p.mission].filter((g) => g === "0").length;
    if (fp.placed !== empties) throw new Error("fingerprint incomplete");
    if (timelapseFrames(log, p, { notes: true, durationMs: 30000 }).frames.length !== tl.frames.length) throw new Error("nondeterministic");
    checks++;

    const noNotes = log.filter((m) => m.kind !== "note_add" && m.kind !== "note_remove");
    rows.push({
      difficulty, style, notes,
      moves: log.length,
      durationMin: summary(log).durationMs / 60000,
      raw: JSON.stringify(log).length,
      codec: enc.length,
      codecNoNotes: encodeMoveLog(noNotes).length,
      gzipB64: b64len(gzipSync(enc)),
      brotliB64: b64len(brotliCompressSync(enc)),
      frames: tl.frames.length,
    });
  }
}

const group = (name: string, rs: Row[]) =>
  console.log(
    `${name.padEnd(14)} n=${String(rs.length).padStart(2)}  moves avg ${mean(rs.map((r) => r.moves)).toFixed(0).padStart(4)}  ` +
      `codec chars avg ${mean(rs.map((r) => r.codec)).toFixed(0).padStart(5)} p95 ${pct(rs.map((r) => r.codec), 95)} max ${Math.max(...rs.map((r) => r.codec))}  ` +
      `| chars/move ${(mean(rs.map((r) => r.codec)) / mean(rs.map((r) => r.moves))).toFixed(2)}  ` +
      `| raw JSON avg ${mean(rs.map((r) => r.raw)).toFixed(0)}  | no-notes avg ${mean(rs.map((r) => r.codecNoNotes)).toFixed(0)}  ` +
      `| gzip+b64 avg ${mean(rs.map((r) => r.gzipB64)).toFixed(0)}  | brotli+b64 avg ${mean(rs.map((r) => r.brotliB64)).toFixed(0)}`,
  );
console.log(`games: ${rows.length}, all checks passed: ${checks}/${rows.length} (final frame == solution, monotonic time, codec round-trip, fingerprint, determinism)`);
group("ALL", rows);
for (const n of NOTES) group(`notes=${n}`, rows.filter((r) => r.notes === n));
for (const s of STYLES) group(`style=${s}`, rows.filter((r) => r.style === s));
for (const d of DIFFICULTIES) group(`diff=${d}`, rows.filter((r) => r.difficulty === d));
const all = rows.map((r) => r.codec);
const avg = mean(all);
console.log("\nBudget math (current codec, chars):");
console.log(`  avg game ${avg.toFixed(0)}, p95 ${pct(all, 95)}, max ${Math.max(...all)}; games over MOVE_LOG_MAX_CHARS (49152): ${all.filter((x) => x > 48 * 1024).length}`);
for (const [label, per] of [["avg", avg], ["p95", pct(all, 95)], ["light-notes avg", mean(rows.filter((r) => r.notes === "light").map((r) => r.codec))], ["heavy-notes avg", mean(rows.filter((r) => r.notes === "heavy").map((r) => r.codec))], ["no-notes avg", mean(rows.filter((r) => r.notes === "none").map((r) => r.codec))]] as const) {
  console.log(`  ${label.padEnd(16)} per game ${per.toFixed(0).padStart(5)}: days within 600 KiB budget = ${Math.floor((600 * 1024) / per)}; 365 days = ${((365 * per) / 1024).toFixed(0)} KiB; 3 years = ${((3 * 365 * per) / 1024 / 1024).toFixed(2)} MiB`);
}
const gz = mean(rows.map((r) => r.gzipB64));
console.log(`  gzip+base64 avg ${gz.toFixed(0)} (x${(gz / avg).toFixed(2)}): 365 days = ${((365 * gz) / 1024).toFixed(0)} KiB`);
const fr = mean(rows.map((r) => r.frames));
console.log(`\nframes per game avg ${fr.toFixed(0)} (with notes)`);
