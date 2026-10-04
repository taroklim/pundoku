import type { CSSProperties } from "react";

/**
 * Знак Pundoku P4 «Девять клеток» (PD-155; design/pd141-logo-round4.md): буква «P» из девяти клеток на решётке 3×4
 * (3 + 2 + 3 + 1), контрформа — пустая клетка. Один цвет — `currentColor`, плашки нет (она живёт только в иконке приложения).
 *
 * Три оптики по номинальному размеру (px): `solid` (< 24) — сплошная 16-сеточная «P» без зазоров; `small` (24..60) —
 * девять клеток 3×3 на сетке 16 (все края на целых); `full` (> 60) — клетки 146 со скруглением 30 на канве 1024.
 * Знак занимает ≈ 94 % коробки по высоте на любой оптике — на порогах 24/60 он не «прыгает».
 *
 * Декоративный по умолчанию (`aria-hidden`): смысл несёт соседний текст. Передать `title`, если знак стоит один.
 */
import {
  MARK_CELLS_MIN,
  MARK_FULL_CELLS,
  MARK_FULL_CELL_SIZE,
  MARK_FULL_RX,
  MARK_SMALL_CELLS,
  MARK_SMALL_CELL_SIZE,
  MARK_SOLID_PATH,
} from "./markPaths";

export * from "./markPaths";
export const MARK_SMALL_MAX = 60;

export type MarkOptics = "solid" | "small" | "full";

export interface MarkProps {
  /** Номинальный размер, CSS px (квадрат). */
  size: number;
  /** Доступное имя; без него знак декоративный (`aria-hidden`). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export const markOptics = (size: number): MarkOptics => (size < MARK_CELLS_MIN ? "solid" : size <= MARK_SMALL_MAX ? "small" : "full");

/** viewBox полной геометрии: квадрат 690 вокруг габарита знака (47 % × 63 % канвы 1024, центр (512, 512.5)) — те же 15/16 по высоте, что у 16-сетки. */
export const MARK_FULL_VIEWBOX = "167 167.5 690 690";

export function Mark({ size, title, className, style }: MarkProps) {
  const optics = markOptics(size);
  return (
    <svg
      viewBox={optics === "full" ? MARK_FULL_VIEWBOX : "0 0 16 16"}
      width={size}
      height={size}
      fill="currentColor"
      className={className ? `brand-mark ${className}` : "brand-mark"}
      style={style}
      focusable="false"
      data-optics={optics}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      {optics === "solid" && <path d={MARK_SOLID_PATH} />}
      {optics === "small" &&
        MARK_SMALL_CELLS.map((c) => <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={MARK_SMALL_CELL_SIZE} height={MARK_SMALL_CELL_SIZE} />)}
      {optics === "full" &&
        MARK_FULL_CELLS.map((c) => (
          <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width={MARK_FULL_CELL_SIZE} height={MARK_FULL_CELL_SIZE} rx={MARK_FULL_RX} />
        ))}
    </svg>
  );
}
