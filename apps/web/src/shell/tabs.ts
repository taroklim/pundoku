import { useCallback, useEffect, useRef, useState } from "react";
import type { HelpBlockId } from "../help/blocks";
import { isHelpBlock } from "../help/blocks";

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
 * Третий — `#/settings` (PD-49): push-экран поверх вкладки, с которой его открыли (PD-123: шестерёнка есть на всех
 * трёх; таб-бар остаётся, подсвечена вкладка-источник, она же в `tab`). В отличие от остальных адресов, он ложится
 * в историю (`pushState`): свайп от края и «назад» возвращают на ту вкладку. Четвёртый — `#/help[/блок]` (PD-120):
 * экран «How Pundoku works», тоже push; открывается из Settings или ссылкой «What's this?» на карточке дня.
 * Источник (`pdFrom`) и «через что» (`pdVia`) лежат в `history.state` записи — адрес остаётся короткой ссылкой без них
 * (глубокая ссылка/перезагрузка без метки → Today).
 */
export interface Route {
  readonly tab: TabId;
  /** Открыта игра архивного дня. */
  readonly archiveDate: string | null;
  /**
   * PD-282: откуда открыт архив, если не из Year — «‹» ведёт обратно туда (строка дня в «Продолжить» хаба Play → Play). Метка
   * `pdFrom` в `history.state` записи; без неё (из Year, глубокая ссылка, перезагрузка) — поля нет, «‹ Year» на карточку дня.
   */
  readonly archiveFrom?: "play";
  /** Year открывается сразу на карточке этого дня. */
  readonly yearDate: string | null;
  /** Открыт экран Settings (PD-49); у остальных адресов поля нет. */
  readonly settings?: true;
  /** Открыт экран справки (PD-120): якорь-блок, к которому прокрутить, и откуда пришли. */
  readonly help?: { readonly block: HelpBlockId | null; readonly via: "settings" | "tab" };
}

export type Target =
  | { readonly tab: TabId }
  | { readonly archive: string; readonly from?: "play" }
  | { readonly yearDay: string }
  | { readonly settings: true }
  | { readonly help: HelpBlockId | null };

