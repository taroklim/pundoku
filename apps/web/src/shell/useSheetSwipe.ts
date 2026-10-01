import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";

/**
 * Закрытие шита жестом вниз (PD-85; HIG sheets.md: «Support swiping to dismiss a sheet»). Обработчики вешаются на
 * «ручку» шита: grabber и заголовок (у них `touch-action: none` через класс `.sheet-handle`, поэтому прокрутка
 * содержимого шита не страдает — жест начинается только там, где прокручивать нечего).
 *
 * Порог как у системных шитов: отпустили ниже `DISMISS_FRACTION` высоты шита (но не меньше `DISMISS_MIN_PX`) ИЛИ бросок
 * со скоростью ≥ `FLICK_PX_PER_MS` вниз → шит уезжает и закрывается; иначе возвращается на место. Шит едет за пальцем
 * 1:1 (прямое манипулирование, не анимация). При Reduce Motion возврат и закрытие мгновенные, без анимации.
 * Тап по кнопке в ручке (Done/Cancel) работает как обычно: жест «включается» только после сдвига вниз на `SLOP_PX`.
 */
export const SLOP_PX = 8;
export const DISMISS_FRACTION = 0.25;
export const DISMISS_MIN_PX = 64;
export const FLICK_PX_PER_MS = 0.5;
export const SETTLE_MS = 200;

export interface SheetSwipeHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: React.MouseEvent<HTMLElement>) => void;
}

/** Решение по отпусканию: закрыть шит или вернуть. Вынесено для юнит-теста. */
export function shouldDismiss(dy: number, height: number, velocityPxPerMs: number): boolean {
  if (dy <= 0) return false;
  return dy >= Math.max(DISMISS_MIN_PX, height * DISMISS_FRACTION) || (velocityPxPerMs >= FLICK_PX_PER_MS && dy >= SLOP_PX * 2);
}

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useSheetSwipe(sheet: RefObject<HTMLElement | null>, onClose: () => void): SheetSwipeHandlers {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const gesture = useRef<{ id: number; handle: HTMLElement; x0: number; y0: number; dragging: boolean; samples: { t: number; y: number }[] } | null>(null);
  const unlisten = useRef<(() => void) | null>(null);
  const suppressClick = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      unlisten.current?.();
    },
    [],
  );

  const finish = useCallback(
    (e: PointerEvent, cancelled: boolean) => {
      const g = gesture.current;
      gesture.current = null;
      unlisten.current?.();
      const el = sheet.current;
      if (!g || !g.dragging || !el) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      try {
        g.handle.releasePointerCapture(g.id);
      } catch {
        /* уже отпущен */
      }
      const dy = Math.max(0, e.clientY - g.y0);
      const recent = g.samples.filter((s) => e.timeStamp - s.t <= 100);
      const first = recent[0];
      const velocity = first && e.timeStamp > first.t ? (e.clientY - first.y) / (e.timeStamp - first.t) : 0;
      const dismiss = !cancelled && shouldDismiss(dy, el.getBoundingClientRect().height, velocity);
      const animate = !reducedMotion();
      el.style.transition = animate ? `transform ${SETTLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)` : "none";
      if (dismiss) {
        el.style.transform = "translateY(101%)";
        // Шит остаётся «за экраном» (inline transform) до размонтирования: возврат на место мигнул бы.
        clearTimeout(timer.current);
        timer.current = setTimeout(() => closeRef.current(), animate ? SETTLE_MS : 0);
      } else {
        el.style.transform = "";
        clearTimeout(timer.current);
        timer.current = setTimeout(
          () => {
            el.style.transition = "";
          },
          animate ? SETTLE_MS : 0,
        );
      }
    },
    [sheet],
  );

  // Move/up слушаем на документе: мышь может выйти за пределы ручки между двумя событиями (до того, как сработает захват
  // указателя), а у касаний неявный захват и так есть. Слушатели живут только пока палец/кнопка нажаты.
  const move = useCallback(
    (e: PointerEvent) => {
      const g = gesture.current;
      const el = sheet.current;
      if (!g || g.id !== e.pointerId || !el) return;
      const dy = e.clientY - g.y0;
      const dx = e.clientX - g.x0;
      if (!g.dragging) {
        if (Math.abs(dx) > SLOP_PX && Math.abs(dx) > Math.abs(dy)) {
          gesture.current = null; // горизонтальный жест — не наш
          unlisten.current?.();
          return;
        }
        if (dy < SLOP_PX) return;
        g.dragging = true;
        clearTimeout(timer.current);
        try {
          g.handle.setPointerCapture(e.pointerId);
        } catch {
          /* нет захвата — события всё равно идут через документ */
        }
        el.style.transition = "none";
      }
      g.samples.push({ t: e.timeStamp, y: e.clientY });
      if (g.samples.length > 12) g.samples.shift();
      el.style.transform = `translateY(${Math.max(0, dy)}px)`;
    },
    [sheet],
  );

  return {
    onPointerDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (gesture.current) return;
      gesture.current = { id: e.pointerId, handle: e.currentTarget, x0: e.clientX, y0: e.clientY, dragging: false, samples: [{ t: e.timeStamp, y: e.clientY }] };
      const id = e.pointerId;
      const up = (ev: PointerEvent) => ev.pointerId === id && finish(ev, false);
      const cancel = (ev: PointerEvent) => ev.pointerId === id && finish(ev, true);
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      unlisten.current = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", cancel);
        unlisten.current = null;
      };
    },
    onClickCapture(e) {
      if (suppressClick.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    },
  };
}
