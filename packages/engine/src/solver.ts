/**
 * Быстрый решатель на единственность: бит-масочный backtracking с выбором клетки с
 * минимумом кандидатов (MRV). Валидную 9×9 решает за доли миллисекунды.
 */
import { ALL_DIGITS_MASK, BOX_OF, COL_OF, ROW_OF, bytesToGrid, popcount, toBytes } from "./grid.js";
import type { Rng } from "./prng.js";
import type { Grid, GridInput } from "./types.js";

interface SearchState {
  cells: Uint8Array;
  rows: Uint16Array;
  cols: Uint16Array;
  boxes: Uint16Array;
  limit: number;
  found: number;
  first: Uint8Array | null;
  rng: Rng | null;
  /** Вызывается на каждое найденное решение (сетка — живой буфер поиска, копировать при сохранении). */
  onSolution: ((cells: Uint8Array) => void) | null;
}

/** Инициализирует маски; возвращает false, если в исходных данных есть конфликт. */
function initState(cells: Uint8Array, limit: number, rng: Rng | null): SearchState | null {
  const rows = new Uint16Array(9);
  const cols = new Uint16Array(9);
  const boxes = new Uint16Array(9);
  for (let c = 0; c < 81; c++) {
    const v = cells[c]!;
    if (v === 0) continue;
    const bit = 1 << v;
    const r = ROW_OF[c]!;
    const col = COL_OF[c]!;
    const b = BOX_OF[c]!;
    if (rows[r]! & bit || cols[col]! & bit || boxes[b]! & bit) return null;
    rows[r]! |= bit;
    cols[col]! |= bit;
    boxes[b]! |= bit;
  }
  return { cells, rows, cols, boxes, limit, found: 0, first: null, rng, onSolution: null };
}

function search(st: SearchState): void {
  // MRV: клетка с наименьшим числом кандидатов.
  let best = -1;
  let bestMask = 0;
  let bestCount = 10;
  const { cells, rows, cols, boxes } = st;
  for (let c = 0; c < 81; c++) {
    if (cells[c] !== 0) continue;
    const mask = ALL_DIGITS_MASK & ~(rows[ROW_OF[c]!]! | cols[COL_OF[c]!]! | boxes[BOX_OF[c]!]!);
    const n = popcount(mask);
    if (n < bestCount) {
      bestCount = n;
      bestMask = mask;
      best = c;
      if (n <= 1) break;
    }
  }
  if (best === -1) {
    st.found++;
    if (st.first === null) st.first = Uint8Array.from(cells);
    if (st.onSolution !== null) st.onSolution(cells);
    return;
  }
  if (bestCount === 0) return;

  const r = ROW_OF[best]!;
  const col = COL_OF[best]!;
  const b = BOX_OF[best]!;

  if (st.rng !== null) {
    // Случайный порядок цифр — для генерации полной сетки.
    const digits: number[] = [];
    for (let d = 1; d <= 9; d++) if (bestMask & (1 << d)) digits.push(d);
    st.rng.shuffle(digits);
    for (const d of digits) {
      if (tryDigit(st, best, d, r, col, b)) return;
    }
    return;
  }

  for (let d = 1; d <= 9; d++) {
    if (!(bestMask & (1 << d))) continue;
    if (tryDigit(st, best, d, r, col, b)) return;
  }
}

/** Возвращает true, если лимит решений достигнут и поиск нужно прекратить. */
function tryDigit(st: SearchState, c: number, d: number, r: number, col: number, b: number): boolean {
  const bit = 1 << d;
  st.cells[c] = d;
  st.rows[r]! |= bit;
  st.cols[col]! |= bit;
  st.boxes[b]! |= bit;
  search(st);
  st.cells[c] = 0;
  st.rows[r]! &= ~bit;
  st.cols[col]! &= ~bit;
  st.boxes[b]! &= ~bit;
  return st.found >= st.limit;
}

/** Внутреннее: число решений (до `limit`) для сетки в виде байтов. Сетку не меняет. */
export function countSolutionsBytes(cells: Uint8Array, limit: number, rng: Rng | null = null): number {
  const st = initState(Uint8Array.from(cells), limit, rng);
  if (st === null) return 0;
  search(st);
  return st.found;
}

/**
 * Внутреннее: перебор решений (до `limit`), `onSolution` — на каждое (буфер поиска, не сохранять по
 * ссылке). Возвращает число найденных (≤ limit; == limit — возможно, решений больше).
 */
export function forEachSolutionBytes(cells: Uint8Array, limit: number, onSolution: (cells: Uint8Array) => void): number {
  const st = initState(Uint8Array.from(cells), limit, null);
  if (st === null) return 0;
  st.onSolution = onSolution;
  search(st);
  return st.found;
}

/** Внутреннее: первое найденное решение или null. */
export function solveBytes(cells: Uint8Array, rng: Rng | null = null): Uint8Array | null {
  const st = initState(Uint8Array.from(cells), 1, rng);
  if (st === null) return null;
  search(st);
  return st.first;
}

/**
 * Решение сетки или null, если решений нет. Если решений несколько — возвращает первое
 * найденное (проверяйте единственность через `countSolutions`).
 */
export function solve(grid: GridInput): Grid | null {
  const res = solveBytes(toBytes(grid));
  return res === null ? null : bytesToGrid(res);
}

/**
 * Число решений, но не больше `limit` (по умолчанию 2 — достаточно для проверки
 * единственности: 0 — нет решений, 1 — единственное, 2 — неоднозначно).
 */
export function countSolutions(grid: GridInput, limit = 2): number {
  if (limit < 1) return 0;
  return countSolutionsBytes(toBytes(grid), limit);
}

/** Сетка имеет ровно одно решение. */
export function hasUniqueSolution(grid: GridInput): boolean {
  return countSolutions(grid, 2) === 1;
}
