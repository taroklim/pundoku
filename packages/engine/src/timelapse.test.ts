import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_GAP_MS,
  appendMove,
  createMoveLog,
  dailyPuzzle,
  heatmap,
  timelapseFingerprint,
  timelapseFrames,
} from "./index.js";
import type { Digit, Move, MoveLog } from "./index.js";

/** r1c1..r1c3 пустые (решение 1,2,3), остальное — подсказки. */
const MISSION = "000456789" + "1".repeat(72);
const SOLUTION = "123456789" + "1".repeat(72);
const puzzle = { mission: MISSION, solution: SOLUTION };

const place = (t: number, cell: number, digit: Digit, extra: Partial<Move> = {}): Move => ({ t, cell, kind: "place", digit, ...extra });
const erase = (t: number, cell: number): Move => ({ t, cell, kind: "erase" });
const undo = (t: number, cell = 0): Move => ({ t, cell, kind: "undo" });
const noteAdd = (t: number, cell: number, digit: Digit): Move => ({ t, cell, kind: "note_add", digit });
const noteRemove = (t: number, cell: number, digit: Digit): Move => ({ t, cell, kind: "note_remove", digit });

const head = (values: readonly number[]): number[] => values.slice(0, 3);

describe("timelapseFrames — basic", () => {
  it("empty log: one initial frame, zero duration", () => {
    const r = timelapseFrames([], puzzle);
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0]).toMatchObject({ t: 0, move: -1, cell: null, kind: null, wrong: [] });
    expect(r.frames[0]!.values).toHaveLength(81);
    expect(head(r.frames[0]!.values)).toEqual([0, 0, 0]);
    expect(r.frames[0]!.values[3]).toBe(4); // подсказки видны с первого кадра
    expect(r.durationMs).toBe(0);
    expect(r.sourceDurationMs).toBe(0);
  });

  it("a single move", () => {
    const r = timelapseFrames([place(1500, 0, 1)], puzzle);
    expect(r.frames.map((f) => f.t)).toEqual([0, 1500]);
    expect(head(r.frames[1]!.values)).toEqual([1, 0, 0]);
    expect(r.frames[1]).toMatchObject({ move: 0, cell: 0, kind: "place" });
    expect(r.durationMs).toBe(1500);
  });

  it("one frame per visible move; final frame equals the solution", () => {
    const log: MoveLog = [place(1000, 0, 1), place(2500, 1, 2), place(4000, 2, 3)];
    const r = timelapseFrames(log, puzzle);
    expect(r.frames).toHaveLength(4);
    expect(r.frames.at(-1)!.values.join("")).toBe(SOLUTION);
    expect(r.frames.at(-1)!.wrong).toEqual([]);
  });

  it("frames are plain JSON data", () => {
    const r = timelapseFrames([place(0, 0, 1), noteAdd(10, 1, 4)], puzzle, { notes: true });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("is deterministic and does not mutate the log", () => {
    const log: MoveLog = Object.freeze([place(0, 0, 1), erase(9000, 0), undo(9500), place(20000, 1, 2)]);
    const a = timelapseFrames(log, puzzle, { durationMs: 8000, notes: true });
    const b = timelapseFrames(log, puzzle, { durationMs: 8000, notes: true });
    expect(b).toEqual(a);
  });
});

