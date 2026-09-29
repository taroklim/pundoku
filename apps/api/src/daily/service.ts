import type { DailyPuzzle, DailyPuzzleRepo, DailyPuzzleSource, PuzzleGenerator } from "./types.js";
import { HttpError, notFound } from "../lib/errors.js";
import { addDays, todayUtc } from "../lib/date.js";
import type { Logger } from "../lib/logger.js";

export interface DailyServiceDeps {
  repo: DailyPuzzleRepo;
  source: DailyPuzzleSource;
  generator: PuzzleGenerator;
  fallbackDifficulty: string;
  logger: Logger;
  now?: () => Date;
}

/**
 * Сетка дня: кэш → Sudoku.com → генератор (`dailyPuzzle` движка: seed = `dailySeed(date, difficulty)`). Что бы ни стало источником —
 * результат сохраняется навсегда, чтобы у всех клиентов на эту дату была одна и та же сетка.
 *
 * Правила по датам (всё в UTC):
 *  - date > today+1  → 400 future_date (даже у клиента в UTC+14 локальная дата ≤ UTC+1).
 *  - date == today+1 и Sudoku.com не дал сетку → 404 not_available_yet, без кэша и без генератора:
 *    иначе «завтрашняя» сгенерированная сетка навсегда заменила бы сетку Sudoku.com.
 *  - date <= today и Sudoku.com недоступен/невалиден → генератор, сохраняем как source='generator'.
 */
export class DailyService {
  constructor(private readonly deps: DailyServiceDeps) {}

  today(): string {
    return todayUtc(this.deps.now?.() ?? new Date());
  }

  /** Проверяет только «не слишком ли далеко в будущем» — формат даты валидирует роутер. */
  assertDateAllowed(date: string): void {
    const latest = addDays(this.today(), 1);
    if (date > latest) {
      throw new HttpError(400, "future_date", `Сетка на ${date} ещё не существует (последняя доступная — ${latest}, UTC)`);
    }
  }

  async get(date: string): Promise<DailyPuzzle> {
    this.assertDateAllowed(date);
    const cached = await this.deps.repo.find(date);
    if (cached) return cached;

    const { source, repo, generator, logger } = this.deps;
    const result = await source.fetch(date);
    if (result.kind === "ok") {
      const { puzzle } = result;
      return repo.insertIfAbsent({
        date,
        mission: puzzle.mission,
        solution: puzzle.solution,
        difficulty: puzzle.difficulty,
        winRate: puzzle.winRate,
        source: "sudoku.com",
        sourceId: puzzle.id || null,
      });
    }

    if (date > this.today()) {
      logger.info({ date, result }, "daily: завтрашняя сетка у источника ещё не доступна");
      throw notFound("not_available_yet", `Сетка на ${date} ещё не опубликована, попробуй позже`);
    }

    logger.warn({ date, result }, "daily: Sudoku.com недоступен, генерируем сетку по seed = дата");
    const generated = await generator.generateDaily(date, this.deps.fallbackDifficulty);
    return repo.insertIfAbsent({
      date,
      mission: generated.mission,
      solution: generated.solution,
      difficulty: this.deps.fallbackDifficulty,
      winRate: null,
      source: "generator",
      sourceId: null,
    });
  }
}
