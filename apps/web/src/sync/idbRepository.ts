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

/** PD-284: канал «дни изменились» между вкладками одного источника (кэш `listDays` в каждой). */
export const DAYS_CHANNEL = "pundoku-days";

export class IndexedDbProgressRepository implements PersistentStore {
  /**
   * PD-284: кэш `listDays` — чтение всех дней (getAll + проверка каждой записи) стоило ~40 мс на каждом возврате на Play.
   * Инвалидация по записи: `saveDay` этого экземпляра (до и после транзакции — чтение, начатое во время записи, в кэш не
   * попадёт) и запись в другой вкладке (BroadcastChannel). Все записи `days` в приложении идут через этот экземпляр
   * (`sync/runtime` — один репозиторий на вкладку). Нет BroadcastChannel — кэша нет: читаем каждый раз, как раньше.
   * Каждый вызов получает свой массив; записи общие и только для чтения (как у `InMemoryProgressRepository`).
   */
  private days: { readonly gen: number; readonly list: Promise<DayProgress[]> } | null = null;
  private daysGen = 0;
  private readonly channel: BroadcastChannel | null;

  private constructor(private readonly db: IDBDatabase) {
    this.channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(DAYS_CHANNEL) : null;
    if (this.channel) {
      this.channel.onmessage = () => this.invalidateDays();
      (this.channel as { unref?: () => void }).unref?.(); // Node (тесты): канал не держит процесс
    }
  }

  static async open(factory?: IdbFactoryLike, name?: string): Promise<IndexedDbProgressRepository> {
    return new IndexedDbProgressRepository(await openDb(factory, name));
  }

  close(): void {
    this.channel?.close();
    this.invalidateDays();
    this.db.close();
  }

  private invalidateDays(): void {
    this.daysGen++;
    this.days = null;
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
    this.invalidateDays();
    try {
      await withStore(this.db, STORE_DAYS, "readwrite", (s) => s.put(progress));
    } finally {
      this.invalidateDays();
      this.channel?.postMessage("days");
    }
  }
  async listDays(): Promise<DayProgress[]> {
    if (!this.channel) return this.readDays();
    let cached = this.days;
    if (cached === null || cached.gen !== this.daysGen) {
      const list = this.readDays();
      cached = { gen: this.daysGen, list };
      this.days = cached;
      // Чтение не удалось — не держать отказ в кэше: следующий вызов прочитает заново.
      list.catch(() => {
        if (this.days?.list === list) this.days = null;
      });
    }
    return [...(await cached.list)];
  }
  private async readDays(): Promise<DayProgress[]> {
    return sanitizeDays((await withStore(this.db, STORE_DAYS, "readonly", (s) => s.getAll())) as unknown[], "IndexedDB days");
  }
  async getMeta(key: string): Promise<unknown> {
    return ((await withStore(this.db, STORE_KV, "readonly", (s) => s.get(`meta:${key}`))) as unknown) ?? null;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    await withStore(this.db, STORE_KV, "readwrite", (s) => s.put(value, `meta:${key}`));
  }
  /** PD-171: записи `meta:<prefix>…` одной транзакцией (курсор по диапазону ключей). Пустые (`null`) пропускаются. */
  async listMeta(prefix: string): Promise<[string, unknown][]> {
    const lo = `meta:${prefix}`;
    return new Promise((resolve, reject) => {
      const out: [string, unknown][] = [];
      let tx: IDBTransaction;
      try {
        tx = this.db.transaction(STORE_KV, "readonly");
        const req = tx.objectStore(STORE_KV).openCursor(IDBKeyRange.bound(lo, `${lo}\uffff`));
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return;
          if (cur.value !== null && cur.value !== undefined) out.push([String(cur.key).slice("meta:".length), cur.value as unknown]);
          cur.continue();
        };
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
    });
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
  async listMeta(prefix: string): Promise<[string, unknown][]> {
    const r = await this.r();
    return r.listMeta ? r.listMeta(prefix) : [];
  }
}
