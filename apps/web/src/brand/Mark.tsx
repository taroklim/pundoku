import type { CSSProperties } from "react";

/**
 * Знак Pundoku D5 «Унос» (PD-102; design/pd98-logo-round3.md §18.3, §18.5): поле дня с выкушенной клеткой
 * и эта клетка уже снаружи. Один цвет — `currentColor`, плашки нет (она живёт только в иконке приложения).
 *
 * Малая оптика: номинальный размер <= 60 px рисуется 16-сеточным знаком (все края на целых, коридор 2 единицы
 * без сглаживания), больше — полной геометрией на канве 1024 (вогнутый фелет r=27 у выреза). Порог один.
 *
 * Декоративный по умолчанию (`aria-hidden`): смысл несёт соседний текст. Передать `title`, если знак стоит один.
 */
import { MARK_FULL_CELL, MARK_FULL_FIELD, MARK_SMALL_CELL, MARK_SMALL_FIELD } from "./markPaths";

export { MARK_FULL_CELL, MARK_FULL_FIELD, MARK_SMALL_CELL, MARK_SMALL_FIELD };
export const MARK_SMALL_MAX = 60;

export interface MarkProps {
  /** Номинальный размер, CSS px (квадрат). */
  size: number;
  /** Доступное имя; без него знак декоративный (`aria-hidden`). */
  title?: string;
  className?: string;
  style?: CSSProperties;
}

export function Mark({ size, title, className, style }: MarkProps) {
  const small = size <= MARK_SMALL_MAX;
  // Полный знак занимает 224..800 канвы 1024 (576). Канву режем так, чтобы он занимал те же 87.5 %, что 16-сеточный
  // (14 из 16): size — размер знака с тем же полем в единицу, и на пороге 60/61 px знак не «проваливается» по размеру.
  const viewBox = small ? "0 0 16 16" : "183 183 658 658";
  return (
    <svg
      viewBox={viewBox}
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      style={style}
      focusable="false"
      data-optics={small ? "small" : "full"}
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      <path d={small ? MARK_SMALL_FIELD : MARK_FULL_FIELD} />
      <path d={small ? MARK_SMALL_CELL : MARK_FULL_CELL} />
    </svg>
  );
}
