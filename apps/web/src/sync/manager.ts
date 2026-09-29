/**
 * Устройство и синхронизация снапшота (PD-14). Офлайн-first: игра НИКОГДА не ждёт сеть и не зависит
 * от результата синхронизации; менеджер работает в фоне поверх локального хранилища.
 *
 * Цикл (`cycle`, один за раз, повторы по таймеру):
 *  1. нет токена → `POST /api/devices`, токен → хранилище (`setMetaIfAbsent`: две вкладки — один токен);
 *  2. первый цикл сессии / возврат в сеть / вкладка снова видима → `GET /api/snapshot`, слияние с локальным
 *     (`merge.ts`), недостающее (решённые дни, Grid ∞) записывается в локальное хранилище — так работает
 *     восстановление после чистки IndexedDB при сохранившемся токене;
 *  3. локальные данные ≠ последнему подтверждённому серверному снапшоту → `PUT` с `version + 1`;
 *     409 → слияние с присланным снапшотом и новая попытка; 413 → сжатие `moveLog` и новая попытка
 *     (ступень сжатия сохраняется в `meta:syncState` и переживает перезапуск);
 *     401 → токен неизвестен серверу: регистрируем устройство заново (локальные данные не теряются);
 *  4. сетевая ошибка → повтор с экспоненциальной паузой; офлайн → ждём событие `online`.
 * Триггеры: `notify('solved')` — с debounce; `'progress'` — только пометка «не синхронизировано»;
 * `online`, `visibilitychange` — цикл сразу.
 *
 * Состояние (`subscribe/getSnapshot`, как у остальных хранилищ) содержит `unsynced` — хук под будущий
 * индикатор «не синхронизировано» (UI в PD-14 не добавляется).
 */
import { mergeSnapshots, sameDayRecord, sameGrid, sameSnapshotData } from "./merge";
import type { DayRecord, SnapshotData } from "./schema";
import {
  buildSnapshotData,
  dayRecordFromProgress,
  emptySnapshotData,
  migrateSnapshot,
  MOVE_LOG_ALWAYS_LAST_DAYS,
  MOVE_LOG_BUDGET_CHARS,
  progressFromRecord,
} from "./schema";
import type { PushResult, RemoteSnapshot, SyncApi } from "./syncApi";
import type { PersistentStore } from "../today/repository";

export const META_TOKEN = "deviceToken";
export const META_SYNC_STATE = "syncState";

/** Подтверждённый серверный снапшот: с ним сравниваются локальные данные, чтобы понять, что отправлять. */
interface SyncState {
  version: number;
  data: SnapshotData;
}

/** То, что лежит в `meta:syncState`: подтверждённый снапшот + ступень сжатия, на которой сервер его принял. */
interface StoredSyncState extends SyncState {
  /** Индекс в `BUDGET_STEPS`; нет (старая запись) — 0. Липкая между сессиями: иначе на каждом старте — лишние 413 и PUT. */
  compressStep?: number;
}

export interface SyncStatus {
  device: "none" | "registered";
  phase: "idle" | "syncing" | "offline" | "retrying" | "blocked";
  /** Есть локальные изменения, которых сервер ещё не подтвердил (хук под индикатор). */
  unsynced: boolean;
  lastSyncedAt: string | null;
  /** Версия последнего подтверждённого серверного снапшота (0 — снапшота ещё нет). */
  version: number;
  error: "too_large" | "newer_schema" | null;
}

export type SyncEvent = "solved" | "progress";

export interface RemoteApplied {
  /** Даты, чей прогресс переписан данными сервера. */
  dates: string[];
  gridChanged: boolean;
}

export interface SyncDeps {
  storage: PersistentStore;
  api: SyncApi;
  now: () => Date;
  isOnline: () => boolean;
  /** Пауза перед синхронизацией после значимого события (сливает подряд идущие). */
  debounceMs: number;
  retryBaseMs: number;
  retryMaxMs: number;
  onRemoteApplied?: (info: RemoteApplied) => void;
}

/** Связь с синхронизацией снапшота (PD-14); в тестах не задаётся — тогда синхронизации нет. */
export interface SyncHooks {
  notify(event: SyncEvent): void;
  /** Подождать первичную сверку с сервером (восстановление), но не дольше `ms`. */
  whenReady(ms: number): Promise<void>;
  /** Данные сервера записаны в локальное хранилище (восстановление/слияние); возвращает отписку. */
  subscribeRemote(fn: (info: RemoteApplied) => void): () => void;
}

export const defaultSyncTimings = { debounceMs: 2000, retryBaseMs: 2000, retryMaxMs: 5 * 60_000 } as const;

