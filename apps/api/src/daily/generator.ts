import type { PuzzleGenerator } from "./types.js";
import { MISSION_RE, SOLUTION_RE } from "./types.js";

/**
 * Тонкий адаптер к @pundoku/engine для фолбэка сетки дня.
 *
 * ЕДИНАЯ seed-конвенция сетки дня: фолбэк = `dailyPuzzle(date, difficulty)` движка
 * (seed = `dailySeed(date, difficulty)`, например `2026-09-29/hard`). Сервер и офлайн-клиент
 * обязаны звать именно эти функции, а не собирать seed вручную (`seed: date` даёт другую сетку) —
 * иначе клиент без сети покажет не ту сетку, что закэшировал сервер. Закреплено тестом
 * `generator.test.ts` (api-фолбэк === `dailyPuzzle` движка).
 *
 * Модуль движка грузится динамически (`loadEngine`), чтобы typecheck/тесты api не зависели от
 * собранного dist движка; в тестах подменяется фейком.
 */
const ENGINE_SPECIFIER = "@pundoku/engine";

export interface EnginePuzzleLike {
  givens: ArrayLike<number>;
  solution: ArrayLike<number>;
}

export type EngineDailyPuzzleFn = (date: string, difficulty: string) => EnginePuzzleLike | Promise<EnginePuzzleLike>;

export interface EngineModuleLike {
  dailyPuzzle?: unknown;
}

export type EngineLoader = () => Promise<EngineModuleLike>;

const defaultLoader: EngineLoader = () => import(/* @vite-ignore */ ENGINE_SPECIFIER) as Promise<EngineModuleLike>;

export class EngineGenerator implements PuzzleGenerator {
  private modulePromise: Promise<EngineModuleLike> | undefined;

  constructor(private readonly loadEngine: EngineLoader = defaultLoader) {}

  async generateDaily(date: string, difficulty: string): Promise<{ mission: string; solution: string }> {
    this.modulePromise ??= this.loadEngine();
    let mod: EngineModuleLike;
    try {
      mod = await this.modulePromise;
    } catch (error) {
      this.modulePromise = undefined;
      throw new Error(`@pundoku/engine не загрузился: ${(error as Error).message}`, { cause: error });
    }
    if (typeof mod.dailyPuzzle !== "function") {
      throw new Error("@pundoku/engine не экспортирует dailyPuzzle() — нужна версия движка с PD-8");
    }
    const puzzle = await (mod.dailyPuzzle as EngineDailyPuzzleFn)(date, difficulty);
    const mission = gridToString(puzzle.givens);
    const solution = gridToString(puzzle.solution);
    if (!MISSION_RE.test(mission) || !SOLUTION_RE.test(solution)) {
      throw new Error("@pundoku/engine вернул сетку неверного формата (ожидается 81 клетка 0..9 / 1..9)");
    }
    return { mission, solution };
  }
}

function gridToString(grid: ArrayLike<number>): string {
  return Array.from(grid, (v) => String(v)).join("");
}
