// Пути знака D5 «Унос» (PD-102, design/pd98-logo-round3.md §18.3) — общие для <Mark> и PNG отпечатка (canvas Path2D).

/** Пути на канве 16 (d5-favicon.svg) — для size <= MARK_SMALL_MAX. */
export const MARK_SMALL_FIELD = "M3 3H9V7H13V13A2 2 0 0 1 11 15H3A2 2 0 0 1 1 13V5A2 2 0 0 1 3 3Z";
export const MARK_SMALL_CELL = "M12 1H14A1 1 0 0 1 15 2V4A1 1 0 0 1 14 5H12A1 1 0 0 1 11 4V2A1 1 0 0 1 12 1Z";
/** Пути на канве 1024 (d5-mark.svg) — для size > MARK_SMALL_MAX. */
export const MARK_FULL_FIELD =
  "M337 347H485A27 27 0 0 1 512 374V485A27 27 0 0 0 539 512H650A27 27 0 0 1 677 539V687A113 113 0 0 1 564 800H337A113 113 0 0 1 224 687V460A113 113 0 0 1 337 347Z";
export const MARK_FULL_CELL =
  "M677 224H759A41 41 0 0 1 800 265V347A41 41 0 0 1 759 388H677A41 41 0 0 1 636 347V265A41 41 0 0 1 677 224Z";