describe("timelapseFrames — undo / erase / wrong digits", () => {
  it("wrong digits appear in frames and in `wrong`; correction clears them", () => {
    const log: MoveLog = [place(0, 0, 5, { correct: false }), place(1000, 0, 1, { correct: true })];
    const r = timelapseFrames(log, puzzle);
    expect(head(r.frames[1]!.values)).toEqual([5, 0, 0]);
    expect(r.frames[1]!.wrong).toEqual([0]);
    expect(head(r.frames[2]!.values)).toEqual([1, 0, 0]);
    expect(r.frames[2]!.wrong).toEqual([]);
  });

  it("correctness falls back to the solution when the move is not annotated", () => {
    const r = timelapseFrames([place(0, 0, 5)], puzzle);
    expect(r.frames[1]!.wrong).toEqual([0]);
    expect(timelapseFrames([place(0, 0, 5)], { mission: MISSION }).frames[1]!.wrong).toEqual([]);
  });

  it("erase empties the cell", () => {
    const r = timelapseFrames([place(0, 0, 1), erase(500, 0)], puzzle);
    expect(head(r.frames[2]!.values)).toEqual([0, 0, 0]);
  });

  it("undo of a place restores the previous digit (overwrite chain)", () => {
    const log: MoveLog = [place(0, 0, 5, { correct: false }), place(100, 0, 1, { correct: true }), undo(200)];
    const r = timelapseFrames(log, puzzle);
    expect(head(r.frames[3]!.values)).toEqual([5, 0, 0]);
    expect(r.frames[3]!.wrong).toEqual([0]); // вернулась и неверность
    expect(r.frames[3]).toMatchObject({ kind: "undo", cell: 0 });
  });

  it("undo of an erase brings the digit back; two undos go deeper", () => {
    const log: MoveLog = [place(0, 0, 1), erase(100, 0), undo(200), undo(300)];
    const r = timelapseFrames(log, puzzle);
    expect(head(r.frames[3]!.values)).toEqual([1, 0, 0]);
    expect(head(r.frames[4]!.values)).toEqual([0, 0, 0]);
  });

  it("undo targets the stack top, not the move's own cell field", () => {
    const log: MoveLog = [place(0, 0, 1), place(100, 1, 2), undo(200, 0)];
    const r = timelapseFrames(log, puzzle);
    expect(head(r.frames[3]!.values)).toEqual([1, 0, 0]);
    expect(r.frames[3]!.cell).toBe(1);
  });

  it("no-op moves (undo on empty stack, erase of empty cell, moves on givens) produce no frame but keep time", () => {
    const log: MoveLog = [undo(100), erase(200, 1), place(300, 5, 1), place(400, 0, 1)];
    const r = timelapseFrames(log, puzzle);
    expect(r.frames).toHaveLength(2);
    expect(r.frames[1]!.move).toBe(3);
    expect(r.durationMs).toBe(400);
  });

  it("a given-cell move still occupies an undo stack slot (engine parity)", () => {
    // место в стеке занято → undo откатывает «ход в подсказке» (ничего не меняя), а не постановку
    const log: MoveLog = [place(0, 0, 1), place(100, 5, 1), undo(200)];
    const r = timelapseFrames(log, puzzle);
    expect(r.frames).toHaveLength(2);
    expect(head(r.frames.at(-1)!.values)).toEqual([1, 0, 0]);
  });

  it("final frame matches the engine's replay semantics on a messy log", () => {
    const log: MoveLog = [
      place(0, 0, 1, { correct: true }),
      place(1000, 1, 9, { correct: false }),
      erase(2000, 1),
      undo(2500), // возвращает 9
      place(3000, 1, 2, { correct: true }),
      place(4000, 2, 3, { correct: true }),
      erase(5000, 2),
      place(6000, 2, 3, { correct: true }),
    ];
    const h = heatmap(log, { mission: MISSION });
    const last = timelapseFrames(log, puzzle).frames.at(-1)!;
    expect(last.values.join("")).toBe(SOLUTION);
    // клетки, заполненные верно, — ровно те же, что у тепловой карты
    [0, 1, 2].forEach((c) => expect(h[c] !== null).toBe(last.values[c] === Number(SOLUTION[c])));
  });
});

describe("timelapseFrames — notes", () => {
  const log: MoveLog = [noteAdd(0, 0, 1), noteAdd(100, 0, 2), noteRemove(200, 0, 1), place(300, 0, 1), undo(400)];

  it("notes are off by default: no frames for note moves, no `notes` field", () => {
    const r = timelapseFrames(log, puzzle);
    expect(r.frames.every((f) => f.notes === undefined)).toBe(true);
    // кадры: начальный, place, undo(place)
    expect(r.frames.map((f) => f.move)).toEqual([-1, 3, 4]);
  });

  it("with notes: add / remove / place clears / undo restores", () => {
    const r = timelapseFrames(log, puzzle, { notes: true });
    const masks = r.frames.map((f) => f.notes![0]);
    expect(masks).toEqual([0, 1 << 1, (1 << 1) | (1 << 2), 1 << 2, 0, 1 << 2]);
    expect(head(r.frames[4]!.values)).toEqual([1, 0, 0]);
    expect(head(r.frames[5]!.values)).toEqual([0, 0, 0]);
  });

  it("notes in a cell holding a digit do not change state", () => {
    const r = timelapseFrames([place(0, 0, 1), noteAdd(10, 0, 5)], puzzle, { notes: true });
    expect(r.frames).toHaveLength(2);
  });

  it("erase clears notes, undo of the erase brings them back", () => {
    const r = timelapseFrames([noteAdd(0, 0, 3), erase(10, 0), undo(20)], puzzle, { notes: true });
    expect(r.frames.map((f) => f.notes![0])).toEqual([0, 1 << 3, 0, 1 << 3]);
  });
});