const MAX_PUSH_ATTEMPTS = 6;
/** Возврат видимости не чаще раза в столько мс дёргает `GET` (иначе каждое переключение вкладок — запрос). */
const VISIBLE_PULL_THROTTLE_MS = 30_000;

/** Ступени сжатия при 413: бюджет по умолчанию → только последние 7 логов → без логов. */
const BUDGET_STEPS: readonly { budget: number; alwaysLast: number }[] = [
  { budget: MOVE_LOG_BUDGET_CHARS, alwaysLast: MOVE_LOG_ALWAYS_LAST_DAYS },
  { budget: 0, alwaysLast: MOVE_LOG_ALWAYS_LAST_DAYS },
  { budget: 0, alwaysLast: 0 },
];

const isEmpty = (d: SnapshotData): boolean => d.grid === null && Object.keys(d.days).length === 0;

export class SyncManager {
  private status: SyncStatus = { device: "none", phase: "idle", unsynced: false, lastSyncedAt: null, version: 0, error: null };
  private listeners = new Set<() => void>();
  private token: string | null = null;
  private state: SyncState | null = null;
  private started = false;
  private disposed = false;
  private pulled = false;
  private wantPull = false;
  private running: Promise<void> | null = null;
  private rerun = false;
  private dirtySeq = 0;
  private failures = 0;
  /** Токен зарегистрирован в этой серии циклов и ещё ни разу не принят сервером (защита от цикла 401). */
  private freshToken = false;
  private lastPullAt = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Ступень сжатия (`BUDGET_STEPS`), на которой сервер принял последний PUT; хранится в `meta:syncState`. */
  private compressStep = 0;
  private bootDone!: () => void;
  private readonly booted = new Promise<void>((resolve) => {
    this.bootDone = resolve;
  });
  private initialDone!: () => void;
  private readonly initial = new Promise<void>((resolve) => {
    this.initialDone = resolve;
  });

  constructor(private readonly deps: SyncDeps) {}

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly getSnapshot = (): SyncStatus => this.status;

  private setStatus(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  /** Запуск: читает токен/состояние из хранилища, вешает слушатели, стартует первый цикл. Идемпотентно. */
  start(): Promise<void> {
    if (this.started) return this.initial;
    this.started = true;
    void this.boot();
    return this.initial;
  }

  private async boot(): Promise<void> {
    try {
      const token = await this.deps.storage.getMeta(META_TOKEN);
      this.token = typeof token === "string" && token !== "" ? token : null;
      const st = await this.deps.storage.getMeta(META_SYNC_STATE);
      const parsed = st && typeof st === "object" ? this.parseState(st as { version?: unknown; data?: unknown; compressStep?: unknown }) : null;
      this.state = parsed;
      if (parsed) {
        const step = (st as { compressStep?: unknown }).compressStep;
        if (typeof step === "number" && Number.isInteger(step) && step >= 0 && step < BUDGET_STEPS.length) this.compressStep = step;
      }
    } catch {
      /* хранилище недоступно — работаем без сохранённого состояния */
    }
    this.bootDone();
    if (this.disposed) return;
    this.setStatus({ device: this.token ? "registered" : "none", version: this.state?.version ?? 0 });
    // Восстанавливать нечего: токена нет (новое устройство) или сети нет — игра стартует сразу.
    if (!this.token || !this.deps.isOnline()) this.initialDone();
    if (typeof window !== "undefined") window.addEventListener("online", this.onOnline);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onVisibility);
    this.wantPull = true;
    void this.kick();
  }

  private parseState(raw: { version?: unknown; data?: unknown }): SyncState | null {
    if (typeof raw.version !== "number") return null;
    const p = migrateSnapshot(raw.data);
    return p.ok ? { version: raw.version, data: p.data } : null;
  }

  /**
   * Ждать первичной сверки с сервером (восстановление), но не дольше `ms`: игра не должна зависеть от сети.
   * Разрешается сразу, если восстанавливать нечего (нет токена / нет сети).
   */
  whenReady(ms: number): Promise<void> {
    if (!this.started) return Promise.resolve();
    return Promise.race([this.initial, new Promise<void>((resolve) => setTimeout(resolve, ms))]);
  }

