/**
 * Строка режима на хабе Play со свайп-удалением незаконченной партии (PD-225; спецификация design/pd224-swipe-gestures.md,
 * часть A; живой эталон — design/pd224-swipe.html). Числа и решения — `swipe.ts`; здесь — указатель, DOM и фокус.
 *
 * Анатомия (§A3):
 *   .srow            обёртка — НЕ движется, ей принадлежит разделитель
 *   ├ button.hub-row.mode.fg   строка (тап — партия/шит, удержание — меню), единственный движущийся слой, фон непрозрачный
 *   └ button.del               красная «Удалить» под строкой справа; ширина = max(A, −x); у строки без партии — `hidden`
 *
 * Свайп только справа налево и только у строки с партией; короткий — строка остаётся открытой, за порог `T` — «armed», отпускание
 * удаляет (бросок никогда не удаляет, `pointercancel` тоже). Вертикаль браузер ведёт сам (`touch-action: pan-y`) и шлёт
 * `pointercancel`; до решения жеста — slop 10 px и угол 1,5 : 1. Долгое нажатие (меню) — тот же slop; у открытой строки не
 * запускается. Касание, сдвинувшееся больше slop, тапом не становится. Открытая строка на экране одна (`SwipeHub`).
 *
 * Без жеста (§A8): кнопка «Удалить» всегда в DOM сразу за строкой (VoiceOver/Voice Control: «Удалить незаконченную сетку: …»);
 * Tab со строки на неё или Delete/Backspace на строке — строка открывается (только с клавиатуры, не от касания); Enter/Space —
 * удалить, фокус уйдёт на «Отменить» тоста; Esc — закрыть, фокус на строку; ушёл фокус — закрылась.
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LONG_PRESS_MS } from "./controls";
import type { SlotSummary } from "./daySlot";
import { TrashGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import type { ModeDef } from "./modes";
import { slotMeta } from "./slotMeta";
import type { SwipeGeometry } from "./swipe";
import { SWIPE, claimGesture, dragX, nextArmed, releaseAction, swipeGeometry, velocity } from "./swipe";
import { swallowGhostClick } from "../shell/ghostClick";

const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Сдвиг пальца, после которого долгое нажатие считается прокруткой, а не нажатием. */
export const MOVE_SLOP_PX = SWIPE.SLOP;

/** Открытая строка — то, что хаб умеет закрыть. */
interface OpenRow {
  readonly el: HTMLElement;
  close(animate: boolean): void;
}

/**
 * Общее на хаб: какая строка открыта, чем был последний ввод (клавиатура открывает строку фокусом, касание — нет), и закрытие
 * открытой строки: касание вне неё (на хабе — касание поглощается, на таб-баре/шестерёнке/тосте — проходит, строка закрывается
 * мгновенно), прокрутка хаба > 4 px, скрытие страницы, повторный тап по вкладке.
 */
export interface SwipeHub {
  open: OpenRow | null;
  openScroll: number;
  lastInput: "key" | "pointer";
  /** Касание этого `pointerdown` закрыло открытую строку — строке под ним его не начинать. */
  consumed: Event | null;
  closeOpen(animate: boolean): void;
}

export function useSwipeHub(scroll: RefObject<HTMLElement | null>): SwipeHub {
  const hub = useMemo<SwipeHub>(
    () => ({
      open: null,
      openScroll: 0,
      lastInput: "pointer",
      consumed: null,
      closeOpen(animate) {
        const o = this.open;
        this.open = null;
        o?.close(animate);
      },
    }),
    [],
  );
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      hub.lastInput = "pointer";
      const o = hub.open;
      if (!o || (e.target instanceof Node && o.el.contains(e.target))) return;
      const inHub = e.target instanceof Node && scroll.current?.contains(e.target) === true;
      hub.consumed = e;
      hub.closeOpen(inHub);
      if (inHub) swallowGhostClick(e); // тап по хабу при открытой строке только закрывает её (как в iOS)
    };
    const onKey = () => {
      hub.lastInput = "key";
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") hub.closeOpen(false);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onHide);
    const el = scroll.current;
    const onScroll = () => {
      if (hub.open && el && Math.abs(el.scrollTop - hub.openScroll) > SWIPE.SCROLL_CLOSE_PX) hub.closeOpen(true);
    };
    el?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onHide);
      el?.removeEventListener("scroll", onScroll);
      hub.closeOpen(false);
    };
  }, [hub, scroll]);
  return hub;
}

