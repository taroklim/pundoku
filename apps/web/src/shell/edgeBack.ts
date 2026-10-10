/**
 * PD-253: жест «назад» от левого края на Settings и справке (спецификация design/pd224-swipe-gestures.md, часть B, первая
 * строка таблицы). Только в установленном приложении (standalone): в Safari-вкладке у системы свой «назад» от края — наш дал
 * бы двойной переход. Жест — дополнение к «‹» и Esc, не замена: VoiceOver/клавиатура ходят кнопкой.
 *
 * Параметры (часть B): старт в полосе 0–`EDGE` px от левого края слоя; захват при `dx ≥ CLAIM` под углом ≤ `MAX_ANGLE_DEG`;
 * до захвата вертикаль или ход влево больше `SLOP` — жест не наш до конца касания (вертикаль ведёт браузер: на слое
 * `touch-action: pan-y`, он сам шлёт `pointercancel`). После захвата экран едет за пальцем 1:1; отпустили дальше
 * `COMMIT_FRAC` ширины или бросили вправо (≥ `FLICK` px/мс) — «назад», иначе (и при `pointercancel`, и при броске влево)
 * экран возвращается на место. Reduce Motion (`--mo: 0`) — экран за пальцем не едет; решение то же, переход мгновенный.
 *
 * «Назад» — ровно то, что «‹»/Esc (App): справка → Settings (с позицией прокрутки) или вкладка-источник; Settings —
 * через guard PD-57: показан несохранённый ключ → экран возвращается на место и всплывает шит «Ключ ещё не сохранён».
 * Пока экран едет, под ним видна вкладка, куда ведёт «назад» (`peek`; у справки, открытой из Settings, — пустой фон: Settings
 * под ней не смонтирован).
 *
 * Только чистые функции решения (`edgeClaim`, `shouldGoBack`) покрыты юнит-тестом; хук ведёт указатель и DOM.
 */
import type { RefObject } from "react";
import { useEffect, useLayoutEffect, useRef } from "react";
import { overlayOpen } from "./escapeBack";
import { swallowGhostClick } from "./ghostClick";
import { motionReduced, PEEK_ATTR } from "./tabSlide";

export const EDGE_BACK = {
  /** Полоса старта у левого края, px. */
  EDGE: 16,
  /** Захват: палец ушёл вправо на столько, px… */
  CLAIM: 24,
  /** …под углом не круче этого к горизонтали. */
  MAX_ANGLE_DEG: 30,
  /** До захвата: вертикаль (круче угла) или ход влево больше этого — жест не наш. */
  SLOP: 10,
  /** Порог «назад» по дистанции — доля ширины экрана. */
  COMMIT_FRAC: 0.35,
  /** Бросок, px/мс по последним `FLICK_WINDOW_MS`: вправо — «назад» с любой дистанции после захвата, влево — отмена. */
  FLICK: 0.3,
  FLICK_WINDOW_MS: 100,
  /** Доводка (уезд/возврат), мс. */
  SETTLE_MS: 220,
  /** Страховка: «назад» вызван, а маршрут не сменился за это время — экран возвращается на место. */
  FALLBACK_MS: 700,
} as const;

const TAN = Math.tan((EDGE_BACK.MAX_ANGLE_DEG * Math.PI) / 180);

/** Атрибут слоя: жест включён (shell.css даёт слою `touch-action: pan-y`). */
export const EDGE_ATTR = "data-edge-back";
/** Атрибут слоя на время ведения и доводки (тень по левому краю). */
export const DRAG_ATTR = "data-edge-drag";

