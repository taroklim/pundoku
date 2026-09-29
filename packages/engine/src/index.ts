/**
 * @pundoku/engine — публичный API движка.
 *
 * PD-0: только заглушки типов. Генератор, решатель и лог техник — PD-1/PD-2.
 * Пакет не зависит от DOM и Node — чистый ES2022, чтобы одинаково работать
 * в браузере (Play/фолбэк Today) и на сервере.
 */

/** Значение клетки: 0 — пусто, 1..9 — цифра. */
export type CellValue = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Сетка 9×9, 81 клетка в порядке строк (index = row * 9 + col). */
export type Grid = readonly CellValue[];

export type Difficulty = "easy" | "medium" | "hard" | "expert";

export interface Puzzle {
  /** Исходные подсказки (0 — пустая клетка). */
  readonly givens: Grid;
  /** Единственное решение. */
  readonly solution: Grid;
  readonly difficulty: Difficulty;
  /** Seed генератора (для Today: дата YYYY-MM-DD), если сетка сгенерирована. */
  readonly seed?: string;
}

export const GRID_SIZE = 81;

export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "expert"];

/** Пустая сетка — временная заглушка, чтобы у пакета был хотя бы один runtime-экспорт. */
export function emptyGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, (): CellValue => 0);
}