export function parseRoute(hash: string): Route {
  const [head = "", arg] = hash.replace(/^#\/?/, "").split("/");
  if (head === "settings") return { tab: "today", archiveDate: null, yearDate: null, settings: true };
  if (head === "help") return { tab: "today", archiveDate: null, yearDate: null, help: { block: isHelpBlock(arg) ? arg : null, via: "tab" } };
  if (head === "day" && arg !== undefined && DATE_RE.test(arg)) return { tab: "year", archiveDate: arg, yearDate: null };
  if (head === "year" && arg !== undefined && DATE_RE.test(arg)) return { tab: "year", archiveDate: null, yearDate: arg };
  return { tab: isTabId(head) ? head : DEFAULT_TAB, archiveDate: null, yearDate: null };
}

export function hashOf(target: Target): string {
  if ("archive" in target) return `#/day/${target.archive}`;
  if ("yearDay" in target) return `#/year/${target.yearDay}`;
  if ("settings" in target) return "#/settings";
  if ("help" in target) return target.help === null ? "#/help" : `#/help/${target.help}`;
  return `#/${target.tab}`;
}

/** Метки записи истории у push-экранов (Settings, справка). */
interface PushState {
  pdSettings?: unknown;
  pdHelp?: unknown;
  pdFrom?: unknown;
  pdVia?: unknown;
  pdHeading?: unknown;
}
const historyState = (): PushState | null => window.history.state as PushState | null;
const originOf = (state: PushState | null): TabId => (typeof state?.pdFrom === "string" && isTabId(state.pdFrom) ? state.pdFrom : DEFAULT_TAB);

/** Маршрут по адресу и метке записи: у Settings и справки вкладка — та, с которой их открыли (`pdFrom`), иначе Today. */
export function readRoute(): Route {
  const route = parseRoute(window.location.hash);
  if (route.archiveDate !== null) return historyState()?.pdFrom === "play" ? { ...route, archiveFrom: "play" } : route;
  if (route.settings !== true && route.help === undefined) return route;
  const state = historyState();
  const tab = originOf(state);
  if (route.help) return { ...route, tab, help: { block: route.help.block, via: state?.pdVia === "settings" ? "settings" : "tab" } };
  return { ...route, tab };
}

/**
 * Перехват ухода с Settings «снаружи» (PD-57): браузерный «назад», iOS edge-swipe, правка адреса. `proceed` довершает
 * переход, когда пользователь его подтвердил. Возвращает `true`, если уход перехвачен (переход откатывается на
 * `#/settings`, пока `proceed` не вызван); `false` — перехватывать нечего.
 */
export type LeaveGuard = (proceed: () => void) => boolean;

/**
 * Активный маршрут как простое состояние, синхронизированное с хэшем (перезагрузка и ручная правка адреса
 * работают). Переключение — replaceState: вкладки и архив не засоряют историю. Исключение — вход в Settings и справку
 * (`pushState` с меткой `pdSettings`/`pdHelp`): экран живёт в истории. `back()` из него: если запись поставили мы (метка
 * в `history.state`) — `history.back()`, иначе (глубокая ссылка/перезагрузка без предыдущей записи) — `replace` на вкладку-источник.
 *
 * `guard` (PD-57): когда открыт Settings, а `popstate`/`hashchange` уводит в другой маршрут, а `guard` перехватывает
 * уход — маршрут остаётся Settings (состояние экрана и ключ в памяти не трогаются), адрес возвращается на
 * `#/settings` новой записью (`pushState`), а сам переход выполняется через `history.back()` только после
 * подтверждения: он приводит в ту запись, куда пользователь и шёл (предыдущую при «назад», набранную при правке адреса).
 */
export function useRoute(guard?: LeaveGuard): [Route, (target: Target) => void] {
  const [route, setRoute] = useState<Route>(readRoute);
  const routeRef = useRef(route);
  const guardRef = useRef(guard);
  guardRef.current = guard;

  useEffect(() => {
    const onHash = () => {
      const next = readRoute();
      if (routeRef.current.settings === true && next.settings !== true && guardRef.current?.(() => window.history.back())) {
        // Уход перехвачен: возвращаем адрес на Settings, пока висит шит. Подтверждённый уход — history.back().
        // `pdHeading` — куда шёл пользователь: по нему «‹ Today» после «Остаться» отличает «назад» от правки адреса (PD-60).
        window.history.pushState({ pdSettings: true, pdFrom: routeRef.current.tab, pdHeading: window.location.hash }, "", hashOf({ settings: true }));
        return;
      }
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onHash);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onHash);
    };
  }, []);

  const go = useCallback((target: Target) => {
    const hash = hashOf(target);
    const current = routeRef.current;
    if ("settings" in target) window.history.pushState({ pdSettings: true, pdFrom: current.tab }, "", hash);
    else if ("help" in target) window.history.pushState({ pdHelp: true, pdFrom: current.tab, pdVia: current.settings === true ? "settings" : "tab" }, "", hash);
    else window.history.replaceState("archive" in target && target.from ? { pdFrom: target.from } : null, "", hash);
    const next = readRoute();
    routeRef.current = next;
    setRoute(next);
  }, []);

  return [route, go];
}

/**
 * Уйти с Settings назад: по истории, если в неё нас поставило приложение, иначе — на вкладку-источник (Today, если
 * источник неизвестен).
 * PD-60: запись, которую поставил перехват ухода (`pdHeading`), ведёт `history.back()` туда, куда шёл пользователь. Это
 * вкладка-источник только при «назад»; при правке адреса на другой маршрут (`#/year`) «‹ Today» после «Остаться» должен
 * привести на вкладку-источник, а не на набранный адрес, — тогда идём на неё напрямую.
 */
export function leaveSettings(go: (target: Target) => void): void {
  const state = historyState();
  const origin = originOf(state);
  const heading = typeof state?.pdHeading === "string" ? parseRoute(state.pdHeading) : null;
  const backToOrigin =
    heading === null ||
    (heading.tab === origin && heading.settings !== true && heading.help === undefined && heading.archiveDate === null && heading.yearDate === null);
  if (state?.pdSettings === true && backToOrigin) window.history.back();
  else go({ tab: origin });
}

/** Уйти со справки назад: по истории, если запись наша (в Settings или на вкладку-источник), иначе — на вкладку-источник. */
export function leaveHelp(go: (target: Target) => void): void {
  const state = historyState();
  if (state?.pdHelp === true) window.history.back();
  else go({ tab: originOf(state) });
}
