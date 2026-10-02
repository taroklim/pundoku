/**
 * `ProgressRepository` + `SyncStorage` на IndexedDB (PD-14). Хранилища:
 * - `days` (ключ — дата): `DayProgress` целиком — MoveLog, заметки, значения, таймер;
 * - `kv`: `permanent` (Grid ∞: installSeed, index, улёты), `deviceToken`, `syncState`, `syncDirty`.
 *
 * Токен устройства лежит в той же базе, что и прогресс, — потеря IndexedDB = потеря токена
 * (см. README `apps/web`, «Ограничение до PD-27»).
 */
import type { PermanentGridState } from "../today/permanent";
import type { DayProgress, PersistentStore } from "../today/repository";
import { InMemoryProgressRepository, dayProgressProblem, sanitizeDays } from "../today/repository";
import type { IdbFactoryLike } from "./idb";
import { openDb, readWrite, STORE_DAYS, STORE_KV, withStore } from "./idb";

const KEY_PERMANENT = "permanent";

export class IndexedDbProgressRepository implements PersistentStore {
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory?: IdbFactoryLike, name?: string): Promise<IndexedDbProgressRepository> {
    return new IndexedDbProgressRepository(await openDb(factory, name));
  }

  close(): void {
    this.db.close();
  }

  async getPermanent(): Promise<PermanentGridState | null> {
    return ((await withStore(this.db, STORE_KV, "readonly", (s) => s.get(KEY_PERMANENT))) as PermanentGridState | undefined) ?? null;
  }
  async savePermanent(state: PermanentGridState): Promise<void> {
    await withStore(this.db, STORE_KV, "readwrite", (s) => s.put(state, KEY_PERMANENT));
  }
  async getDay(date: string): Promise<DayProgress | null> {
    const raw = (await withStore(this.db, STORE_DAYS, "readonly", (s) => s.get(date))) as unknown;
    if (raw === undefined || raw === null) return null;
    const problem = dayProgressProblem(raw);
    if (problem === null) return raw as DayProgress;
    // Запись есть, но не читается (PD-146): как отсутствующую — день начнётся заново, сервер вернёт решённое при синхронизации.
    console.error(`[pundoku] days/${date}: запись нечитаема (${problem}), считаем отсутствующей`);
    return null;
  }
  async saveDay(progress: DayProgress): Promise<void> {
    await withStore(this.db, STORE_DAYS, "readwrite", (s) => s.put(progress));
  }
  async listDays(): Promise<DayProgress[]> {
    return sanitizeDays((await withStore(this.db, STORE_DAYS, "readonly", (s) => s.getAll())) as unknown[], "IndexedDB days");
  }
  async getMeta(key: string): Promise<unknown> {
    return ((await withStore(this.db, STORE_KV, "readonly", (s) => s.get(`meta:${key}`))) as unknown) ?? null;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await withStore(this.db, STORE_KV, "readwrite", (s) => s.put(value, `meta:${key}`));
  }
  async setMetaIfAbsent(key: string, value: unknown): Promise<unknown> {
    return readWrite<unknown>(this.db, STORE_KV, (s, done) => {
      const k = `meta:${key}`;
      const get = s.get(k);
      get.onsuccess = () => {
        if (get.result !== undefined && get.result !== null) {
          done(get.result);
        } else {
          s.put(value, k);
          done(value);
        }
      };
    });
  }
}

/**
 * Хранилище на время, пока IndexedDB открывается: операции ждут открытия. Если открыть не удалось —
 * молча деградируем в память (`onFallback` — для лога): игра продолжает работать, данные живут до
 * закрытия вкладки. Так `DayStore` создаётся синхронно, а боевая база подключается асинхронно.
 */
export class LazyProgressRepository implements PersistentStore {
  private readonly ready: Promise<PersistentStore>;
  constructor(open: () => Promise<PersistentStore>, onFallback: (err: unknown) => void = () => {}) {
    this.ready = open().catch((err: unknown) => {
      onFallback(err);
      return new InMemoryProgressRepository();
    });
  }
  private async r(): Promise<PersistentStore> {
    return this.ready;
  }
  /** Какая реализация в итоге работает (для тестов и диагностики). */
  backend(): Promise<PersistentStore> {
    return this.ready;
  }
  async getPermanent() {
    return (await this.r()).getPermanent();
  }
  async savePermanent(state: PermanentGridState) {
    return (await this.r()).savePermanent(state);
  }
  async getDay(date: string) {
    return (await this.r()).getDay(date);
  }
  async saveDay(progress: DayProgress) {
    return (await this.r()).saveDay(progress);
  }
  async listDays() {
    return (await this.r()).listDays();
  }
  async getMeta(key: string) {
    return (await this.r()).getMeta(key);
  }
  async setMeta(key: string, value: unknown) {
    return (await this.r()).setMeta(key, value);
  }
  async setMetaIfAbsent(key: string, value: unknown) {
    return (await this.r()).setMetaIfAbsent(key, value);
  }
}
