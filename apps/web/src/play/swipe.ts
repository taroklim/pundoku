/**
 * PD-225: числа и решения свайп-удаления строки режима на хабе Play — дословно по спецификации design/pd224-swipe-gestures.md
 * §A3 (эталон — `const P` макета design/pd224-swipe.html). Только чистые функции: компонент строки (`SwipeRow.tsx`) ведёт
 * указатель и DOM, а всё, что решает «открыть / закрыть / удалить», — здесь и покрыто юнит-тестом (как `shouldDismiss` у шита).
 *
 * Обозначения: `W` — ширина строки, `x` — сдвиг строки (≤ 0), `A` — ширина кнопки «Удалить», `T` — порог полного свайпа.
 */
export const SWIPE = {
  /** Сдвиг до решения жеста (= `MOVE_SLOP_PX` долгого нажатия). */
  SLOP: 10,
  /** Захват свайпа: `|dx| ≥ ANGLE · |dy|` (≤ ~34° от горизонтали). */
  ANGLE: 1.5,
  /** Касание, начатое ближе к краю экрана, свайп не начинает (запас под «назад» от края). */
  EDGE: 16,
  /** Ширина кнопки: `max(A_MIN, подпись + A_PAD)`. */
  A_MIN: 80,
  A_PAD: 32,
  /** Режим «значок»: подпись + поля > `ICON_FRAC · W` → только корзина, `A = A_ICON`. */
  A_ICON: 88,
  ICON_FRAC: 0.45,
  /** Отпустили при `−x ≥ OPEN_FRAC · A` — строка остаётся открытой. */
  OPEN_FRAC: 0.5,
  /** Бросок, px/мс по последним `FLICK_WINDOW_MS`; влево открывает только при `−x ≥ FLICK_MIN`. Бросок никогда не удаляет. */
  FLICK: 0.3,
  FLICK_MIN: 16,
  FLICK_WINDOW_MS: 100,
  /** Полный свайп: `T = max(ARM_FRAC · W, A + ARM_EXTRA)`; «armed» гаснет при `−x < T − HYST`. */
  ARM_FRAC: 0.55,
  ARM_EXTRA: 72,
  HYST: 24,
  /** Резинка: открытая строка, тянутая вправо за 0. */
  RUBBER: 0.2,
  RUBBER_MAX: 12,
  /** Длительности, мс (при Reduce Motion — 0: доводки мгновенные). */
  SETTLE_MS: 220,
  COMMIT_MS: 260,
  LABEL_MS: 140,
  /** Прокрутка хаба больше чем на столько закрывает открытую строку. */
  SCROLL_CLOSE_PX: 4,
} as const;

export interface SwipeGeometry {
  readonly W: number;
  readonly A: number;
  readonly T: number;
  /** Подпись не влезает (AX-размеры) — кнопка показывает только значок корзины, подпись остаётся a11y-именем. */
  readonly iconOnly: boolean;
}

/** `W` — ширина строки, `label` — ширина подписи «Удалить» в текущем языке и размере текста. */
export function swipeGeometry(W: number, label: number): SwipeGeometry {
  const need = label + SWIPE.A_PAD;
  const iconOnly = need > SWIPE.ICON_FRAC * W;
  const A = iconOnly ? SWIPE.A_ICON : Math.max(SWIPE.A_MIN, Math.ceil(need));
  return { W, A, T: Math.round(Math.max(SWIPE.ARM_FRAC * W, A + SWIPE.ARM_EXTRA)), iconOnly };
}

/**
 * Чей жест (до захвата): `scroll` — вертикаль набрала slop раньше, отдаём прокрутке до конца касания; `swipe` — горизонталь
 * набрала slop под пологим углом; `undecided` — ждём дальше.
 */
export function claimGesture(dx: number, dy: number): "undecided" | "swipe" | "scroll" {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay >= SWIPE.SLOP && ax < SWIPE.ANGLE * ay) return "scroll";
  if (ax < SWIPE.SLOP || ax < SWIPE.ANGLE * ay) return "undecided";
  return "swipe";
}

/** Сдвиг строки при ведении: от `start` (0 — закрыта, `−A` — открыта) на `dx`; вправо за 0 — только резинка открытой; предел `−W`. */
export function dragX(start: number, dx: number, wasOpen: boolean, W: number): number {
  let x = start + dx;
  if (x > 0) x = wasOpen ? Math.min(SWIPE.RUBBER_MAX, x * SWIPE.RUBBER) : 0;
  return Math.max(-W, x);
}

/** «armed» во время ведения, с гистерезисом: включается при `−x ≥ T`, гаснет при `−x < T − HYST`. */
export function nextArmed(armed: boolean, x: number, T: number): boolean {
  if (!armed) return -x >= T;
  return -x >= T - SWIPE.HYST;
}

export type ReleaseAction = "open" | "close" | "delete";

/**
 * Решение по отпусканию (§A3, таблица):
 *   armed:          v ≥ +FLICK → открыть (передумал броском); иначе → УДАЛИТЬ
 *   не armed:       v ≥ +FLICK → закрыть; v ≤ −FLICK и −x ≥ FLICK_MIN → открыть; −x ≥ A/2 → открыть; иначе → закрыть
 *   pointercancel:  никогда не удаляет: −x ≥ A/2 → открыть; иначе → закрыть
 */
export function releaseAction({ x, v, armed, A, cancelled = false }: { x: number; v: number; armed: boolean; A: number; cancelled?: boolean }): ReleaseAction {
  const half = -x >= A * SWIPE.OPEN_FRAC;
  if (cancelled) return half ? "open" : "close";
  if (armed) return v >= SWIPE.FLICK ? "open" : "delete";
  if (v >= SWIPE.FLICK) return "close";
  if (v <= -SWIPE.FLICK && -x >= SWIPE.FLICK_MIN) return "open";
  return half ? "open" : "close";
}

/** Скорость, px/мс, по выборкам последних `FLICK_WINDOW_MS` (как у шита). */
export function velocity(samples: readonly { t: number; x: number }[], t: number, x: number): number {
  const first = samples.find((s) => t - s.t <= SWIPE.FLICK_WINDOW_MS);
  return first && t > first.t ? (x - first.x) / (t - first.t) : 0;
}