  /** Событие игры: значимое (`solved`) — синхронизация с debounce; `progress` — только пометка. */
  notify(event: SyncEvent = "solved"): void {
    this.dirtySeq++;
    if (!this.status.unsynced) this.setStatus({ unsynced: true });
    if (event === "solved") {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = null;
        void this.kick();
      }, this.deps.debounceMs);
    }
  }

  /** Синхронизироваться немедленно (тесты, ручной вызов). Возвращает завершение цикла. */
  syncNow(pull = false): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    return this.kick(pull);
  }

  dispose(): void {
    this.disposed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (typeof window !== "undefined") window.removeEventListener("online", this.onOnline);
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisibility);
    this.initialDone();
  }

  // ---- триггеры -----------------------------------------------------------------------------

  private onOnline = (): void => {
    this.failures = 0;
    void this.kick(true);
  };

  private onVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      // Уходим из приложения: отправить накопленное, не дожидаясь debounce.
      if (this.status.unsynced) void this.syncNow();
      return;
    }
    const stale = this.deps.now().getTime() - this.lastPullAt > VISIBLE_PULL_THROTTLE_MS;
    void this.kick(stale);
  };

  // ---- цикл ---------------------------------------------------------------------------------

  private kick(pull = false): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (pull) this.wantPull = true;
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        if (this.started) await this.booted; // токен и состояние загружены до первого цикла
        do {
          this.rerun = false;
          await this.cycle();
        } while (this.rerun && !this.disposed);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  private scheduleRetry(afterMs: number | null): void {
    if (this.disposed) return;
    this.failures++;
    const backoff = Math.min(this.deps.retryMaxMs, this.deps.retryBaseMs * 2 ** (this.failures - 1));
    const delay = Math.max(backoff, afterMs ?? 0);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.kick();
    }, delay);
    this.setStatus({ phase: "retrying" });
    this.initialDone(); // игра не ждёт сеть
  }

  private succeed(seq: number): void {
    this.failures = 0;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    this.setStatus({
      phase: "idle",
      unsynced: this.dirtySeq !== seq,
      lastSyncedAt: this.deps.now().toISOString(),
      version: this.state?.version ?? 0,
      error: null,
    });
  }

  private async cycle(): Promise<void> {
    if (this.status.phase === "blocked") {
      this.initialDone();
      return;
    }
    if (!this.deps.isOnline()) {
      this.setStatus({ phase: "offline" });
      this.initialDone();
      return;
    }
    const seq = this.dirtySeq;
    this.setStatus({ phase: "syncing" });
    try {
      const token = this.token ?? (await this.register());
      if (!token) return; // register уже назначил повтор

      let merged: SnapshotData;
      if (this.wantPull || !this.pulled) {
        const r = await this.deps.api.pull(token);
        if (r.kind === "unauthorized") return this.onUnauthorized();
        if (r.kind === "error") return this.scheduleRetry(r.retryAfterMs);
        this.freshToken = false;
        this.wantPull = false;
        this.pulled = true;
        this.lastPullAt = this.deps.now().getTime();
        const remote = r.kind === "ok" ? this.parseRemote(r.snapshot) : null;
        if (remote === "blocked") return;
        merged = await this.integrate(remote);
        this.initialDone();
      } else {
        merged = await this.integrate(undefined);
      }

      if (!this.needsPush(merged)) return this.succeed(seq);
      await this.pushLoop(token, merged, seq);
    } catch {
      this.scheduleRetry(null); // хранилище или неожиданная ошибка: не роняем игру, повторим
    } finally {
      this.initialDone();
    }
  }

  // ---- устройство ---------------------------------------------------------------------------

  private async register(): Promise<string | null> {
    const r = await this.deps.api.register();
    if (r.kind === "error") {
      this.scheduleRetry(r.retryAfterMs);
      return null;
    }
    // Гонка двух вкладок: побеждает первый записавший, остальные забывают свой токен.
    const stored = await this.deps.storage.setMetaIfAbsent(META_TOKEN, r.token);
    this.token = typeof stored === "string" ? stored : r.token;
    this.freshToken = true;
    this.setStatus({ device: "registered" });
    return this.token;
  }

  private async onUnauthorized(): Promise<void> {
    if (this.freshToken) return this.scheduleRetry(null); // свежий токен тоже отвергнут — не крутимся в цикле
    await this.dropToken();
    this.rerun = true;
  }

  /** Сервер не знает токен (401): у устройства новый аккаунт, локальные данные уйдут в него целиком. */
  private async dropToken(): Promise<void> {
    this.token = null;
    this.state = null;
    this.pulled = false;
    await this.deps.storage.setMeta(META_TOKEN, null);
    await this.deps.storage.setMeta(META_SYNC_STATE, null);
    this.setStatus({ device: "none", version: 0 });
  }

  // ---- слияние с локальным хранилищем -------------------------------------------------------

  private parseRemote(snap: RemoteSnapshot): { version: number; data: SnapshotData } | "blocked" {
    const p = migrateSnapshot(snap.data);
    if (p.ok) return { version: snap.version, data: p.data };
    if (p.reason === "newer_schema") {
      // Снапшот записан более новой версией приложения: не читаем и не перезаписываем.
      this.setStatus({ phase: "blocked", error: "newer_schema" });
      return "blocked";
    }
    return { version: snap.version, data: emptySnapshotData() }; // мусор на сервере — заменим слитым
  }

  private async collectLocal(): Promise<{ data: SnapshotData; records: Record<string, DayRecord> }> {
    const now = this.deps.now();
    const records: Record<string, DayRecord> = {};
    for (const p of await this.deps.storage.listDays()) {
      const rec = dayRecordFromProgress(p, now);
      if (rec) records[p.date] = rec;
    }
    const grid = await this.deps.storage.getPermanent();
    return { data: { ...emptySnapshotData(), grid, days: records }, records };
  }

  /**
   * Сливает локальные данные с серверными и записывает в локальное хранилище то, чего там не хватало.
   * `remote === undefined` — с сервера ничего не приходило: локальные данные объединяются с последним
   * подтверждённым снапшотом (в нём могут быть дни, которых локально нет — например «не решён» с сервера).
   */
  private async integrate(remote: { version: number; data: SnapshotData } | null | undefined): Promise<SnapshotData> {
    const local = await this.collectLocal();
    const shadow = this.state?.data ?? null;
    const base = shadow ? mergeSnapshots(local.data, shadow, { serverNewer: false }) : local.data;
    if (!remote) return base;

    const serverNewer = remote.version > (this.state?.version ?? 0);
    const merged = mergeSnapshots(base, remote.data, { serverNewer });
    await this.applyLocally(merged, local);
    this.state = { version: remote.version, data: remote.data };
    await this.persistState();
    return merged;
  }

  private async applyLocally(merged: SnapshotData, local: { data: SnapshotData; records: Record<string, DayRecord> }): Promise<void> {
    const dates: string[] = [];
    for (const [date, rec] of Object.entries(merged.days)) {
      if (rec.status !== "solved") continue;
      const mine = local.records[date];
      if (mine && sameSnapshotRecord(mine, rec)) continue;
      const progress = progressFromRecord(date, rec);
      if (!progress) continue;
      await this.deps.storage.saveDay(progress);
      dates.push(date);
    }
    let gridChanged = false;
    if (merged.grid && !sameGrid(local.data.grid, merged.grid)) {
      await this.deps.storage.savePermanent(merged.grid);
      gridChanged = true;
    }
    if (dates.length > 0 || gridChanged) this.deps.onRemoteApplied?.({ dates, gridChanged });
  }

  private async persistState(): Promise<void> {
    if (!this.state) return;
    const stored: StoredSyncState = { ...this.state, compressStep: this.compressStep };
    await this.deps.storage.setMeta(META_SYNC_STATE, stored);
  }

  private needsPush(merged: SnapshotData): boolean {
    if (!this.state) return !isEmpty(merged);
    const { budget, alwaysLast } = BUDGET_STEPS[this.compressStep]!;
    return !sameSnapshotData(buildSnapshotData(merged, budget, alwaysLast), this.state.data);
  }

  // ---- отправка -----------------------------------------------------------------------------

  private async pushLoop(token: string, initial: SnapshotData, seq: number): Promise<void> {
    let merged = initial;
    let step = this.compressStep;
    for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
      const { budget, alwaysLast } = BUDGET_STEPS[step]!;
      const data = buildSnapshotData(merged, budget, alwaysLast);
      const res: PushResult = await this.deps.api.push(token, {
        version: (this.state?.version ?? 0) + 1,
        updatedAt: this.deps.now().toISOString(),
        data,
      });
      switch (res.kind) {
        case "ok":
          this.freshToken = false;
          this.compressStep = step; // липкая ступень (и между сессиями, см. persistState): иначе снова упрёмся в 413
          this.state = { version: res.version, data };
          await this.persistState();
          return this.succeed(seq);
        case "conflict": {
          // Сервер ушёл вперёд (другое устройство с тем же токеном / потерянный ответ): слить и повторить.
          let snap = res.snapshot;
          if (!snap) {
            const r = await this.deps.api.pull(token);
            if (r.kind !== "ok") return this.scheduleRetry(r.kind === "error" ? r.retryAfterMs : null);
            snap = r.snapshot;
          }
          const remote = this.parseRemote(snap);
          if (remote === "blocked") return;
          merged = await this.integrate(remote);
          if (!this.needsPush(merged)) return this.succeed(seq);
          break;
        }
        case "too_large":
          step++;
          if (step >= BUDGET_STEPS.length) {
            this.setStatus({ phase: "blocked", error: "too_large" });
            return;
          }
          break;
        case "unauthorized":
          return this.onUnauthorized();
        case "error":
          return this.scheduleRetry(res.retryAfterMs);
      }
    }
    this.scheduleRetry(null);
  }
}

const sameSnapshotRecord = (a: DayRecord, b: DayRecord): boolean => sameDayRecord(a, b);
