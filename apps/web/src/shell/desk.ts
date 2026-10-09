import { useSyncExternalStore } from "react";
import type { ModeId } from "../play/modes";

/**
 * PD-266: десктоп C «Сайдбар» (design/pd229-desktop.md §2, §3 C) — оболочка. Раскладка выбирается по доступному месту в
 * CSS px (окно ÷ масштаб браузера), а не по типу устройства: от 1100 × 680 — стеклянный сайдбар вместо таб-бара; уже или ниже
 * (ноутбук при 125/150 %, телефон в любой ориентации, узкое окно) — прежняя оболочка с таб-баром, ничего не меняется.
 *
 * Здесь три вещи, все — только для десктопа:
 *  - `useDeskLayout()` — включена ли раскладка с сайдбаром (одно условие `DESK_QUERY`, его же видит CSS через класс `.desk`
 *    на `.shell`: второго источника правды в @media нет);
 *  - скрыт ли сайдбар (кнопка в углу контента) — запоминается на устройстве (localStorage, как прочие UI-предпочтения
 *    `settings/prefs.ts`; в снапшот синхронизации не входит);
 *  - «страница режима» Play (`modePage`): режим, выбранный в сайдбаре, когда у него нет незаконченной партии. Хаб Play
 *    в сайдбарной раскладке становится страницей выбранного режима (описание, сложность, «Начать»), вместо шита.
 *
 * Точки расширения для PD-267/268/269: класс `.shell.desk` (+ `.side-off`) и переменная `--desk-x` (левая кромка контента)
 * — от них считаются тулбар, инспектор и шкала ширин.
 */
export const DESK_QUERY = "(min-width: 1100px) and (min-height: 680px)";

/** id сайдбара — для `aria-controls` его кнопки (shell/SidebarToggle.tsx). */
export const SIDEBAR_ID = "desk-sidebar";

/** Ключ «сайдбар скрыт» (значение «1»); нет ключа — показан. */
export const SIDEBAR_HIDDEN_KEY = "pundoku.sidebarHidden";

function mediaList(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DESK_QUERY) : null;
}

function subscribeMedia(cb: () => void): () => void {
  const mq = mediaList();
  if (!mq) return () => undefined;
  // Safari до 14 знает только addListener.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", cb);
    return () => mq.removeEventListener("change", cb);
  }
  mq.addListener(cb);
  return () => mq.removeListener(cb);
}

/** Сейчас ли раскладка с сайдбаром. Без matchMedia (jsdom, очень старый браузер) — нет: прежняя оболочка. */
export const isDeskLayout = (): boolean => mediaList()?.matches === true;

export function useDeskLayout(): boolean {
  return useSyncExternalStore(subscribeMedia, isDeskLayout, () => false);
}

interface DeskState {
  /** Сайдбар скрыт кнопкой (только в раскладке с сайдбаром; на компакте его нет и так). */
  readonly hidden: boolean;
  /** Открыта страница этого режима Play (сайдбар); `null` — обычный хаб. */
  readonly modePage: ModeId | null;
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

let state: DeskState = { hidden: readHidden(), modePage: null };

function set(patch: Partial<DeskState>): void {
  const next = { ...state, ...patch };
  if (next.hidden === state.hidden && next.modePage === state.modePage) return;
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
  /** Тесты: заново прочитать хранилище и закрыть страницу режима. */
  reset(): void {
    state = { hidden: readHidden(), modePage: null };
    listeners.forEach((l) => l());
  },
};

export function useDeskState(): DeskState {
  return useSyncExternalStore(deskStore.subscribe, deskStore.getSnapshot, deskStore.getSnapshot);
}