/** Содержимое строки режима: значок · имя · описание или статус незавершённой игры · шеврон. `fade` — кроссфейд статус ↔ описание. */
export function ModeRowBody({ mode, slot, fade = 0 }: { mode: ModeDef; slot: SlotSummary | null; fade?: number }) {
  const { t } = useTranslation();
  const { Icon } = mode;
  const xf = fade > 0 ? " xf" : "";
  return (
    <>
      <span className="mg">
        <Icon />
      </span>
      <span className="lab">
        <span className="l1">
          <b>{t(`modes.${mode.textKey}.name`)}</b>
        </span>
        {slot ? (
          <span key={`p${fade}`} className={`sub prog${xf}`} data-testid={`mode-status-${mode.id}`}>
            <span className="dot" aria-hidden="true" />
            {t("modes.status", { meta: slotMeta(t, slot) })}
          </span>
        ) : (
          <span key={`d${fade}`} className={`sub${xf}`} data-testid={`mode-desc-${mode.id}`}>
            {/* PD-210: у режима с длинным правилом в строке списка — первое предложение (`list`), целиком — в шите. */}
            {t([`modes.${mode.textKey}.list`, `modes.${mode.textKey}.desc`])}
          </span>
        )}
      </span>
      <ChevronIcon className="chev" />
    </>
  );
}

export interface SwipeRowProps {
  readonly mode: ModeDef;
  readonly slot: SlotSummary | null;
  readonly hub: SwipeHub;
  readonly onPress: (row: HTMLButtonElement) => void;
  readonly onLongPress: (row: HTMLButtonElement) => void;
  /** Удалить партию режима (`kbd` — путь клавиатуры/AT: фокус уйдёт на «Отменить»). Строка уже вернулась на место. */
  readonly onDelete: (kbd: boolean) => void;
}

interface Drag {
  readonly id: number;
  x0: number;
  readonly y0: number;
  readonly start: number;
  claimed: boolean;
  readonly wasOpen: boolean;
  readonly edge: boolean;
  readonly samples: { t: number; x: number }[];
}

/**
 * Строка режима. Тап — `onPress`; долгое нажатие (≥ `LONG_PRESS_MS` без сдвига пальца), правая кнопка мыши или клавиша
 * контекстного меню — `onLongPress`; тап, закончивший долгое нажатие, `onPress` не вызывает. Системные выноска и лупа iOS
 * на строке подавлены в CSS (`-webkit-touch-callout`, `user-select`). Свайп и кнопка «Удалить» — только при партии (`slot`).
 */
