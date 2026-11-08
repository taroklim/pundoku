/**
 * Симметрии судоку (PD-304): преобразования, переводящие любую корректную сетку в корректную, — перестановка
 * цифр (9!), строк внутри каждой полосы (3!³), полос (3!), столбцов внутри каждого стека (3!³), стеков (3!) и
 * транспонирование (2). Сохраняют число решений и логическую структуру (какие техники нужны: строки и столбцы
 * меняются ролями, рыба в строках становится рыбой в столбцах). Используется корпусом expert_plus (generator.ts).
 */
import { GRID_SIZE } from "./grid.js";
import type { Rng } from "./prng.js";

/** Случайная перестановка 0..8, сохраняющая тройки (0–2, 3–5, 6–8): порядок троек и порядок внутри каждой. */
function bandPermutation(rng: Rng): number[] {
  const bands = [0, 1, 2];
  rng.shuffle(bands);
  const out: number[] = [];
  for (const b of bands) {
    const inner = [0, 1, 2];
    rng.shuffle(inner);
    for (const i of inner) out.push(b * 3 + i);
  }
  return out;
}

/**
 * Случайный изоморф сетки (`0` — пусто): клетка (r, c) результата берёт клетку (rows[r], cols[c]) исходной
 * (с транспонированием — (cols[c], rows[r])), цифра d переходит в digits[d]. Детерминирован по `rng`.
 */
export function randomIsomorph(rng: Rng, grid: Uint8Array): Uint8Array {
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  rng.shuffle(digits);
  const rows = bandPermutation(rng);
  const cols = bandPermutation(rng);
  const transpose = rng.int(2) === 1;
  const out = new Uint8Array(GRID_SIZE);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const src = transpose ? cols[c]! * 9 + rows[r]! : rows[r]! * 9 + cols[c]!;
      const v = grid[src]!;
      out[r * 9 + c] = v === 0 ? 0 : digits[v - 1]!;
    }
  }
  return out;
}