describe("timelapseFrames — time normalisation", () => {
  const log: MoveLog = [place(1000, 0, 1), place(61000, 1, 2), place(62000, 2, 3)];

  it("default: long pauses are capped at DEFAULT_MAX_GAP_MS", () => {
    const r = timelapseFrames(log, puzzle);
    expect(r.frames.map((f) => f.t)).toEqual([0, 1000, 1000 + DEFAULT_MAX_GAP_MS, 2000 + DEFAULT_MAX_GAP_MS]);
    expect(r.sourceDurationMs).toBe(62000);
    expect(r.durationMs).toBe(2000 + DEFAULT_MAX_GAP_MS);
  });

  it("the leading pause (start → first move) is capped too", () => {
    const r = timelapseFrames([place(600000, 0, 1)], puzzle, { maxGapMs: 2000 });
    expect(r.frames[1]!.t).toBe(2000);
  });

  it("maxGapMs = Infinity keeps the real time; 0 collapses all gaps", () => {
    expect(timelapseFrames(log, puzzle, { maxGapMs: Infinity }).durationMs).toBe(62000);
    expect(timelapseFrames(log, puzzle, { maxGapMs: 0 }).durationMs).toBe(0);
  });

  it("speed divides the compressed time", () => {
    const r = timelapseFrames(log, puzzle, { maxGapMs: 1000, speed: 2 });
    expect(r.frames.map((f) => f.t)).toEqual([0, 500, 1000, 1000 + 0 + 500]);
  });

  it("durationMs: last move lands exactly on the target, times are monotonic", () => {
    const r = timelapseFrames(log, puzzle, { durationMs: 10000 });
    expect(r.durationMs).toBe(10000);
    expect(r.frames.at(-1)!.t).toBe(10000);
    const ts = r.frames.map((f) => f.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("durationMs with a zero-length log spreads frames evenly over the moves", () => {
    const flat: MoveLog = [place(0, 0, 1), place(0, 1, 2), place(0, 2, 3)];
    const r = timelapseFrames(flat, { mission: MISSION });
    expect(r.durationMs).toBe(0);
    const spread = timelapseFrames(flat, { mission: MISSION }, { durationMs: 3000 });
    expect(spread.frames.map((f) => f.t)).toEqual([0, 1000, 2000, 3000]);
  });

  it("a decreasing `t` in a damaged log is read as 'not earlier than the previous move'", () => {
    const damaged: MoveLog = [place(5000, 0, 1), place(1000, 1, 2)];
    const r = timelapseFrames(damaged, puzzle);
    expect(r.frames.map((f) => f.t)).toEqual([0, 3000, 3000]);
  });

  it("time advances over no-op moves (they only occupy the timeline)", () => {
    const r = timelapseFrames([place(0, 0, 1), undo(1000), undo(2000), place(3000, 1, 2)], puzzle, { maxGapMs: Infinity });
    // второй undo — no-op (стек пуст после первого)
    expect(r.frames.map((f) => [f.move, f.t])).toEqual([[-1, 0], [0, 0], [1, 1000], [3, 3000]]);
  });

  it("validates options and cells", () => {
    expect(() => timelapseFrames([], puzzle, { speed: 0 })).toThrow(RangeError);
    expect(() => timelapseFrames([], puzzle, { speed: NaN })).toThrow(RangeError);
    expect(() => timelapseFrames([], puzzle, { durationMs: -1 })).toThrow(RangeError);
    expect(() => timelapseFrames([], puzzle, { maxGapMs: -5 })).toThrow(RangeError);
    expect(() => timelapseFrames([place(0, 81, 1)], puzzle)).toThrow(RangeError);
  });
});

describe("timelapseFingerprint", () => {
  it("order, normalised time and attempts; no digits are exposed", () => {
    const log: MoveLog = [
      place(1000, 2, 3, { correct: true }),
      place(2000, 0, 9, { correct: false }),
      place(3000, 0, 1, { correct: true }),
      place(63000, 1, 2, { correct: true }), // пауза 60 с → сожмётся
    ];
    const f = timelapseFingerprint(log, puzzle, { maxGapMs: 3000 });
    expect(f.placed).toBe(3);
    expect(f.cells).toHaveLength(81);
    expect(f.cells[3]).toBeNull();
    // сжатое время: 1000, 2000, 3000, 6000 → /6000
    expect(f.cells[2]).toEqual({ order: 0, t: 1000 / 6000, attempts: 1 });
    expect(f.cells[0]).toEqual({ order: 1, t: 3000 / 6000, attempts: 2 });
    expect(f.cells[1]).toEqual({ order: 2, t: 1, attempts: 1 });
    expect(JSON.stringify(f)).not.toContain("digit");
  });

  it("wrong or empty at the end → null; undo restores the earlier placement", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), place(100, 0, 9, { correct: false }), place(200, 1, 2), undo(300), undo(400)];
    // undo(300) снимает place(1,2); undo(400) — перезапись 9 → обратно 1
    const f = timelapseFingerprint(log, puzzle);
    expect(f.cells[0]).toMatchObject({ order: 0, t: 0, attempts: 2 });
    expect(f.cells[1]).toBeNull();
    expect(f.placed).toBe(1);
  });

  it("empty log and all-zero times", () => {
    expect(timelapseFingerprint([], puzzle)).toEqual({ cells: new Array(81).fill(null), placed: 0 });
    const f = timelapseFingerprint([place(0, 0, 1), place(0, 1, 2)], puzzle);
    expect(f.cells[1]).toMatchObject({ order: 1, t: 0 });
  });

  it("placed cells agree with heatmap non-null cells", () => {
    const log: MoveLog = [place(0, 0, 1), place(10, 1, 7), erase(20, 1), place(30, 1, 2), place(40, 2, 9)];
    const h = heatmap(log, puzzle);
    const f = timelapseFingerprint(log, puzzle);
    f.cells.forEach((c, i) => expect(c !== null).toBe(h[i] !== null));
  });
});

