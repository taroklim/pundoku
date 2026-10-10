/**
 * PD-285 (design/pd285-result-card.md §4 A, §6): док действий карточки «решено» в Play на телефоне. «Watch your solve» во всю
 * ширину и ряд «Share | New puzzle» прилипают к таб-бару (sticky), карточка прокручивается под ними. Кнопки рендерит
 * `ResultCard` (одна копия в DOM, testid прежние) — при включённом доке порталом в `div.result-dock`, который `PlayScreen` ставит
 * сразу после карточки.
 *
 * Где дока НЕТ (кнопки в конце карточки, как раньше): AX3 и крупнее (`html[data-type="ax3"]`, shell/dynamicType.ts — док с
 * подписями в 2–3 строки съел бы полэкрана), ландшафт телефона (то же условие, что landscape.css), десктоп C (карточка в
 * инспекторе), Today/архив/Year (там `ResultCard` без дока). Условие считается здесь, в одном месте; CSS смотрит на класс
 * `.play-result-dock` у корня экрана и на сам `.result-dock`, второго источника правды в @media нет.
 */
import { useEffect, useSyncExternalStore } from "react";

/** Ландшафт телефона — ровно условие landscape.css (PD-249). */
export const DOCK_LANDSCAPE_QUERY = "(orientation: landscape) and (max-height: 500px)";

export interface ResultDockEnv {
  /** Карточка «решено» стоит на экране Play вместо поля (телефонная раскладка, не десктоп C). */
  readonly phoneCard: boolean;
  /** `html[data-type="ax3"]` — 1rem ≥ 36 px (AX3 и крупнее). */
  readonly ax3: boolean;
  /** Ландшафт телефона (`DOCK_LANDSCAPE_QUERY`). */
  readonly landscape: boolean;
}

/** Включён ли док: только телефонная карточка Play, не AX3 и не ландшафт телефона. */
export const resultDockOn = ({ phoneCard, ax3, landscape }: ResultDockEnv): boolean => phoneCard && !ax3 && !landscape;

const landscapeList = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DOCK_LANDSCAPE_QUERY) : null;

function subscribeLandscape(cb: () => void): () => void {
  const mq = landscapeList();
  if (!mq) return () => undefined;
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }
  mq.addListener(cb); // Safari до 14
  return () => mq.removeListener(cb);
}
const readLandscape = (): boolean => landscapeList()?.matches === true;

/** Атрибут `data-type` на <html> ставит `useDynamicTypeFlag` (зонд 1rem) — следим за ним, а не меряем второй раз. */
function subscribeAx3(cb: () => void): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") return () => undefined;
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-type"] });
  return () => mo.disconnect();
}
const readAx3 = (): boolean => typeof document !== "undefined" && document.documentElement.getAttribute("data-type") === "ax3";
const serverFalse = () => false;

/**
 * Включён ли док для карточки «решено» Play. `phoneCard` — `cardView && !desk` экрана. Смена ориентации или размера текста
 * переносит кнопки между доком и карточкой без перезагрузки.
 */
export function useResultDock(phoneCard: boolean): boolean {
  const landscape = useSyncExternalStore(subscribeLandscape, readLandscape, serverFalse);
  const ax3 = useSyncExternalStore(subscribeAx3, readAx3, serverFalse);
  return resultDockOn({ phoneCard, ax3, landscape });
}

/**
 * Фокус не прячется под док (WCAG 2.4.11). Высота дока → `--dock-h` на корне экрана (родитель дока, `.play`): от неё элементы
 * карточки держат `scroll-margin-bottom` (play.css). Но браузер при фокусе прокручивает только «если не виден», а элемент под
 * доком для него виден (док — внутри той же прокрутки), поэтому фокус внутри карточки, попавший под док, докручивается сам:
 * `scrollIntoView` block "end" с тем же scroll-margin — элемент встаёт на 16 px выше дока («nearest» Chromium не прокручивает:
 * без учёта scroll-margin элемент для него и так в области прокрутки). Нет дока — всё снимается.
 */
export function useDockSupport(dock: HTMLElement | null): void {
  useEffect(() => {
    const screen = dock?.parentElement ?? null;
    if (!dock || !screen) return;
    const write = () => screen.style.setProperty("--dock-h", `${Math.round(dock.getBoundingClientRect().height)}px`);
    write();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(write);
    ro?.observe(dock);
    const onFocus = (e: FocusEvent) => {
      const el = e.target;
      if (!(el instanceof HTMLElement) || dock.contains(el) || !el.closest(".card") || el.classList.contains("card")) return;
      if (el.getBoundingClientRect().bottom > dock.getBoundingClientRect().top) el.scrollIntoView({ block: "end", inline: "nearest" });
    };
    screen.addEventListener("focusin", onFocus);
    return () => {
      ro?.disconnect();
      screen.removeEventListener("focusin", onFocus);
      screen.style.removeProperty("--dock-h");
    };
  }, [dock]);
}
