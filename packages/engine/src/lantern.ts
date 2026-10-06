/**
 * Фонарь (PD-208, план режимов релиза 2 §5): геометрия света, без UI.
 *
 * Свет выбранной клетки — её строка, столбец и блок, включая саму клетку: 21 клетка (20 соседей `PEERS` + она).
 * Вне света свои цифры и заметки игрока в тени (это решает приложение); данные подсказки видны всегда. Правила,
 * лог и подсказки (`nextHint`) в Фонаре те же, что в Классике — движку больше ничего не нужно.
 */
import { assertCell, GRID_SIZE, PEERS } from "./grid.js";
import type { Cell } from "./types.js";

/** Сколько клеток в свете одной клетки: 8 строки + 8 столбца + 4 блока вне их + она сама. */
export const LIT_CELLS_COUNT = 21;

const LIT: readonly (readonly Cell[])[] = Array.from({ length: GRID_SIZE }, (_, c) =>
  Object.freeze([...PEERS[c]!, c].sort((a, b) => a - b)),
);

/**
 * Клетки в свете фонаря, стоящего на `cell`: строка + столбец + блок, включая саму `cell`, по возрастанию индекса.
 * Массив общий и заморожен — не мутировать. Неверный индекс — `RangeError`.
 */
export function litCells(cell: Cell): readonly Cell[] {
  assertCell(cell);
  return LIT[cell]!;
}

/** Клетка `target` в свете фонаря на `cell` (та же строка, столбец или блок, либо она сама). */
export function isLit(cell: Cell, target: Cell): boolean {
  assertCell(cell);
  assertCell(target);
  return target === cell || PEERS[cell]!.includes(target);
}
