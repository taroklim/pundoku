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
 * Третий — `#/settings` (PD-49): push-экран внутри вкладки Today (таб-бар остаётся, подсвечена Today). В отличие от
 * остальных адресов, он ложится в историю (`pushState`): свайп от края и «назад» возвращают на Today.
 */
export interface Route {
  readonly tab: TabId;
  /** Открыта игра архивного дня. */
  readonly archiveDate: string | null;
  /** Year открывается сразу на карточке этого дня. */
  readonly yearDate: string | null;
  /** Открыт экран Settings (PD-49); у остальных адресов поля нет. */
  readonly settings?: true;
}

export type Target =
  | { readonly tab: TabId }
  | { readonly archive: string }
  | { readonly yearDay: string }
  | { readonly settings: true };

export function parseRoute(hash: string): Route {
  const [head = "", arg] = hash.replace(/^#\/?/, "").split("/");
  if (head === "settings") return { tab: "today", archiveDate: null, yearDate: null, settings: true };
  if (head === "day" && arg !== undefined && DATE_RE.test(arg)) return { tab: "year", archiveDate: arg, yearDate: null };
  if (head === "year" && arg !== undefined && DATE_RE.test(arg)) return { tab: "year", archiveDate: null, yearDate: arg };
  return { tab: isTabId(head) ? head : DEFAULT_TAB, archiveDate: null, yearDate: null };
}

export function hashOf(target: Target): string {
  if ("archive" in target) return `#/day/${target.archive}`;
  if ("yearDay" in target) return `#/year/${target.yearDay}`;
  if ("settings" in target) return "#/settings";
  return `#/${target.tab}`;
}

/**
 * Активный маршрут как простое состояние, синхронизированное с хэшем (перезагрузка и ручная правка адреса
 * работают). Переключение — replaceState: вкладки и архив не засоряют историю. Исключение — вход в Settings
 * (`pushState` с меткой `pdSettings`): экран живёт в истории. `back()` из него: если запись поставили мы (метка в
 * `history.state`) — `history.back()`, иначе (глубокая ссылка/перезагрузка без предыдущей записи) — `replace` на Today.
 */
export function useRoute(): [Route, (target: Target) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  const go = useCallback((target: Target) => {
    const hash = hashOf(target);
    if ("settings" in target) window.history.pushState({ pdSettings: true }, "", hash);
    else window.history.replaceState(null, "", hash);
    setRoute(parseRoute(hash));
  }, []);

  return [route, go];
}

/** Уйти с Settings назад: по истории, если в неё нас поставило приложение, иначе — на вкладку Today. */
export function leaveSettings(go: (target: Target) => void): void {
  const state = window.history.state as { pdSettings?: unknown } | null;
  if (state?.pdSettings === true) window.history.back();
  else go({ tab: "today" });
}
