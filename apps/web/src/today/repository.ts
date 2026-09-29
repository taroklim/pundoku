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
