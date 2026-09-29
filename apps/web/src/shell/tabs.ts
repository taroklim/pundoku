import { useCallback, useEffect, useState } from "react";

export const TAB_IDS = ["today", "play", "year"] as const;
export type TabId = (typeof TAB_IDS)[number];

const DEFAULT_TAB: TabId = "today";

function isTabId(value: string): value is TabId {
  return (TAB_IDS as readonly string[]).includes(value);
}

/** `#/today|play|year` → вкладка; всё остальное → Today. */
export function parseHash(hash: string): TabId {
  const id = hash.replace(/^#\/?/, "");
  return isTabId(id) ? id : DEFAULT_TAB;
}

/**
 * Активная вкладка как простое состояние, синхронизированное с хэшем (перезагрузка и ручная
 * правка адреса работают). Переключение — replaceState: вкладки не засоряют историю.
 */
export function useTab(): [TabId, (tab: TabId) => void] {
  const [tab, setTab] = useState<TabId>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setTab(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = useCallback((next: TabId) => {
    window.history.replaceState(null, "", `#/${next}`);
    setTab(next);
  }, []);

  return [tab, select];
}