/** Установленное приложение: iOS (`navigator.standalone`) или `display-mode: standalone` (манифест). */
export function isStandalone(): boolean {
  if ((navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
  return typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
}

/** Чей жест до захвата: `back` — наш; `abandon` — не наш до конца касания; `undecided` — ждём дальше. */
export function edgeClaim(dx: number, dy: number): "undecided" | "back" | "abandon" {
  const ay = Math.abs(dy);
  if (dx >= EDGE_BACK.CLAIM) return ay <= dx * TAN ? "back" : "abandon";
  if (dx <= -EDGE_BACK.SLOP) return "abandon";
  if (ay >= EDGE_BACK.SLOP && ay > Math.max(dx, 0) * TAN) return "abandon";
  return "undecided";
}

/** Решение по отпусканию: `x` — сдвиг экрана, `width` — ширина экрана, `v` — скорость пальца по X, px/мс. */
export function shouldGoBack(x: number, width: number, v: number): boolean {
  if (x <= 0) return false;
  if (v <= -EDGE_BACK.FLICK) return false;
  if (v >= EDGE_BACK.FLICK) return true;
  return x >= EDGE_BACK.COMMIT_FRAC * width;
}

/**
 * Скорость на отпускании, px/мс: по движениям пальца за последние `FLICK_WINDOW_MS` до отпускания — от первого до последнего
 * (само отпускание не в счёт: оно приходит с последней точкой и с задержкой, и разбавляло бы бросок). Палец постоял дольше
 * окна — в окне меньше двух точек — скорость 0.
 */
export function releaseVelocity(samples: readonly { t: number; x: number }[], t: number): number {
  const recent = samples.filter((s) => t - s.t <= EDGE_BACK.FLICK_WINDOW_MS);
  const first = recent[0];
  const last = recent.at(-1);
  return first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
}

export interface EdgeBackOptions {
  /** Жест включён: открыт Settings/справка и приложение установлено. */
  readonly enabled: boolean;
  /** Ключ экрана слоя: его смена = переход состоялся, слой возвращается в покой. */
  readonly screen: string;
  /** «Назад» ведёт на вкладку — показать её под экраном во время жеста. */
  readonly peek: boolean;
  /** Перед уходом: `true` — уход перехвачен (шит guard PD-57 уже показан), экран возвращается. */
  readonly intercept: () => boolean;
  /** Сам «назад» — то же, что «‹». */
  readonly onBack: () => void;
}

interface Gesture {
  readonly id: number;
  readonly x0: number;
  readonly y0: number;
  readonly down: PointerEvent;
  claimed: boolean;
  width: number;
  x: number;
  readonly samples: { t: number; x: number }[];
}

type Phase = "idle" | "drag" | "settle" | "leaving";

/**
 * Жест на слое `layer` (`.push-layer`); `under` — стопка вкладок под ним (для `peek`). Слушатель старта — на самом слое;
 * move/up и второй палец (pointerdown, фаза захвата) — на документе, пока палец на экране. Переход (смена `screen`) снимает с слоя всё inline-состояние жеста.
 */
export function useEdgeBack(layer: RefObject<HTMLElement | null>, under: RefObject<HTMLElement | null>, options: EdgeBackOptions): void {
  const opts = useRef(options);
  opts.current = options;
  const g = useRef<Gesture | null>(null);
  const phase = useRef<Phase>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const unlisten = useRef<(() => void) | null>(null);
  /** pointerdown второго пальца, уже отменивший жест (PD-286) — слушатель слоя его не повторяет и не начинает с ним жест. */
  const secondDown = useRef<PointerEvent | null>(null);

  // Один набор функций на весь срок жизни хука: они читают только ref'ы.
  const api = useRef<{ reset: () => void; down: (e: PointerEvent) => void } | null>(null);
  if (api.current === null) {
    const setShift = (x: number, width: number) => {
      const el = layer.current;
      if (el) el.style.transform = x > 0 ? `translate3d(${x}px, 0, 0)` : "";
      under.current?.style.setProperty("--edge-p", width > 0 ? String(Math.min(1, x / width)) : "0");
    };
    const reset = () => {
      clearTimeout(timer.current);
      timer.current = undefined;
      unlisten.current?.();
      g.current = null;
      phase.current = "idle";
      const el = layer.current;
      if (el) {
        el.style.transform = "";
        el.style.transition = "";
        el.removeAttribute(DRAG_ATTR);
      }
      const u = under.current;
      if (u) {
        u.removeAttribute(PEEK_ATTR);
        u.style.removeProperty("--edge-p");
      }
    };
    const settleTo = (x: number, width: number, then: () => void) => {
      const el = layer.current;
      if (el) el.style.transition = `transform ${EDGE_BACK.SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      setShift(x, width);
      clearTimeout(timer.current);
      timer.current = setTimeout(then, EDGE_BACK.SETTLE_MS);
    };
    const leave = () => {
      phase.current = "leaving";
      opts.current.onBack();
      // Маршрут сменится (history.back() — асинхронно) и смена `screen` вернёт слой в покой; не сменился — вернуть самим.
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (phase.current === "leaving") reset();
      }, EDGE_BACK.FALLBACK_MS);
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      const cur = g.current;
      unlisten.current?.();
      g.current = null;
      if (!cur || !cur.claimed) {
        if (phase.current === "drag") reset();
        return;
      }
      const x = Math.max(0, e.clientX - cur.x0);
      const v = releaseVelocity(cur.samples, e.timeStamp);
      let back = !cancelled && shouldGoBack(x, cur.width, v);
      // Settings с несохранённым ключом: шит guard PD-57 показан — экран остаётся.
      if (back && opts.current.intercept()) back = false;
      const reduced = motionReduced();
      if (back) {
        if (reduced) return leave();
        phase.current = "settle";
        settleTo(cur.width, cur.width, leave);
        return;
      }
      if (reduced || cur.x === 0) return reset();
      phase.current = "settle";
      settleTo(0, cur.width, reset);
    };
    const move = (e: PointerEvent) => {
      const cur = g.current;
      if (!cur || e.pointerId !== cur.id) return;
      const dx = e.clientX - cur.x0;
      const dy = e.clientY - cur.y0;
      if (!cur.claimed) {
        const verdict = edgeClaim(dx, dy);
        if (verdict === "undecided") return;
        if (verdict === "abandon") {
          unlisten.current?.();
          g.current = null;
          return;
        }
        const el = layer.current;
        if (!el) return reset();
        cur.claimed = true;
        cur.width = el.clientWidth || window.innerWidth;
        phase.current = "drag";
        swallowGhostClick(cur.down); // хвост касания (click под пальцем на отпускании) — не тап
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* без захвата события всё равно идут через документ */
        }
        if (!motionReduced()) {
          el.style.transition = "none";
          el.setAttribute(DRAG_ATTR, "");
          if (opts.current.peek) under.current?.setAttribute(PEEK_ATTR, "");
        }
      }
      cur.x = Math.max(0, dx);
      cur.samples.push({ t: e.timeStamp, x: cur.x });
      if (cur.samples.length > 12) cur.samples.shift();
      if (!motionReduced()) setShift(cur.x, cur.width);
    };
    // Второй палец посреди жеста — жест отменяется, где бы палец ни лёг (PD-286: и на таб-баре вне слоя). Слушатель — на
    // документе в фазе захвата, пока ведётся касание: до обработчиков таб-бара и до слушателя самого слоя.
    const second = (e: PointerEvent) => {
      const cur = g.current;
      if (!cur || e.pointerId === cur.id) return;
      secondDown.current = e;
      finish(e, true);
    };
    const down = (e: PointerEvent) => {
      if (e === secondDown.current) return; // этот же второй палец уже отменил жест (слой — ниже по всплытию)
      if (g.current) {
        if (e.pointerId !== g.current.id) finish(e, true);
        return;
      }
      if (phase.current !== "idle") return;
      if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
      const el = layer.current;
      if (!el || !opts.current.enabled || overlayOpen()) return;
      if (e.clientX - el.getBoundingClientRect().left > EDGE_BACK.EDGE) return;
      g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, down: e, claimed: false, width: 0, x: 0, samples: [{ t: e.timeStamp, x: 0 }] };
      const id = e.pointerId;
      const up = (ev: PointerEvent) => ev.pointerId === id && finish(ev, false);
      const cancel = (ev: PointerEvent) => ev.pointerId === id && finish(ev, true);
      document.addEventListener("pointerdown", second, true);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      unlisten.current = () => {
        document.removeEventListener("pointerdown", second, true);
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
        unlisten.current = null;
      };
    };
    api.current = { reset, down };
  }

  const { enabled, screen } = options;
  useEffect(() => {
    const el = layer.current;
    const { down, reset } = api.current!;
    if (!enabled || !el) return;
    el.addEventListener("pointerdown", down);
    return () => {
      el.removeEventListener("pointerdown", down);
      reset();
    };
  }, [enabled, layer]);

  // Переход состоялся (или экран сменился посреди жеста) — слой в покой. Layout: до кадра с новым экраном, иначе мигнул бы
  // уехавший экран; ПОСЛЕ движка вкладок (useTabSlide в App вызван раньше) — он видит `peek` и не играет повторный вход вкладки.
  useLayoutEffect(() => {
    if (phase.current !== "idle") api.current!.reset();
  }, [screen]);
  useLayoutEffect(() => () => api.current!.reset(), []);
}
