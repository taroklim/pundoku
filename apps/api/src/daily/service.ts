import type { DailyPuzzle, DailyPuzzleRepo, DailyPuzzleSource, NewDailyPuzzle, PuzzleGenerator, SourceResult } from "./types.js";
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
  /**
   * Минимальный интервал между обращениями к Sudoku.com за одной датой (мс), пока в кэше лежит
   * фолбэк-сетка: чтобы мёртвый источник не тормозил каждый запрос таймаутом. По умолчанию 60 с.
   */
  upstreamRetryMs?: number;
}

const DEFAULT_UPSTREAM_RETRY_MS = 60_000;

/**
 * Сетка дня: кэш → Sudoku.com → генератор (`dailyPuzzle` движка: seed = `dailySeed(date, difficulty)`).
 * Сохранённая сетка Sudoku.com неизменна. Фолбэк-сетка (source='generator') временная: следующий
 * запрос на эту дату перезапрашивает Sudoku.com и, если тот ответил, заменяет сетку настоящей
 * (source→'sudoku.com', replaced_at) — у всех клиентов дальше одна и та же сетка.
 *
 * Правила по датам (всё в UTC):
 *  - date > today+1  → 400 future_date (даже у клиента в UTC+14 локальная дата ≤ UTC+1).
 *  - date == today+1 и Sudoku.com не дал сетку → 404 not_available_yet, без кэша и без генератора:
 *    иначе «завтрашняя» сгенерированная сетка попала бы в кэш раньше настоящей.
 *  - date <= today и Sudoku.com недоступен/невалиден → генератор, сохраняем как source='generator'.
 *  - Sudoku.com недоступен И генератор упал → 503 daily_unavailable.
 *
 * Версионирование фолбэка (PD-14): строка `source='generator'` хранит `generator_version` — версию
 * алгоритма движка (`GENERATOR_VERSION`), которой она создана. Строки с другой версией (и без версии —
 * до миграции 0005) игнорируются и пересоздаются при запросе: сначала пробуем Sudoku.com, иначе
 * генерируем заново текущей версией. Если движок версию не отдаёт — строка отдаётся как есть.
 */
export class DailyService {
  /** Когда последний раз ходили в Sudoku.com за датой (мс epoch); для троттлинга перезапроса. */
  private readonly lastUpstreamAt = new Map<string, number>();

  constructor(private readonly deps: DailyServiceDeps) {}

  private nowDate(): Date {
    return this.deps.now?.() ?? new Date();
  }

  today(): string {
    return todayUtc(this.nowDate());
  }

  /** Проверяет только «не слишком ли далеко в будущем» — формат даты валидирует роутер. */
  assertDateAllowed(date: string): void {
    const latest = addDays(this.today(), 1);
    if (date > latest) {
      throw new HttpError(400, "future_date", `Сетка на ${date} ещё не существует (последняя доступная — ${latest}, UTC)`);
    }
  }

  private async fetchUpstream(date: string): Promise<SourceResult> {
    this.lastUpstreamAt.set(date, this.nowDate().getTime());
    const result = await this.deps.source.fetch(date);
    this.deps.logger.info({ date, upstream: "sudoku.com", outcome: result.kind }, "daily: запрос к Sudoku.com");
    return result;
  }

  private toNew(date: string, puzzle: Extract<SourceResult, { kind: "ok" }>["puzzle"]): NewDailyPuzzle {
    return {
      date,
      mission: puzzle.mission,
      solution: puzzle.solution,
      difficulty: puzzle.difficulty,
      winRate: puzzle.winRate,
      source: "sudoku.com",
      sourceId: puzzle.id || null,
    };
  }

  /** Текущая версия генератора; `null` — движок её не отдаёт (не собран/старый dist): устаревание не определить. */
  private async currentGeneratorVersion(): Promise<number | null> {
    try {
      return await this.deps.generator.version();
    } catch (error) {
      this.deps.logger.warn({ err: error }, "daily: версия генератора недоступна, устаревание фолбэк-строк не проверяется");
      return null;
    }
  }

  /** Можно ли сейчас идти в Sudoku.com за датой (троттлинг перезапросов, пока в кэше фолбэк). */
  private upstreamDue(date: string): boolean {
    const last = this.lastUpstreamAt.get(date);
    const retryMs = this.deps.upstreamRetryMs ?? DEFAULT_UPSTREAM_RETRY_MS;
    return last === undefined || this.nowDate().getTime() - last >= retryMs;
  }

  async get(date: string): Promise<DailyPuzzle> {
    this.assertDateAllowed(date);
    const cached = await this.deps.repo.find(date);
    if (cached && cached.source !== "generator") return cached;

    // Фолбэк-строка версии алгоритма, отличной от текущей (или без версии), считается отсутствующей:
    // ниже она пересоздаётся (настоящей сеткой Sudoku.com либо генератором текущей версии).
    let stale = false;
    let version: number | null = null;
    if (cached) {
      version = await this.currentGeneratorVersion();
      if (version === null || cached.generatorVersion === version) return this.tryReplaceFallback(cached);
      stale = true;
      this.deps.logger.info({ date, rowVersion: cached.generatorVersion, currentVersion: version }, "daily: фолбэк-строка устарела (GENERATOR_VERSION), пересоздаём");
    }
    const store = (p: NewDailyPuzzle): Promise<DailyPuzzle> =>
      stale ? this.deps.repo.replaceStale(p, version as number) : this.deps.repo.insertIfAbsent(p);

    const { generator, logger } = this.deps;
    const result: SourceResult = stale && !this.upstreamDue(date) ? { kind: "error", reason: "throttled" } : await this.fetchUpstream(date);
    if (result.kind === "ok") return store(this.toNew(date, result.puzzle));

    if (date > this.today()) {
      logger.info({ date, result }, "daily: завтрашняя сетка у источника ещё не доступна");
      throw notFound("not_available_yet", `Сетка на ${date} ещё не опубликована, попробуй позже`);
    }

    logger.warn({ date, result }, "daily: Sudoku.com недоступен, генерируем сетку по dailySeed(date, difficulty)");
    let generated: { mission: string; solution: string };
    try {
      version ??= await this.currentGeneratorVersion();
      generated = await generator.generateDaily(date, this.deps.fallbackDifficulty);
    } catch (error) {
      logger.error({ date, err: error, upstream: result }, "daily: Sudoku.com недоступен и генератор не сработал");
      throw new HttpError(503, "daily_unavailable", `Сетка на ${date} сейчас недоступна: источник и фолбэк-генератор не ответили, попробуй позже`);
    }
    return store({
      date,
      mission: generated.mission,
      solution: generated.solution,
      difficulty: this.deps.fallbackDifficulty,
      winRate: null,
      source: "generator",
      sourceId: null,
      generatorVersion: version,
    });
  }

  /** Кэш держит фолбэк: пробуем получить настоящую сетку; любая неудача — отдаём то, что есть. */
  private async tryReplaceFallback(cached: DailyPuzzle): Promise<DailyPuzzle> {
    const { date } = cached;
    if (!this.upstreamDue(date)) return cached;

    const result = await this.fetchUpstream(date);
    if (result.kind !== "ok") return cached;
    const replaced = await this.deps.repo.replaceGenerated(this.toNew(date, result.puzzle));
    if (replaced.replacedAt) {
      this.deps.logger.info({ date, sourceId: replaced.sourceId }, "daily: фолбэк-сетка заменена сеткой Sudoku.com");
    }
    return replaced;
  }
}
