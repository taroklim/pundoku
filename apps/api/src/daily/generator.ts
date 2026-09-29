import type { PuzzleGenerator } from "./types.js";
import { MISSION_RE, SOLUTION_RE } from "./types.js";

/**
 * Тонкий адаптер к генератору @pundoku/engine для фолбэка сетки дня (seed = дата).
 *
 * TODO(PD-2): движок пишется параллельно в ветке `pd-2`. Ожидаемый API движка:
 *   `generate({ difficulty, seed }) => Puzzle { givens: Grid; solution: Grid }` (Grid — 81 число 0..9).
 * Точка подключения — константа ENGINE_SPECIFIER + `loadEngine` ниже: модуль грузится динамически,
 * чтобы typecheck/тесты api не зависели от собранного dist движка. После мержа PD-2 в main можно
 * заменить на статический `import { generate } from "@pundoku/engine"` и убрать проверку типа `generate`.
 * Если в движке имя/сигнатура окажутся другими — править только `callGenerate`.
 */
const ENGINE_SPECIFIER = "@pundoku/engine";

export interface EnginePuzzleLike {
  givens: ArrayLike<number>;
  solution: ArrayLike<number>;
}

export type EngineGenerateFn = (options: { difficulty: string; seed: string }) => EnginePuzzleLike | Promise<EnginePuzzleLike>;

export interface EngineModuleLike {
  generate?: unknown;
}

export type EngineLoader = () => Promise<EngineModuleLike>;

const defaultLoader: EngineLoader = () => import(/* @vite-ignore */ ENGINE_SPECIFIER) as Promise<EngineModuleLike>;

export class EngineGenerator implements PuzzleGenerator {
  private modulePromise: Promise<EngineModuleLike> | undefined;

  constructor(private readonly loadEngine: EngineLoader = defaultLoader) {}

  async generate(seed: string, difficulty: string): Promise<{ mission: string; solution: string }> {
    this.modulePromise ??= this.loadEngine();
    let mod: EngineModuleLike;
    try {
      mod = await this.modulePromise;
    } catch (error) {
      this.modulePromise = undefined;
      throw new Error(`@pundoku/engine не загрузился: ${(error as Error).message}`, { cause: error });
    }
    if (typeof mod.generate !== "function") {
      throw new Error("@pundoku/engine пока не экспортирует generate() — генератор появится с PD-2");
    }
    const puzzle = await callGenerate(mod.generate as EngineGenerateFn, seed, difficulty);
    const mission = gridToString(puzzle.givens);
    const solution = gridToString(puzzle.solution);
    if (!MISSION_RE.test(mission) || !SOLUTION_RE.test(solution)) {
      throw new Error("@pundoku/engine вернул сетку неверного формата (ожидается 81 клетка 0..9 / 1..9)");
    }
    return { mission, solution };
  }
}

function callGenerate(generate: EngineGenerateFn, seed: string, difficulty: string): Promise<EnginePuzzleLike> {
  return Promise.resolve(generate({ difficulty, seed }));
}

function gridToString(grid: ArrayLike<number>): string {
  return Array.from(grid, (v) => String(v)).join("");
}
