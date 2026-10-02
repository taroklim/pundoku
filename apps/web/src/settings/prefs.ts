import { useSyncExternalStore } from "react";

/**
 * Локальные UI-предпочтения устройства (PD-112): как язык (`pundoku.locale`) — localStorage, не IndexedDB и не снапшот
 * синхронизации. Это настройка этого телефона, а не прогресс: схема снапшота не меняется, старый клиент ничего не
 * затрёт. Подписка — `useSyncExternalStore`, поэтому переключатель в Settings действует на открытом Play/Today сразу.
 */

/** Подсвечивать неверные цифры в обычной (не чернильной) партии. Включено только значением «1». */
export const HIGHLIGHT_WRONG_KEY = "pundoku.highlightWrong";

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
/** Запасное хранилище, если localStorage недоступен (приватный режим): выбор живёт до перезагрузки. */
let memory = false;

/**
 * По умолчанию ВЫКЛЮЧЕНО у всех, включая пользователей, игравших до PD-112: ключа нет — значит выкл, миграции
 * «сохранить прежнее поведение» нет (решение владельца 2026-10-02).
 */
export function getHighlightWrong(): boolean {
  try {
    return localStorage.getItem(HIGHLIGHT_WRONG_KEY) === "1";
  } catch {
    return memory;
  }
}

export function setHighlightWrong(on: boolean): void {
  memory = on;
  try {
    if (on) localStorage.setItem(HIGHLIGHT_WRONG_KEY, "1");
    else localStorage.removeItem(HIGHLIGHT_WRONG_KEY);
  } catch {
    /* выбор живёт до перезагрузки */
  }
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Другая вкладка/окно PWA изменила настройку (или очистила хранилище: key === null).
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === HIGHLIGHT_WRONG_KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useHighlightWrong(): boolean {
  return useSyncExternalStore(subscribe, getHighlightWrong, () => false);
}