export function SwipeRow({ mode, slot, hub, onPress, onLongPress, onDelete }: SwipeRowProps) {
  const { t } = useTranslation();
  const wrap = useRef<HTMLDivElement>(null);
  const fg = useRef<HTMLButtonElement>(null);
  const del = useRef<HTMLButtonElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Когда долгое нажатие открыло меню: хвост этого жеста (click, contextmenu) — не новый тап. */
  const firedAt = useRef<number | null>(null);
  const drag = useRef<Drag | null>(null);
  /** Этот click — хвост жеста (свайп, сдвиг > slop): не тап. Хвост касания открытой строки гасит `swallowGhostClick`. */
  const suppress = useRef(false);
  const moved = useRef<{ x: number; y: number; far: boolean } | null>(null);
  const geom = useRef<SwipeGeometry | null>(null);
  const x = useRef(0);
  const armed = useRef(false);
  const isOpen = useRef(false);
  /** Открыта с клавиатуры (фокус на «Удалить»): уход фокуса закрывает. */
  const kb = useRef(false);
  const has = slot !== null;
  const hasRef = useRef(has);
  hasRef.current = has;

  // Удаление: красный слой остаётся, пока строка возвращается на место (§A3), и только потом снимается.
  const [committing, setCommitting] = useState(false);
  // Кроссфейд статус ↔ описание — только при смене после монтирования (не при каждом показе хаба).
  const [fade, setFade] = useState(0);
  const prevHas = useRef(has);
  useEffect(() => {
    if (prevHas.current === has) return;
    prevHas.current = has;
    setFade((n) => n + 1);
  }, [has]);

  const stopPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  const commitTimer = useRef(0);
  useEffect(
    () => () => {
      stopPress();
      window.clearTimeout(commitTimer.current);
    },
    [],
  );

  const measure = (): SwipeGeometry => {
    const w = wrap.current;
    if (!w) return swipeGeometry(0, 0);
    w.classList.remove("icon-only");
    const label = w.querySelector<HTMLElement>(".dl")?.scrollWidth ?? 0;
    const g = swipeGeometry(w.clientWidth, label);
    w.classList.toggle("icon-only", g.iconOnly);
    w.style.setProperty("--aw", `${g.A}px`);
    geom.current = g;
    return g;
  };

  /** Сдвиг строки (`ms` — доводка; при Reduce Motion — мгновенно). Ведение пальцем — всегда 1:1, без анимации. */
  const setX = (next: number, ms = 0) => {
    const g = geom.current ?? measure();
    const f = fg.current;
    const d = del.current;
    x.current = next;
    const dur = prefersReducedMotion() ? 0 : ms;
    const ease = `${dur}ms var(--e-spring)`;
    if (f) {
      f.style.transition = dur ? `transform ${ease}` : "none";
      f.style.transform = next ? `translateX(${next}px)` : "";
    }
    if (d) {
      const w = Math.max(g.A, -next);
      d.style.transition = dur ? `width ${ease}` : "none";
      d.style.width = `${w}px`;
      const lab = d.firstElementChild as HTMLElement | null;
      if (lab) lab.style.transform = armed.current ? `translateX(${-(w - g.A)}px)` : "";
    }
  };
  const setArmed = (on: boolean) => {
    if (armed.current === on) return;
    armed.current = on;
    wrap.current?.classList.toggle("armed", on);
    const lab = del.current?.firstElementChild as HTMLElement | null;
    if (lab) lab.style.transition = prefersReducedMotion() ? "none" : `transform ${SWIPE.LABEL_MS}ms var(--e-out)`;
  };

  // Ручка для хаба: стабильная (хаб хранит её как «открытую строку»), закрывает через свежую `closeRow`.
  const closeRef = useRef<(animate: boolean) => void>(() => undefined);
  const handle = useMemo<OpenRow>(
    () => ({
      get el() {
        return wrap.current as HTMLElement;
      },
      close: (animate: boolean) => closeRef.current(animate),
    }),
    [],
  );
  function openRow() {
    if (hub.open && hub.open !== handle) hub.closeOpen(true);
    const g = measure();
    setArmed(false);
    setX(-g.A, SWIPE.SETTLE_MS);
    isOpen.current = true;
    hub.open = handle;
    const sc = wrap.current?.closest(".hub-scroll");
    hub.openScroll = sc ? sc.scrollTop : 0;
  }
  function closeRow(animate: boolean) {
    setArmed(false);
    setX(0, animate ? SWIPE.SETTLE_MS : 0);
    isOpen.current = false;
    kb.current = false;
    if (hub.open === handle) hub.open = null;
  }
  closeRef.current = closeRow;
  const commit = (kbd: boolean) => {
    if (!hasRef.current) return;
    if (hub.open === handle) hub.open = null;
    isOpen.current = false;
    kb.current = false;
    setArmed(false);
    setX(0, SWIPE.COMMIT_MS);
    const ms = prefersReducedMotion() ? 0 : SWIPE.COMMIT_MS;
    window.clearTimeout(commitTimer.current);
    if (ms > 0) {
      setCommitting(true);
      commitTimer.current = window.setTimeout(() => setCommitting(false), ms);
    }
    onDelete(kbd);
  };

  const fireLongPress = () => {
    firedAt.current = Date.now();
    drag.current = null;
    if (fg.current) onLongPress(fg.current);
  };

  const finishDrag = (e: ReactPointerEvent<HTMLButtonElement>, cancelled: boolean) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.id !== e.pointerId) return;
    if (!d.claimed) {
      // Тап по открытой строке закрывает её и партию не открывает: его click гасит `swallowGhostClick` с pointerdown.
      if (d.wasOpen && !cancelled) closeRow(true);
      return;
    }
    suppress.current = true; // свайп никогда не становится тапом
    window.setTimeout(() => (suppress.current = false), 0);
    wrap.current?.classList.remove("dragging");
    try {
      fg.current?.releasePointerCapture?.(e.pointerId);
    } catch {
      /* уже отпущен */
    }
    const g = geom.current ?? measure();
    const v = cancelled ? 0 : velocity(d.samples, e.timeStamp, e.clientX);
    const act = releaseAction({ x: x.current, v, armed: armed.current, A: g.A, cancelled });
    if (act === "delete") commit(false);
    else if (act === "open") openRow();
    else closeRow(true);
  };

  return (
    <div ref={wrap} className="srow" data-slot={has ? "1" : "0"} data-testid={`srow-${mode.id}`}>
      <button
        ref={fg}
        type="button"
        className="hub-row mode fg"
        onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
          stopPress();
          firedAt.current = null;
          moved.current = { x: e.clientX, y: e.clientY, far: false };
          if (e.button !== 0) return;
          if (hub.consumed === e.nativeEvent) return; // это касание закрыло другую открытую строку — и только
          if (drag.current) return; // второй палец игнорируется, пока первый ведёт жест
          const wasOpen = isOpen.current;
          const vw = document.documentElement.clientWidth || window.innerWidth;
          drag.current = {
            id: e.pointerId,
            x0: e.clientX,
            y0: e.clientY,
            start: x.current,
            claimed: false,
            wasOpen,
            edge: e.clientX <= SWIPE.EDGE || vw - e.clientX <= SWIPE.EDGE,
            samples: [{ t: e.timeStamp, x: e.clientX }],
          };
          if (wasOpen) {
            // PD-242: касание открытой строки только закрывает её. click тача приходит через 2–6 мс после pointerup —
            // флаг `suppress` с setTimeout(0) его не ловил; перехватчик живёт до следующего касания / 350 мс после отпускания.
            swallowGhostClick(e.nativeEvent);
            return; // у открытой строки долгое нажатие не запускается
          }
          press.current = {
            timer: window.setTimeout(() => {
              press.current = null;
              fireLongPress();
            }, LONG_PRESS_MS),
            x: e.clientX,
            y: e.clientY,
          };
        }}
        onPointerMove={(e) => {
          const m = moved.current;
          if (m && !m.far && Math.hypot(e.clientX - m.x, e.clientY - m.y) > SWIPE.SLOP) m.far = true;
          const p = press.current;
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP_PX) stopPress(); // это прокрутка, а не нажатие
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          if (!d.claimed) {
            const who = claimGesture(e.clientX - d.x0, e.clientY - d.y0);
            if (who === "scroll") {
              drag.current = null; // вертикаль — прокрутке до конца касания
              return;
            }
            if (who === "undecided") return;
            if (!hasRef.current || d.edge || (!d.wasOpen && e.clientX - d.x0 > 0)) {
              drag.current = null;
              return;
            }
            d.claimed = true;
            d.x0 = e.clientX; // ведём отсюда: без скачка на slop
            stopPress();
            if (hub.open && hub.open !== handle) hub.closeOpen(true);
            wrap.current?.classList.add("dragging");
            measure();
            try {
              fg.current?.setPointerCapture?.(e.pointerId);
            } catch {
              /* без захвата события всё равно идут, пока палец над строкой */
            }
          }
          const g = geom.current ?? measure();
          const next = dragX(d.start, e.clientX - d.x0, d.wasOpen, g.W);
          setArmed(nextArmed(armed.current, next, g.T));
          setX(next);
          d.samples.push({ t: e.timeStamp, x: e.clientX });
          if (d.samples.length > 12) d.samples.shift();
        }}
        onPointerUp={(e) => {
          stopPress();
          if (moved.current?.far && firedAt.current === null) {
            suppress.current = true; // касание, сдвинувшееся больше slop, тапом не становится (мышь; тач и так не кликает)
            window.setTimeout(() => (suppress.current = false), 0);
          }
          moved.current = null;
          finishDrag(e, false);
        }}
        onPointerLeave={() => {
          if (!drag.current?.claimed) stopPress();
        }}
        onPointerCancel={(e) => {
          stopPress();
          moved.current = null;
          finishDrag(e, true);
        }}
        onContextMenu={(e: ReactMouseEvent) => {
          // iOS/Android отдают долгий тап и как contextmenu; мышь — правой кнопкой; клавиатура — клавишей меню/Shift+F10.
          e.preventDefault();
          stopPress();
          if (drag.current?.claimed) return; // идёт свайп
          drag.current = null;
          if (firedAt.current !== null && Date.now() - firedAt.current < 1500) return; // меню уже открыто таймером
          if (isOpen.current) closeRow(false);
          fireLongPress();
        }}
        onBlur={(e) => {
          // Открыта с клавиатуры, а фокус уходит со строки мимо её «Удалить» — закрыть (пара .fg/.del покинута).
          if (!kb.current || e.relatedTarget === del.current) return;
          closeRow(true);
        }}
        onKeyDown={(e) => {
          if ((e.key === "Delete" || e.key === "Backspace") && hasRef.current && !e.metaKey && !e.ctrlKey && !e.altKey) {
            e.preventDefault();
            hub.lastInput = "key";
            del.current?.focus(); // фокус на «Удалить» открывает строку
          }
        }}
        onClick={(e) => {
          const tail = firedAt.current !== null && e.detail !== 0;
          firedAt.current = null;
          if (tail) return; // тап, закончивший долгое нажатие
          if (suppress.current && e.detail !== 0) {
            suppress.current = false;
            return;
          }
          if (isOpen.current) {
            closeRow(true);
            return;
          }
          if (fg.current) onPress(fg.current);
        }}
        data-testid={`mode-${mode.id}`}
      >
        <ModeRowBody mode={mode} slot={slot} fade={fade} />
      </button>
      <button
        ref={del}
        type="button"
        className="del"
        hidden={!has && !committing}
        aria-label={t("modes.deleteA11y", { mode: t(`modes.${mode.textKey}.name`) })}
        onFocus={() => {
          if (hub.lastInput !== "key" || !hasRef.current) return; // фокус от касания — не путь клавиатуры
          openRow();
          kb.current = true;
        }}
        onBlur={() => {
          // PD-242: строка открыта, пока фокус на «Удалить»; ушёл куда угодно — в т. ч. Shift+Tab на свою строку — закрылась.
          if (kb.current) closeRow(true);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          e.stopPropagation();
          closeRow(true);
          fg.current?.focus();
        }}
        onClick={(e) => commit(e.detail === 0 || kb.current)}
        data-testid={`del-${mode.id}`}
      >
        <span className="dlw">
          <TrashGlyph />
          <span className="dl">{t("modes.delete")}</span>
        </span>
      </button>
    </div>
  );
}
