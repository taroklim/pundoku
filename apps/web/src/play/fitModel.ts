/**
 * PD-144 (D-1): модель резерва высоты экрана партии (`.play-fit`) — те же числа, что в styles/play.css (`--chrome0`, `--extra`,
 * `--dock-h`), но на чистых функциях, чтобы тест держал свойство «док подсказки поле не двигает» там, где jsdom раскладку не
 * считает. Живая проверка (реальный Chromium/WebKit) — design/pd144-fit-check.mjs; `pd144.css.test.ts` сверяет константы с CSS.
 *
 * Размеры в px; `rem` — размер корневого шрифта (17 px по умолчанию, ~40 px на AX3).
 */
export const FIT = {
  /** Высота дока подсказки, которую резервируем заранее. */
  dockH: 172,
  /** Отступы дока: 8 px над ним и 10 под ним. */
  dockGap: 18,
  /** Панель 1–9 (56) + ряд действий (66): место, которое док занимает и так. */
  padSlot: 122,
  /** Строка статуса (1.15rem) + её отступы (16): при открытом доке скрыта, тоже отдаёт место. */
  gapPad: 16,
  /** Пол поля: резерв не сжимает его глубже. */
  boardFloor: 240,
} as const;

export interface FitInput {
  /** `100dvh`. */
  vh: number;
  /** Доступная ширина колонки (поле не шире неё). */
  width: number;
  /** Корневой шрифт, px. */
  rem: number;
  saTop?: number;
  saBot?: number;
  /** Подсказки возможны: партия не в Ink и не хаб (`.play-hintable`). */
  hintable: boolean;
}

/** `--tabbar-h` (shell.css): 64 px, растёт с подписью вкладки `clamp(11px, 0.65rem, 13px)`. */
export const tabbarH = (rem: number) => 64 + (Math.min(13, Math.max(11, 0.65 * rem)) - 11) * 1.5;

/** `--chrome0`: вся обвязка под/над полем без резерва под док. */
export function chrome0({ rem, saTop = 0, saBot = 0 }: Pick<FitInput, "rem" | "saTop" | "saBot">): number {
  return saTop + saBot + 2 * rem + 8 + 1.15 * rem + 2 + 1.15 * rem + 16 + 56 + 66 + tabbarH(rem) + 12;
}

/** `--extra`: постоянный резерв под док (0 вне `.play-hintable`). */
export function extra(i: FitInput): number {
  if (!i.hintable) return 0;
  const need = Math.max(0, FIT.dockH + FIT.dockGap - FIT.padSlot - 1.15 * i.rem - FIT.gapPad);
  const room = Math.max(0, i.vh - chrome0(i) - FIT.boardFloor);
  return Math.min(need, room);
}

/** Сторона поля: `min(ширина, 100dvh − --chrome)`. `dockOpen` на неё НЕ влияет — в этом суть. */
export function boardSide(i: FitInput, _dockOpen = false): number {
  return Math.max(0, Math.min(i.width, i.vh - chrome0(i) - extra(i)));
}

/** Высота, которую док получает при открытии: место панели + строки статуса + резерв (минус отступы дока). */
export function dockRoom(i: FitInput): number {
  return FIT.padSlot + 1.15 * i.rem + FIT.gapPad + extra(i) - FIT.dockGap;
}

/**
 * Классы корня экрана партии: общие для Play и Today/архива (PD-147: на Today док подсказки сдвигал страницу — экран не был
 * нескроллящимся и резерва под док не имел). `fit` — партия на экране (не хаб, не карточка «решено»): нескроллящийся экран
 * `.play-fit`; `hintable` — место под док отложено заранее (`.play-hintable`); `docked` — док открыт (`.play-docked`).
 * Пустая строка — экран прокручивается (карточка результата, хаб Play имеет собственный `.play-hub`).
 */
export function fitClassName({ fit, hintable, docked }: { fit: boolean; hintable: boolean; docked: boolean }): string {
  return fit ? ` play-fit${hintable ? " play-hintable" : ""}${docked ? " play-docked" : ""}` : "";
}
