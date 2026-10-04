// Геометрия знака P4 «Девять клеток» (PD-155; design/pd141-logo-round4.md §2, §P4 «16-сеточные») — общая для <Mark>,
// PNG отпечатка (canvas Path2D) и теста сверки с public/icons/icon.svg. Буква «P» из девяти клеток на решётке 3×4:
// 3 + 2 + 3 + 1. Контрформа — пустая клетка (плашка), чернил в знаке нет: букву несёт площадь, а не цвет.

/** Раскладка по строкам (сверху вниз), `X` — клетка есть: 3 + 2 + 3 + 1 = девять. */
export const MARK_PATTERN = ["XXX", "X.X", "XXX", "X.."] as const;

export interface MarkCell {
  x: number;
  y: number;
}

function cellsOf(origin: MarkCell, step: number): MarkCell[] {
  const out: MarkCell[] = [];
  MARK_PATTERN.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      if (ch === "X") out.push({ x: origin.x + c * step, y: origin.y + r * step });
    });
  });
  return out;
}

/** Полная геометрия, канва 1024: клетка 146, зазор 21 (шаг 167), радиус 30; столбцы 272/439/606, строки 189/356/523/690. */
export const MARK_FULL_CELL_SIZE = 146;
export const MARK_FULL_RX = 30;
export const MARK_FULL_STEP = 167;
export const MARK_FULL_CELLS: readonly MarkCell[] = cellsOf({ x: 272, y: 189 }, MARK_FULL_STEP);
/** Габарит знака на канве 1024: x 272..752, y 189..836 (47 % × 63 %); центр по вертикали — 512.5. */
export const MARK_FULL_BOX = { x: 272, y: 189, w: 480, h: 647 } as const;

/** 16-сеточная клеточная версия (канва 16): клетки 3×3, зазор 1; все края на целых — от 24 px и выше. */
export const MARK_SMALL_CELL_SIZE = 3;
export const MARK_SMALL_STEP = 4;
export const MARK_SMALL_CELLS: readonly MarkCell[] = cellsOf({ x: 3, y: 1 }, MARK_SMALL_STEP);
/** Те же девять клеток одним путём (для canvas `Path2D`, `fill` без правила — клетки не пересекаются). */
export const MARK_SMALL_PATH = MARK_SMALL_CELLS.map(
  (c) => `M${c.x} ${c.y}H${c.x + MARK_SMALL_CELL_SIZE}V${c.y + MARK_SMALL_CELL_SIZE}H${c.x}Z`,
).join("");

/**
 * 16-сеточная сплошная версия (канва 16): стойка (3,1,3,14), перекладина (3,1,11,3), правая стенка (11,1,3,9), донце
 * чаши (3,7,11,3) одним контуром; контрформа 5×3 — второй подпуть обратного обхода (nonzero заливает вокруг неё).
 * Ниже 24 px зазор в 1 px уже не отличим от шума — буква остаётся сплошной, ни одного сглаженного пикселя.
 */
export const MARK_SOLID_PATH = "M3 1H14V10H6V15H3Z" + "M6 4V7H11V4Z";

/** Ниже этого номинального размера (px) знак рисуется сплошным; от него — клетками (design/pd141-logo-round4.md §7). */
export const MARK_CELLS_MIN = 24;
