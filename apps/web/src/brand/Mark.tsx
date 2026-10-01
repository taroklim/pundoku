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
export const MARK_SMALL_MAX = 60;

/** Пути на канве 16 (d5-favicon.svg) — для size <= MARK_SMALL_MAX. */
export const MARK_SMALL_FIELD = "M3 3H9V7H13V13A2 2 0 0 1 11 15H3A2 2 0 0 1 1 13V5A2 2 0 0 1 3 3Z";
export const MARK_SMALL_CELL = "M12 1H14A1 1 0 0 1 15 2V4A1 1 0 0 1 14 5H12A1 1 0 0 1 11 4V2A1 1 0 0 1 12 1Z";
/** Пути на канве 1024 (d5-mark.svg) — для size > MARK_SMALL_MAX. */
export const MARK_FULL_FIELD =
  "M337 347H485A27 27 0 0 1 512 374V485A27 27 0 0 0 539 512H650A27 27 0 0 1 677 539V687A113 113 0 0 1 564 800H337A113 113 0 0 1 224 687V460A113 113 0 0 1 337 347Z";
export const MARK_FULL_CELL =
  "M677 224H759A41 41 0 0 1 800 265V347A41 41 0 0 1 759 388H677A41 41 0 0 1 636 347V265A41 41 0 0 1 677 224Z";

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
