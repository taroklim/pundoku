import { useSyncExternalStore } from "react";
import type { ModeId } from "../play/modes";

/**
 * PD-266: десктоп C «Сайдбар» (design/pd229-desktop.md §2, §3 C) — оболочка. Раскладка выбирается по доступному месту в
 * CSS px (окно ÷ масштаб браузера), а не по типу устройства: от 1100 × 680 — стеклянный сайдбар вместо таб-бара; PD-268:
 * альбомное окно ниже (ноутбук при 125/150 %) — компакт C: та же раскладка без сайдбара (`COMPACT_QUERY`, `.shell.desk.compact`);
 * телефон в любой ориентации, портрет, узкое окно — прежняя оболочка с таб-баром, ничего не меняется.
 *
 * Здесь три вещи, все — только для десктопа:
 *  - `useDeskLayout()` — включена ли раскладка C (`DESK_QUERY` или компакт `COMPACT_QUERY`, их же видит CSS через классы
 *    `.desk`/`.compact` на `.shell`: второго источника правды в @media нет);
 *  - скрыт ли сайдбар (кнопка в углу контента) — запоминается на устройстве (localStorage, как прочие UI-предпочтения
 *    `settings/prefs.ts`; в снапшот синхронизации не входит);
 *  - «страница режима» Play (`modePage`): режим, выбранный в сайдбаре, когда у него нет незаконченной партии. Хаб Play
 *    в сайдбарной раскладке становится страницей выбранного режима (описание, сложность, «Начать»), вместо шита.
 *
 * Точки расширения для PD-267/268/269: класс `.shell.desk` (+ `.side-off`, PD-268: + `.compact`) и переменная `--desk-x` (левая кромка контента)
 * — от них считаются тулбар, инспектор и шкала ширин.
 */
export const DESK_QUERY = "(min-width: 1100px) and (min-height: 680px)";

/**
 * PD-268: компакт десктопа C (md §2, §3 C: «ниже 1100×680 сайдбар прячется сам, инспектор становится компактным») — альбомное
 * окно от 700 × 501 CSS px, не дотянувшее до DESK_QUERY: ноутбук при 125/150 % (1024×640, 853×533, 960×600), невысокое или
 * узкое окно. Та же раскладка C (тулбар, поле, инспектор), только без сайдбара: он показывается кнопкой поверх контента и сам
 * уходит после выбора пункта. Телефон (ландшафт — высота ≤ 500, landscape.css), портрет и узкое окно сюда не попадают.
 */
export const COMPACT_QUERY = "(orientation: landscape) and (min-width: 700px) and (min-height: 501px)";

/** id сайдбара — для `aria-controls` его кнопки (shell/SidebarToggle.tsx). */
export const SIDEBAR_ID = "desk-sidebar";

/** Ключ «сайдбар скрыт» (значение «1»); нет ключа — показан. */
export const SIDEBAR_HIDDEN_KEY = "pundoku.sidebarHidden";

function mediaList(query = DESK_QUERY): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

function listen(mq: MediaQueryList | null, cb: () => void): () => void {
  if (!mq) return () => undefined;
  // Safari до 14 знает только addListener.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }
  mq.addListener(cb);
  return () => mq.removeListener(cb);
}

function subscribeMedia(cb: () => void): () => void {
  const offs = [listen(mediaList(DESK_QUERY), cb), listen(mediaList(COMPACT_QUERY), cb)];
  return () => offs.forEach((off) => off());
}

/** Полная раскладка с сайдбаром (от 1100 × 680). Без matchMedia (jsdom, очень старый браузер) — нет: прежняя оболочка. */
export const isFullDesk = (): boolean => mediaList(DESK_QUERY)?.matches === true;

/** PD-268: компакт C — альбомное окно от 700 × 501, но ниже 1100 × 680. */
export const isDeskCompact = (): boolean => !isFullDesk() && mediaList(COMPACT_QUERY)?.matches === true;

/** Раскладка C — полная или компактная (`.shell.desk`): тулбар, инспектор, слой окна. Иначе — прежняя оболочка телефона. */
export const isDeskLayout = (): boolean => isFullDesk() || isDeskCompact();

export function useDeskLayout(): boolean {
  return useSyncExternalStore(subscribeMedia, isDeskLayout, () => false);
}

/** PD-268: включён ли компакт C (`.shell.desk.compact`): без сайдбара, компактный инспектор. */
export function useDeskCompact(): boolean {
  return useSyncExternalStore(subscribeMedia, isDeskCompact, () => false);
}

interface DeskState {
  /** Сайдбар скрыт кнопкой (только в раскладке с сайдбаром; на компакте его нет и так). */
  readonly hidden: boolean;
  /** Открыта страница этого режима Play (сайдбар); `null` — обычный хаб. */
  readonly modePage: ModeId | null;
  /**
   * PD-268: на компакте сайдбар показан кнопкой поверх контента. Не запоминается (живёт до выбора пункта, Esc, клика мимо или
   * смены раскладки) — на компакте сайдбар по умолчанию скрыт всегда, как в узком окне на Mac.
   */
  readonly compactOpen: boolean;
}

const listeners = new Set<() => void>();
/** Запасное значение, если localStorage недоступен (приватный режим): выбор живёт до перезагрузки. */
let memoryHidden = false;

function readHidden(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_HIDDEN_KEY) === "1";
  } catch {
    return memoryHidden;
  }
}

let state: DeskState = { hidden: readHidden(), modePage: null, compactOpen: false };

function set(patch: Partial<DeskState>): void {
  const next = { ...state, ...patch };
  if (next.hidden === state.hidden && next.modePage === state.modePage && next.compactOpen === state.compactOpen) return;
  state = next;
  listeners.forEach((l) => l());
}

export const deskStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  getSnapshot(): DeskState {
    return state;
  },
  setHidden(hidden: boolean): void {
    memoryHidden = hidden;
    try {
      if (hidden) localStorage.setItem(SIDEBAR_HIDDEN_KEY, "1");
      else localStorage.removeItem(SIDEBAR_HIDDEN_KEY);
    } catch {
      /* выбор живёт до перезагрузки */
    }
    set({ hidden });
  },
  toggleHidden(): void {
    deskStore.setHidden(!state.hidden);
  },
  showModePage(mode: ModeId | null): void {
    set({ modePage: mode });
  },
  /** PD-268: показать/убрать сайдбар поверх контента на компакте. */
  setCompactOpen(open: boolean): void {
    set({ compactOpen: open });
  },
  /** Тесты: заново прочитать хранилище и закрыть страницу режима. */
  reset(): void {
    state = { hidden: readHidden(), modePage: null, compactOpen: false };
    listeners.forEach((l) => l());
  },
};

export function useDeskState(): DeskState {
  return useSyncExternalStore(deskStore.subscribe, deskStore.getSnapshot, deskStore.getSnapshot);
}

/**
 * PD-268: сайдбар сейчас скрыт? Полная раскладка — выбор кнопкой (запоминается), компакт — скрыт, пока его не показали поверх
 * контента. `toggle` — действие кнопки сайдбара в шапке для текущей раскладки.
 */
export function useSidebarView(): { hidden: boolean; compact: boolean; toggle: () => void } {
  const compact = useDeskCompact();
  const { hidden, compactOpen } = useDeskState();
  return compact
    ? { hidden: !compactOpen, compact, toggle: () => deskStore.setCompactOpen(!compactOpen) }
    : { hidden, compact, toggle: deskStore.toggleHidden };
}
