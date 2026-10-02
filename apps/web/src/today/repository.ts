/**
 * Хранилище личного прогресса Today (PD-12, PD-14): состояние постоянной сетки и прогресс дня.
 *
 * Интерфейс асинхронный: `DayStore` и экран о хранилище ничего не знают. Реализации:
 * - `IndexedDbProgressRepository` (`sync/idbRepository.ts`) — боевая, переживает перезагрузку;
 * - `InMemoryProgressRepository` (ниже) — для тестов и как деградация, если IndexedDB недоступна
 *   (приватный режим старых браузеров): игра работает, но данные живут до закрытия вкладки.
 * Поверх хранилища работает синхронизация снапшота с сервером (`sync/manager.ts`).
 */
import type { Difficulty } from "@pundoku/engine";
import type { DaySource } from "./dayResolver";
import type { PermanentGridState } from "./permanent";
import type { PlayState } from "../play/logic";

/** Прогресс одного дня: играемая сетка, ходы, итог. Структура клонируема (structuredClone/IndexedDB). */
export interface DayProgress {
  readonly date: string;
  readonly mission: string;
  readonly difficulty: Difficulty | null;
  readonly source: DaySource;
  readonly winRate: number | null;
  readonly play: PlayState;
  /** Накопленное «тихое» время партии, мс. */
  readonly elapsedMs: number;
  readonly solved: boolean;
  /** Ответ сервера на verify: `true/false`; `null` — не проверялось/нет ответа. */
  readonly serverVerified: boolean | null;
  /** Кто проверяет решение этой сетки (см. `verifyMode`): «local» — сетка отличается от серверной. */
  readonly verification: "server" | "local";
  /** Момент решения (ISO 8601 UTC); `null` — не решён. Для Year: первое решение дня. */
  readonly solvedAt: string | null;
  /** День решён после своей даты (дата дня < даты на момент решения). */
  readonly late: boolean;
  /** Решено с подсказкой. В релизе 1 подсказок нет — всегда `false`. */
  readonly assisted: boolean;
}

/**
 * Граница хранилища (PD-146): запись дня, прочитанная из IndexedDB, — не доверенный вход. WebKit (iOS Safari/WKWebView) умеет
 * отдать из `getAll()` ключ без читаемого значения: элемент массива `undefined` (запись недозафиксирована/не разобралась) — и
 * `p.solved` в потребителе роняло всё приложение пустым экраном (PD-146). Годится только объект с датой `YYYY-MM-DD`, строкой
 * `mission` и `play` с массивом `log`; остальное — не запись дня.
 */
export function isDayProgress(x: unknown): x is DayProgress {
  if (typeof x !== "object" || x === null) return false;
  const p = x as Partial<Record<keyof DayProgress, unknown>>;
  if (typeof p.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return false;
  if (typeof p.mission !== "string") return false;
  const play = p.play as { log?: unknown } | null | undefined;
  return typeof play === "object" && play !== null && Array.isArray(play.log);
}

/**
 * Не-null инвариант списка дней: остаются только записи, прошедшие `isDayProgress`; пропущенное — в `console.error`
 * (не молча: потеря записи видна в отладке, но не роняет экран). Если всё годно — возвращается тот же массив.
 */
export function sanitizeDays(list: readonly unknown[] | null | undefined, source = "days"): DayProgress[] {
  if (!Array.isArray(list)) return [];
  const good = list.filter(isDayProgress);
  if (good.length !== list.length) {
    console.error(`[pundoku] ${source}: пропущено нечитаемых записей дня — ${list.length - good.length} из ${list.length}`);
    return good;
  }
  return list as DayProgress[];
}

export interface ProgressRepository {
  getPermanent(): Promise<PermanentGridState | null>;
  savePermanent(state: PermanentGridState): Promise<void>;
  getDay(date: string): Promise<DayProgress | null>;
  saveDay(progress: DayProgress): Promise<void>;
}

/** Служебные данные синхронизации (`sync/`): токен устройства, версия снапшота, «грязный» флаг. */
export interface SyncStorage {
  /** Все дни с прогрессом (для сборки снапшота). */
  listDays(): Promise<DayProgress[]>;
  getMeta(key: string): Promise<unknown>;
  setMeta(key: string, value: unknown): Promise<void>;
  /** Записать, только если ключа ещё нет (защита от двух вкладок, регистрирующих устройство одновременно). Возвращает итоговое значение. */
  setMetaIfAbsent(key: string, value: unknown): Promise<unknown>;
}

export type PersistentStore = ProgressRepository & SyncStorage;

export class InMemoryProgressRepository implements PersistentStore {
  private permanent: PermanentGridState | null = null;
  private days = new Map<string, DayProgress>();
  private meta = new Map<string, unknown>();

  async listDays(): Promise<DayProgress[]> {
    return [...this.days.values()];
  }
  async getMeta(key: string): Promise<unknown> {
    return this.meta.has(key) ? structuredClone(this.meta.get(key)) : null;
  }
  async setMeta(key: string, value: unknown): Promise<void> {
    this.meta.set(key, structuredClone(value));
  }
  async setMetaIfAbsent(key: string, value: unknown): Promise<unknown> {
    if (this.meta.get(key) == null) this.meta.set(key, structuredClone(value));
    return structuredClone(this.meta.get(key));
  }

  async getPermanent(): Promise<PermanentGridState | null> {
    return this.permanent;
  }
  async savePermanent(state: PermanentGridState): Promise<void> {
    this.permanent = state;
  }
  async getDay(date: string): Promise<DayProgress | null> {
    return this.days.get(date) ?? null;
  }
  async saveDay(progress: DayProgress): Promise<void> {
    this.days.set(progress.date, progress);
  }
}
