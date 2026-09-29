import { useCallback, useEffect, useState } from "react";

export const TAB_IDS = ["today", "play", "year"] as const;
export type TabId = (typeof TAB_IDS)[number];

const DEFAULT_TAB: TabId = "today";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

/** `#/today|play|year` → вкладка; всё остальное → Today. */
export function parseHash(hash: string): TabId {
  return parseRoute(hash).tab;
}

/**
 * Куда смотрит приложение (PD-33). Кроме трёх вкладок есть два «вложенных» адреса, оба живут на вкладке Year:
 * - `#/day/YYYY-MM-DD` — архив: игра прошлого дня (вкладка Year остаётся подсвеченной, «‹ Year» ведёт назад);
 * - `#/year/YYYY-MM-DD` — Year с открытой карточкой этого дня (куда возвращает «‹ Year» из архива).
 */
export interface Route {
  readonly tab: TabId;
  /** Открыта игра архивного дня. */
  readonly archiveDate: string | null;
  /** Year открывается сразу на карточке этого дня. */
  readonly yearDate: string | null;
}

export type Target = { readonly tab: TabId } | { readonly archive: string } | { readonly yearDay: string };

export function parseRoute(hash: string): Route {
  const [head = "", arg] = hash.replace(/^#\/?/, "").split("/");
  if (head === "day" && arg !== undefined && DATE_RE.test(arg)) return { tab: "year", archiveDate: arg, yearDate: null };
  if (head === "year" && arg !== undefined && DATE_RE.test(arg)) return { tab: "year", archiveDate: null, yearDate: arg };
  return { tab: isTabId(head) ? head : DEFAULT_TAB, archiveDate: null, yearDate: null };
}

export function hashOf(target: Target): string {
  if ("archive" in target) return `#/day/${target.archive}`;
  if ("yearDay" in target) return `#/year/${target.yearDay}`;
  return `#/${target.tab}`;
}

/**
 * Активный маршрут как простое состояние, синхронизированное с хэшем (перезагрузка и ручная правка адреса
 * работают). Переключение — replaceState: вкладки и архив не засоряют историю.
 */
export function useRoute(): [Route, (target: Target) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = useCallback((target: Target) => {
    const hash = hashOf(target);
    window.history.replaceState(null, "", hash);
    setRoute(parseRoute(hash));
  }, []);

  return [route, go];
}
