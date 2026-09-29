/**
 * Лог ходов игрока и метрики карточки дня (отчёт 05 §2).
 */
import { BOX_OF, COL_OF, GRID_SIZE, ROW_OF, assertCell, toGrid } from "./grid.js";
import { maxTechnique } from "./human.js";
import type { Cell, GridInput, Move, MoveLog, MoveLogSummary, SolvingStyle } from "./types.js";

export function createMoveLog(): MoveLog {
  return [];
}

/**
 * Добавляет ход, возвращая новый лог (исходный не меняется).
 * @throws {RangeError} если `t` убывает или клетка вне 0..80.
 */
export function appendMove(log: MoveLog, move: Move): MoveLog {
  assertCell(move.cell);
  const last = log[log.length - 1];
  if (last && move.t < last.t) throw new RangeError(`Move time ${move.t} is before previous ${last.t}`);
  if (move.t < 0) throw new RangeError(`Move time must be >= 0, got ${move.t}`);
  return [...log, move];
}

/**
 * Тепловая карта пути: для каждой клетки — момент её финального правильного заполнения,
 * нормированный к длительности партии (0 — старт, 1 — последний ход). `null` — подсказка
 * (given) либо клетка так и не была заполнена правильно.
 *
 * `correct` берётся из хода; если поле не проставлено — сверяется с `solution`
 * (если решение передано), иначе ход считается правильным.
 */
export function heatmap(log: MoveLog, puzzle: { mission: GridInput; solution?: GridInput }): (number | null)[] {
  const mission = toGrid(puzzle.mission);
  const solution = puzzle.solution === undefined ? null : toGrid(puzzle.solution);
  const out: (number | null)[] = new Array<number | null>(GRID_SIZE).fill(null);
  const duration = durationOf(log);
  for (const m of log) {
    if (mission[m.cell] !== 0) continue;
    if (m.kind === "place") {
      const ok =
        m.correct ?? (solution !== null && m.digit !== undefined ? solution[m.cell] === m.digit : true);
      out[m.cell] = ok ? (duration === 0 ? 0 : m.t / duration) : null;
    } else if (m.kind === "erase" || m.kind === "undo") {
      out[m.cell] = null;
    }
  }
  return out;
}

function durationOf(log: MoveLog): number {
  return log.length === 0 ? 0 : log[log.length - 1]!.t;
}

/** Сводка для карточки дня. */
export function summary(log: MoveLog): MoveLogSummary {
  let corrections = 0;
  let mistakes = 0;
  let firstCell: Cell | null = null;
  let placements = 0;
  const techniques: NonNullable<Move["technique"]>[] = [];
  const filled = new Uint8Array(GRID_SIZE);
  const times: number[] = [];

  for (const m of log) {
    switch (m.kind) {
      case "place":
        placements++;
        times.push(m.t);
        if (firstCell === null) firstCell = m.cell;
        if (filled[m.cell]) corrections++;
        filled[m.cell] = 1;
        if (m.correct === false) mistakes++;
        if (m.technique) techniques.push(m.technique);
        break;
      case "erase":
      case "undo":
        corrections++;
        filled[m.cell] = 0;
        break;
      case "note_add":
      case "note_remove":
        break;
    }
  }

  let intervalVariance = 0;
  let evenness = 0;
  if (times.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i]! - times[i - 1]!);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    intervalVariance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    evenness = mean === 0 ? 0 : Math.sqrt(intervalVariance) / mean;
  }

  return {
    durationMs: durationOf(log),
    clean: corrections === 0 && mistakes === 0,
    corrections,
    mistakes,
    maxTechnique: maxTechnique(techniques),
    firstCell,
    placements,
    evenness,
    intervalVariance,
  };
}

/**
 * Стиль решения — простая эвристика по последовательности постановок (`place`):
 * для каждой пары соседних постановок смотрим, что их связывает, и считаем доли.
 *
 * - `scanner` — та же цифра или следующая по кругу (1→2→…→9→1): игрок идёт по цифрам.
 * - `snake` — следующая клетка примыкает к предыдущей (манхэттенское расстояние 1):
 *   движется географически.
 * - `blocker` — тот же блок 3×3: закрывает блоки.
 * - `snake` (слабый признак) — рядом (расстояние ≤ 2), но без выраженного блока.
 * - `sniper` — иначе: прыжки по доске за самыми лёгкими клетками.
 *
 * Побеждает первая по этому порядку доля ≥ 0.5; при < 4 постановках стиль не
 * определён и возвращается `sniper`.
 */
export function solvingStyle(log: MoveLog): SolvingStyle {
  const places = log.filter((m) => m.kind === "place");
  if (places.length < 4) return "sniper";
  let sameDigit = 0;
  let sameBox = 0;
  let adjacent = 0;
  let near = 0;
  const pairs = places.length - 1;
  for (let i = 1; i < places.length; i++) {
    const a = places[i - 1]!;
    const b = places[i]!;
    if (a.digit !== undefined && b.digit !== undefined) {
      if (a.digit === b.digit || (a.digit % 9) + 1 === b.digit) sameDigit++;
    }
    if (BOX_OF[a.cell] === BOX_OF[b.cell]) sameBox++;
    const dist =
      Math.abs(ROW_OF[a.cell]! - ROW_OF[b.cell]!) + Math.abs(COL_OF[a.cell]! - COL_OF[b.cell]!);
    if (dist === 1) adjacent++;
    if (dist <= 2) near++;
  }
  if (sameDigit / pairs >= 0.5) return "scanner";
  if (adjacent / pairs >= 0.5) return "snake";
  if (sameBox / pairs >= 0.5) return "blocker";
  if (near / pairs >= 0.5) return "snake";
  return "sniper";
}
