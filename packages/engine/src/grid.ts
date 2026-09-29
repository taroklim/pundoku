/**
 * Геометрия сетки, разбор/форматирование и валидация.
 */
import type { Cell, CellValue, Digit, Grid, GridInput } from "./types.js";

export const GRID_SIZE = 81;

/** Строка клетки (0..8). */
export const ROW_OF: Uint8Array = new Uint8Array(81);
/** Столбец клетки (0..8). */
export const COL_OF: Uint8Array = new Uint8Array(81);
/** Блок 3×3 клетки (0..8, по строкам). */
export const BOX_OF: Uint8Array = new Uint8Array(81);

for (let c = 0; c < 81; c++) {
  const r = Math.floor(c / 9);
  const col = c % 9;
  ROW_OF[c] = r;
  COL_OF[c] = col;
  BOX_OF[c] = Math.floor(r / 3) * 3 + Math.floor(col / 3);
}

/**
 * 27 юнитов: 0..8 — строки, 9..17 — столбцы, 18..26 — блоки. Каждый — 9 клеток.
 */
export const UNITS: readonly Uint8Array[] = (() => {
  const units: Uint8Array[] = [];
  for (let r = 0; r < 9; r++) units.push(Uint8Array.from({ length: 9 }, (_, i) => r * 9 + i));
  for (let c = 0; c < 9; c++) units.push(Uint8Array.from({ length: 9 }, (_, i) => i * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = Math.floor(b / 3) * 3;
    const c0 = (b % 3) * 3;
    units.push(
      Uint8Array.from({ length: 9 }, (_, i) => (r0 + Math.floor(i / 3)) * 9 + c0 + (i % 3)),
    );
  }
  return units;
})();

/** 20 «соседей» клетки — все клетки её строки, столбца и блока, кроме неё самой. */
export const PEERS: readonly Uint8Array[] = (() => {
  const peers: Uint8Array[] = [];
  for (let c = 0; c < 81; c++) {
    const set = new Set<number>();
    for (const u of [ROW_OF[c]!, 9 + COL_OF[c]!, 18 + BOX_OF[c]!]) {
      for (const p of UNITS[u]!) if (p !== c) set.add(p);
    }
    peers.push(Uint8Array.from([...set].sort((a, b) => a - b)));
  }
  return peers;
})();

/** Битовая маска всех девяти цифр (биты 1..9). */
export const ALL_DIGITS_MASK = 0b1111111110;

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Цифры из битовой маски по возрастанию. */
export function maskToDigits(mask: number): Digit[] {
  const out: Digit[] = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << d)) out.push(d as Digit);
  return out;
}

/** Единственная цифра из маски с одним битом (0, если битов не один). */
export function maskToSingleDigit(mask: number): Digit | 0 {
  if (mask === 0 || (mask & (mask - 1)) !== 0) return 0;
  return (31 - Math.clz32(mask)) as Digit;
}

/**
 * Разбирает строку из 81 символа. Пустая клетка — `0` или `.`.
 * @throws {RangeError} при неверной длине или недопустимых символах.
 */
export function parseGrid(text: string): Grid {
  if (text.length !== GRID_SIZE) {
    throw new RangeError(`Grid string must be 81 chars, got ${text.length}`);
  }
  const out: CellValue[] = new Array<CellValue>(GRID_SIZE);
  for (let i = 0; i < GRID_SIZE; i++) {
    const ch = text.charCodeAt(i);
    if (ch === 46 /* . */ || ch === 48 /* 0 */) out[i] = 0;
    else if (ch >= 49 && ch <= 57) out[i] = (ch - 48) as CellValue;
    else throw new RangeError(`Invalid grid char '${text[i]}' at ${i}`);
  }
  return out;
}

/** Приводит любое представление к массиву из 81 значения (с проверкой формы). */
export function toGrid(input: GridInput): Grid {
  if (typeof input === "string") return parseGrid(input);
  if (input.length !== GRID_SIZE) {
    throw new RangeError(`Grid must have 81 cells, got ${input.length}`);
  }
  for (let i = 0; i < GRID_SIZE; i++) {
    const v = input[i];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 9) {
      throw new RangeError(`Invalid cell value ${String(v)} at ${i}`);
    }
  }
  return input;
}

/** 81-символьная строка, пустые клетки — `0`. */
export function formatGrid(grid: GridInput): string {
  const g = toGrid(grid);
  let s = "";
  for (let i = 0; i < GRID_SIZE; i++) s += g[i];
  return s;
}

export function emptyGrid(): Grid {
  return Array.from({ length: GRID_SIZE }, (): CellValue => 0);
}

/** Внутреннее: сетка как Uint8Array (копия). */
export function toBytes(input: GridInput): Uint8Array {
  return Uint8Array.from(toGrid(input));
}

export function bytesToGrid(bytes: Uint8Array): Grid {
  return Array.from(bytes, (v) => v as CellValue);
}

/**
 * Клетки, участвующие хотя бы в одном конфликте (одинаковая цифра дважды в строке,
 * столбце или блоке). Пустой массив — конфликтов нет.
 */
export function conflicts(input: GridInput): Cell[] {
  const g = toGrid(input);
  const bad = new Set<number>();
  for (const unit of UNITS) {
    for (let i = 0; i < 9; i++) {
      const a = unit[i]!;
      const va = g[a]!;
      if (va === 0) continue;
      for (let j = i + 1; j < 9; j++) {
        const b = unit[j]!;
        if (g[b] === va) {
          bad.add(a);
          bad.add(b);
        }
      }
    }
  }
  return [...bad].sort((a, b) => a - b);
}

/**
 * Валидная сетка: 81 значение 0..9 и ни одного конфликта. Не проверяет решаемость —
 * для этого `solve`/`countSolutions`.
 */
export function isValidGrid(input: GridInput): boolean {
  try {
    return conflicts(input).length === 0;
  } catch {
    return false;
  }
}

/** Внутреннее: маска кандидатов клетки по значениям соседей (без учёта её собственного значения). */
export function peerMask(g: ArrayLike<number>, cell: Cell): number {
  let used = 0;
  const peers = PEERS[cell]!;
  for (let i = 0; i < 20; i++) used |= 1 << g[peers[i]!]!;
  return ALL_DIGITS_MASK & ~used;
}

/**
 * Кандидаты клетки: цифры, не встречающиеся среди её соседей. Для занятой клетки — `[]`.
 */
export function candidates(input: GridInput, cell: Cell): Digit[] {
  const g = toGrid(input);
  assertCell(cell);
  if (g[cell] !== 0) return [];
  return maskToDigits(peerMask(g, cell));
}

export function assertCell(cell: Cell): void {
  if (!Number.isInteger(cell) || cell < 0 || cell >= GRID_SIZE) {
    throw new RangeError(`Cell index must be 0..80, got ${cell}`);
  }
}
