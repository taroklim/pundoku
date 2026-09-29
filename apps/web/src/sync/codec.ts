/**
 * Компактные кодеки для снапшота (PD-14): лог ходов и тепловая карта дня одной строкой.
 *
 * Зачем: снапшот лежит в jsonb с лимитом 1 МиБ (413). Ход `MoveLog` в «родном» JSON — ~70–90 байт
 * (`{"t":12345,"cell":40,"kind":"place","digit":7,"correct":true,"technique":"naked_single"}`), типичная
 * партия 150–400 ходов ⇒ 10–35 КБ на день ⇒ год не влезает. В компактной форме ход — 9–13 символов
 * (≈ 3–5 КБ на партию, год ≈ 1–1,5 МиБ), поэтому `moveLog` в снапшот идёт с бюджетом (см. `schema.ts`),
 * а «вечная» часть записи дня — `heat` (81 клетка × 2 символа = 162 байта) + сводка.
 *
 * Формат лога: `1:` + ходы через `,`. Ход = `k` `cc` `d` `c` `q` `dt`:
 *   k  — вид: p place, e erase, a note_add, r note_remove, u undo;
 *   cc — клетка, base36, 2 символа (00..2h);
 *   d  — цифра 1..9, `0` — нет;
 *   c  — `1` correct=true, `0` correct=false, `-` не задано;
 *   q  — техника: индекс в `TECHNIQUES`, `-` нет;
 *   dt — приращение `t` к предыдущему ходу, мс, base36 (для первого хода — сам `t`).
 * Формат тепловой карты: 81 × 2 символа base36 (0..1295 ⇒ доля 0..1), `--` — клетка без значения (`null`).
 */
import type { Digit, Move, MoveKind, MoveLog, TechniqueOrBeyond } from "@pundoku/engine";
import { TECHNIQUE_ORDER } from "@pundoku/engine";

const KINDS: readonly MoveKind[] = ["place", "erase", "note_add", "note_remove", "undo"];
const KIND_CHARS = "pearu";
const TECHNIQUES: readonly TechniqueOrBeyond[] = [...TECHNIQUE_ORDER, "beyond"];
const LOG_PREFIX = "1:";
const HEAT_STEPS = 1295; // 36² − 1

export function encodeMoveLog(log: MoveLog): string {
  let prev = 0;
  const parts: string[] = [];
  for (const m of log) {
    const k = KIND_CHARS[KINDS.indexOf(m.kind)];
    const cell = m.cell.toString(36).padStart(2, "0");
    const digit = m.digit ?? 0;
    const correct = m.correct === undefined ? "-" : m.correct ? "1" : "0";
    const tech = m.technique === undefined ? "-" : String(TECHNIQUES.indexOf(m.technique));
    const dt = Math.max(0, Math.round(m.t) - prev);
    prev += dt;
    parts.push(`${k}${cell}${digit}${correct}${tech}${dt.toString(36)}`);
  }
  return LOG_PREFIX + parts.join(",");
}

/** Строка → лог; `null` — строка повреждена (тогда запись дня опирается на `heat`). */
export function decodeMoveLog(text: unknown): MoveLog | null {
  if (typeof text !== "string" || !text.startsWith(LOG_PREFIX)) return null;
  const body = text.slice(LOG_PREFIX.length);
  if (body === "") return [];
  const out: Move[] = [];
  let t = 0;
  for (const part of body.split(",")) {
    if (part.length < 7) return null;
    const kind = KINDS[KIND_CHARS.indexOf(part[0]!)];
    const cell = parseInt(part.slice(1, 3), 36);
    const digit = Number(part[3]);
    const dt = /^[0-9a-z]+$/.test(part.slice(6)) ? parseInt(part.slice(6), 36) : NaN;
    const c = part[4];
    const q = part[5]!;
    if (!kind || !Number.isInteger(cell) || cell < 0 || cell > 80 || !Number.isInteger(digit) || !Number.isFinite(dt)) return null;
    if (c !== "-" && c !== "0" && c !== "1") return null;
    const technique = q === "-" ? undefined : TECHNIQUES[Number(q)];
    if (q !== "-" && technique === undefined) return null;
    t += dt;
    out.push({
      t,
      cell,
      kind,
      ...(digit >= 1 ? { digit: digit as Digit } : {}),
      ...(c === "-" ? {} : { correct: c === "1" }),
      ...(technique ? { technique } : {}),
    });
  }
  return out;
}

export function encodeHeat(heat: readonly (number | null)[]): string {
  return heat
    .map((h) =>
      h === null ? "--" : Math.round(Math.min(1, Math.max(0, h)) * HEAT_STEPS).toString(36).padStart(2, "0"),
    )
    .join("");
}

export function decodeHeat(text: unknown): (number | null)[] | null {
  if (typeof text !== "string" || text.length !== 162) return null;
  const out: (number | null)[] = [];
  for (let i = 0; i < 81; i++) {
    const chunk = text.slice(i * 2, i * 2 + 2);
    if (chunk === "--") {
      out.push(null);
      continue;
    }
    if (!/^[0-9a-z]{2}$/.test(chunk)) return null;
    const n = parseInt(chunk, 36);
    if (n > HEAT_STEPS) return null;
    out.push(n / HEAT_STEPS);
  }
  return out;
}
