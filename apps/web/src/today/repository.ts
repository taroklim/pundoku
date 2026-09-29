/**
 * Хранилище личного прогресса Today (PD-12): состояние постоянной сетки и прогресс дня.
 *
 * Интерфейс асинхронный намеренно: PD-14 подставит реализацию на IndexedDB + синхронизацию
 * снапшота с сервером (`PUT/GET /api/snapshot`), не трогая ни `DayStore`, ни экран.
 * Здесь — только `InMemoryProgressRepository`: localStorage не используется, за перезагрузкой
 * страницы данные НЕ переживают (осознанное решение тикета; персистентность — PD-14).
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
}

export interface ProgressRepository {
  getPermanent(): Promise<PermanentGridState | null>;
  savePermanent(state: PermanentGridState): Promise<void>;
  getDay(date: string): Promise<DayProgress | null>;
  saveDay(progress: DayProgress): Promise<void>;
}

export class InMemoryProgressRepository implements ProgressRepository {
  private permanent: PermanentGridState | null = null;
  private days = new Map<string, DayProgress>();

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
