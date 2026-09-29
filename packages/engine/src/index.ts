/**
 * @pundoku/engine — публичный API движка.
 *
 * Чистый ES2022 без DOM/Node-зависимостей: одинаково работает в браузере (Play, фолбэк
 * Today) и на сервере. Все данные — сериализуемые в JSON структуры, все функции чистые.
 *
 * Разделы:
 * - типы (`types.ts`), геометрия и валидация (`grid.ts`);
 * - решатель на единственность (`solver.ts`): `solve`, `countSolutions`;
 * - human-style решатель с логом техник (`human.ts`): `humanSolve`, `techniqueForCell`,
 *   `rateDifficulty`;
 * - генератор (`generator.ts`): `generate`, `dailySeed`, `dailyPuzzle`;
 * - лог ходов и метрики карточки дня (`movelog.ts`): `heatmap`, `summary`, `solvingStyle`.
 */
export type {
  Cell,
  CellValue,
  Difficulty,
  Digit,
  Elimination,
  Grid,
  GridInput,
  HumanSolveResult,
  Move,
  MoveKind,
  MoveLog,
  MoveLogSummary,
  Puzzle,
  SolvingStyle,
  Step,
  Technique,
  TechniqueOrBeyond,
} from "./types.js";

export {
  BOX_OF,
  COL_OF,
  GRID_SIZE,
  PEERS,
  ROW_OF,
  UNITS,
  candidates,
  conflicts,
  emptyGrid,
  formatGrid,
  isValidGrid,
  parseGrid,
  toGrid,
} from "./grid.js";

export { countSolutions, hasUniqueSolution, solve } from "./solver.js";

export {
  TECHNIQUE_ORDER,
  difficultyForTechnique,
  humanSolve,
  maxTechnique,
  rateDifficulty,
  techniqueForCell,
  techniqueTier,
  techniquesUsed,
} from "./human.js";
export type { HumanSolveOptions } from "./human.js";

export { DEFAULT_MAX_ATTEMPTS, GenerationError, dailyPuzzle, dailySeed, generate } from "./generator.js";
export type { GenerateOptions } from "./generator.js";

export { Rng } from "./prng.js";

export { appendMove, createMoveLog, heatmap, solvingStyle, summary } from "./movelog.js";

import type { Difficulty } from "./types.js";
export const DIFFICULTIES: readonly Difficulty[] = ["easy", "medium", "hard", "expert"];