describe("timelapse on real engine puzzles", () => {
  /** Игрок: решает сетку по порядку движка, иногда ошибается и стирает, ставит заметки, отменяет. */
  function playthrough(mission: string, solution: string, seed: number): MoveLog {
    let s = seed;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    let log: MoveLog = createMoveLog();
    let t = 0;
    const tick = (base: number): number => (t += Math.round(base * (0.3 + rnd() * 2)));
    const empty = [...mission].map((g, i) => (g === "0" ? i : -1)).filter((i) => i >= 0);
    for (const cell of empty) {
      if (rnd() < 0.3) log = appendMove(log, noteAdd(tick(800), cell, ((1 + Math.floor(rnd() * 9)) as Digit)));
      if (rnd() < 0.15) {
        const wrong = (((Number(solution[cell]) % 9) + 1) as Digit);
        log = appendMove(log, place(tick(1500), cell, wrong, { correct: false }));
        log = appendMove(log, rnd() < 0.5 ? erase(tick(900), cell) : undo(tick(900), cell));
      }
      if (rnd() < 0.03) t += 120000; // долгая пауза
      log = appendMove(log, place(tick(2500), cell, Number(solution[cell]) as Digit, { correct: true }));
    }
    return log;
  }

  it.each(["easy", "medium", "hard"] as const)("%s: final frame == solution, monotonic time, fingerprint complete", (difficulty) => {
    const p = dailyPuzzle("2026-09-30", difficulty);
    const log = playthrough(p.mission, p.solution, difficulty.length * 7919);
    const r = timelapseFrames(log, p, { notes: true, durationMs: 20000 });
    expect(r.frames.at(-1)!.values.join("")).toBe(p.solution);
    expect(r.frames.at(-1)!.wrong).toEqual([]);
    expect(r.durationMs).toBe(20000);
    for (let i = 1; i < r.frames.length; i++) expect(r.frames[i]!.t).toBeGreaterThanOrEqual(r.frames[i - 1]!.t);
    const empties = [...p.mission].filter((g) => g === "0").length;
    const f = timelapseFingerprint(log, p);
    expect(f.placed).toBe(empties);
  });
});
