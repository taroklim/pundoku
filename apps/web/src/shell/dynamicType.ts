/**
 * Крупный Dynamic Type для CSS (PD-144). `@media` не видит размер шрифта пользователя, а ряд действий на узком экране
 * при AX3 (40 px вместо 17) должен перейти на «только иконки» (макет §4.3). Поэтому размер читается из раскладки: зонд
 * шириной `1rem` — и на `<html>` ставится `data-type="ax3"`, когда 1rem >= 36 px. Типографика НЕ ограничивается: атрибут
 * только переключает раскладку (AX4/AX5 тоже попадают — там то же «только иконки», но не шрифт меньше).
 */
import { useEffect } from "react";

/** С какого размера 1rem считается «AX3 и крупнее». iOS: 17 (по умолчанию) → 23 (xxxL) → 40 (AX3). */
export const AX3_MIN_PX = 36;

export const isAx3 = (remPx: number): boolean => remPx >= AX3_MIN_PX;

export function applyDynamicType(root: HTMLElement, remPx: number): void {
  if (isAx3(remPx)) root.setAttribute("data-type", "ax3");
  else root.removeAttribute("data-type");
}

/** Следит за размером шрифта на всё время жизни приложения (ResizeObserver на зонде, `resize`, возврат на страницу). */
export function useDynamicTypeFlag(): void {
  useEffect(() => {
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:absolute;visibility:hidden;pointer-events:none;width:1rem;height:0;overflow:hidden";
    document.body.appendChild(probe);
    const measure = () => {
      const w = probe.getBoundingClientRect().width;
      if (w > 0) applyDynamicType(document.documentElement, w);
    };
    measure();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(probe);
    window.addEventListener("resize", measure);
    document.addEventListener("visibilitychange", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      document.removeEventListener("visibilitychange", measure);
      probe.remove();
      document.documentElement.removeAttribute("data-type");
    };
  }, []);
}
