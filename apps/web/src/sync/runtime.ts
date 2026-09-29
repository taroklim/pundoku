/**
 * Боевая сборка PD-14: IndexedDB-хранилище + менеджер синхронизации + запрос постоянного хранилища.
 * Модуль без побочных эффектов при импорте, кроме открытия базы (в тестах/jsdom без IndexedDB — деградация
 * в память); синхронизация и сеть стартуют только по `startSync()` (вызывается из `main.tsx`).
 */
import { IndexedDbProgressRepository, LazyProgressRepository } from "./idbRepository";
import type { RemoteApplied, SyncHooks } from "./manager";
import { defaultSyncTimings, SyncManager } from "./manager";
import { httpSyncApi } from "./syncApi";

const remoteListeners = new Set<(info: RemoteApplied) => void>();

const repository = new LazyProgressRepository(
  () => IndexedDbProgressRepository.open(),
  (err) => console.warn("[pundoku] IndexedDB недоступна, прогресс живёт только в памяти вкладки:", err),
);

const manager = new SyncManager({
  storage: repository,
  api: httpSyncApi(),
  now: () => new Date(),
  isOnline: () => (typeof navigator === "undefined" ? true : navigator.onLine),
  ...defaultSyncTimings,
  onRemoteApplied: (info) => remoteListeners.forEach((fn) => fn(info)),
});

const hooks: SyncHooks = {
  notify: (event) => manager.notify(event),
  whenReady: (ms) => manager.whenReady(ms),
  subscribeRemote: (fn) => {
    remoteListeners.add(fn);
    return () => remoteListeners.delete(fn);
  },
};

/**
 * Попросить браузер не вычищать хранилище (`navigator.storage.persist()`). Не блокирует и не влияет на игру:
 * ответ «нет» — обычное дело (Safari решает сам, для установленного PWA чаще «да»).
 */
export function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    if (!storage?.persist) return Promise.resolve(false);
    return storage.persist().catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

export function startSync(): void {
  void requestPersistentStorage();
  void manager.start();
}

export const sync = { repository, manager, hooks };
