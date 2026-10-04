/**
 * Геометрия вордмарка «Pundoku» (PD-149 раунд 5, вариант A; design/pd141-logo-round5.md §9.1) — общая для
 * `<Wordmark>` (SVG) и PNG отпечатка (canvas), чтобы цифры не разошлись.
 *
 * «Pun» сложено из клеток 23×23 (зазор 4, радиус 4 — модуль P6): «P» — решётка 3×4 (рост прописных 104),
 * «u» и «n» — 3×3 (x-высота), строки «u»/«n» совпадают со строками 2–4 у «P». Всего 23 клетки. «doku» (в том числе
 * второе «u») — рисованные буквы штрихом 22 (пути d5-wordmark.svg, сдвинуты вправо на 26). Буквы не локализуются.
 * Внутренние координаты — до `translate(2 -94)`: базовая линия y=200, верх прописных 96, x-высота 124.
 */
export const WORDMARK_VIEW_W = 614;
export const WORDMARK_VIEW_H = 116;
export const WORDMARK_RATIO = WORDMARK_VIEW_W / WORDMARK_VIEW_H;
/** Сдвиг группы букв во viewBox (PD-93 §10.2): внутренние координаты -> `translate(2 -94)`. */
export const WORDMARK_SHIFT_X = 2;
export const WORDMARK_SHIFT_Y = -94;
/** Базовая линия букв во viewBox (200 − 94): низ «P»/«u»/«n» и рисованных букв. */
export const WORDMARK_BASELINE = 200 + WORDMARK_SHIFT_Y;

export const WORDMARK_CELL = 23;
export const WORDMARK_GAP = 4;
export const WORDMARK_RX = 4;
export const WORDMARK_STROKE = 22;
const PITCH = WORDMARK_CELL + WORDMARK_GAP;

/** Карта клеток: `#` — клетка, `.` — пустое гнездо. Верхняя строка «P» — рост прописных. */
const LETTERS: readonly { readonly name: "P" | "u" | "n"; readonly x: number; readonly rows: readonly string[] }[] = [
  { name: "P", x: 0, rows: ["###", "#.#", "###", "#.."] },
  { name: "u", x: 91, rows: ["#.#", "#.#", "###"] },
  { name: "n", x: 182, rows: ["###", "#.#", "#.#"] },
];

export interface WordmarkCell {
  readonly letter: "P" | "u" | "n";
  readonly x: number;
  readonly y: number;
}

/** 23 клетки «Pun» во внутренних координатах: строка i сверху садится на базовую линию 200 с шагом 27. */
export const WORDMARK_CELLS: readonly WordmarkCell[] = LETTERS.flatMap(({ name, x, rows }) =>
  rows.flatMap((row, i) =>
    [...row].flatMap((ch, j) =>
      ch === "#" ? [{ letter: name, x: x + j * PITCH, y: 200 - (rows.length - i) * PITCH + WORDMARK_GAP }] : [],
    ),
  ),
);

/** Рисованные «doku» (штрих `WORDMARK_STROKE`, `butt`/`round`): путь в локальных координатах + сдвиг по x. */
export const WORDMARK_DOKU: readonly { readonly letter: "d" | "o" | "k" | "u"; readonly x: number; readonly d: string }[] = [
  { letter: "d", x: 273, d: "M11 162A28 27 0 0 1 67 162A28 27 0 0 1 11 162M67 96V200" },
  { letter: "o", x: 365, d: "M11 162A28 27 0 0 1 67 162A28 27 0 0 1 11 162" },
  { letter: "k", x: 457, d: "M11 96V200M58 124L26 168L62 200" },
  { letter: "u", x: 542, d: "M11 124V167A23 22 0 0 0 57 167M57 124V200" },
];
