import type { RefObject } from "react";
import { useEffect } from "react";

/** Страховка для `afterPaint`: если кадр не пришёл (вкладка в фоне, главный поток занят) — всё равно выполняемся. */
export const AFTER_PAINT_SAFETY_MS = 200;

/**
 * Выполнить `cb` ПОСЛЕ ближайшего кадра (PD-95): `requestAnimationFrame` (до отрисовки) → `setTimeout(0)` (после неё).
 * К этому моменту раскладка чистая — чтение `getBoundingClientRect`/`scrollIntoView`/`focus` не вызывает принудительный
 * layout, а тяжёлая запись в DOM попадает в отдельную задачу, а не в ту же, что только что смонтировала карточку.
 * Без `requestIdleCallback`: в WebKit/iOS его нет, а idle-слот на нагруженной странице может не прийти никогда.
 * Страховочный таймер срабатывает, если rAF не приходит (скрытая вкладка). Возвращает отмену.
 */
export function afterPaint(cb: () => void): () => void {
  let done = false;
  let raf = 0;
  let after = 0;
  let safety = 0;
  const cancel = () => {
    done = true;
    if (raf) cancelAnimationFrame(raf);
    window.clearTimeout(after);
    window.clearTimeout(safety);
  };
  const run = () => {
    if (done) return;
    cancel();
    cb();
  };
  if (typeof requestAnimationFrame === "function") {
    raf = requestAnimationFrame(() => {
      raf = 0;
      after = window.setTimeout(run, 0);
    });
  }
  safety = window.setTimeout(run, AFTER_PAINT_SAFETY_MS);
  return cancel;
}

/**
 * Фокус на карточку результата (a11y: скринридер объявляет заголовок) — не в той же задаче, что смонтировал карточку
 * (`focus()` сразу после записи в DOM форсирует style+layout свежего поддерева), а после ближайшего кадра, и только когда
 * `active` (финал закончился: не красть фокус посреди анимации). `preventScroll` — экран не должен прыгать.
 */
export function useDeferredFocus(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return afterPaint(() => ref.current?.focus({ preventScroll: true }));
  }, [ref, active]);
}
