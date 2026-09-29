/**
 * Тонкая обёртка над IndexedDB (PD-14): без библиотек, только то, что нужно хранилищу — открыть базу
 * с миграцией схемы, прочитать/записать/перечислить записи одного хранилища. Каждая операция — своя
 * транзакция, результат — по `oncomplete` (запись подтверждена, а не «поставлена в очередь»).
 */
export const DB_NAME = "pundoku";
export const DB_VERSION = 1;
export const STORE_KV = "kv";
export const STORE_DAYS = "days";

export type IdbFactoryLike = Pick<IDBFactory, "open">;

/** Открыть базу; `onupgradeneeded` создаёт хранилища версии 1. Отклоняется, если IndexedDB недоступна/заблокирована. */
export function openDb(factory: IdbFactoryLike | undefined = globalThis.indexedDB, name: string = DB_NAME): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!factory) {
      reject(new Error("indexedDB is not available"));
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = factory.open(name, DB_VERSION);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      // Миграции схемы БД: версия n → n + 1 добавляется отдельным `if (event.oldVersion < n + 1)`.
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
      if (!db.objectStoreNames.contains(STORE_DAYS)) db.createObjectStore(STORE_DAYS, { keyPath: "date" });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Другая вкладка обновляет схему — закрываемся, чтобы не блокировать её.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    req.onblocked = () => reject(new Error("indexedDB open blocked"));
  });
}

/** Одна транзакция: `run` получает хранилище и возвращает запрос; результат — после коммита транзакции. */
export function withStore<T>(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    let req: IDBRequest<T>;
    try {
      tx = db.transaction(store, mode);
      req = run(tx.objectStore(store));
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error ?? new Error("indexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
  });
}

/** Прочитать-и-записать в одной транзакции (для `setIfAbsent`). */
export function readWrite<T>(
  db: IDBDatabase,
  store: string,
  fn: (s: IDBObjectStore, done: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let tx: IDBTransaction;
    let result: T;
    try {
      tx = db.transaction(store, "readwrite");
      fn(tx.objectStore(store), (v) => {
        result = v;
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
  });
}
