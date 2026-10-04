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
 * - генератор (`generator.ts`): `generate`, `dailySeed`, `dailyPuzzle`; сложность по двум осям
 *   (подсказки × техника) — `difficulty.ts`: `DIFFICULTIES`, `DIFFICULTY_PROFILES`;
 * - лог ходов и метрики карточки дня (`movelog.ts`): `heatmap`, `summary`, `solvingStyle`;
 * - Чернильный режим (`ink.ts`): правила `INK_RULES`/`inkAllows`, кляксы лога, проверка лога.
 * - лесенка подсказок (`hint.ts`): `nextHint`.
 * - таймлапс и отпечаток прохождения (`timelapse.ts`): `timelapseFrames`, `timelapseFingerprint`.
 * - Лжец (`liar.ts`, PD-165): `generateLiar`, `dailyLiarPuzzle`, `validateLiar`, `accuse`, `liarSummary`.
 */
export type {
  Cell,
  CellValue,
  Difficulty,
  DifficultyProfile,
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

export {
  DEFAULT_MAX_ATTEMPTS,
  GENERATOR_VERSION,
  GenerationError,
  dailyPuzzle,
  dailySeed,
  generate,
} from "./generator.js";
export { DIFFICULTIES, DIFFICULTY_PROFILES, EASY_MIN_CLUES } from "./difficulty.js";
export type { GenerateOptions } from "./generator.js";

export { nextHint } from "./hint.js";
export type {
  Hint,
  HintCells,
  HintExplanation,
  HintExplanationId,
  HintLead,
  HintPlacement,
  HintRegion,
  HintRegionKind,
  HintState,
  MistakeHint,
  NoHint,
  NoHintReason,
  StepHint,
} from "./hint.js";

export { Rng } from "./prng.js";

export { INK_RULES, blotsOf, inkAllows, inkViolations, isBlotMistake, isBlotMove } from "./ink.js";
export type { Blot, InkRules, InkViolation } from "./ink.js";

export { appendMove, createMoveLog, heatmap, solvingStyle, summary } from "./movelog.js";

export { DEFAULT_MAX_GAP_MS, timelapseFingerprint, timelapseFrames } from "./timelapse.js";
export type {
  FingerprintCell,
  FingerprintOptions,
  Timelapse,
  TimelapseFingerprint,
  TimelapseFrame,
  TimelapseOptions,
} from "./timelapse.js";

export {
  LIAR_DEFAULT_MAX_BASES,
  LIAR_MIN_DEPTH,
  LIAR_VERSION,
  LiarGenerationError,
  accuse,
  dailyLiarPuzzle,
  dailyLiarSeed,
  generateLiar,
  liarSummary,
  validateLiar,
} from "./liar.js";
export type {
  Accusation,
  AccusationVerdict,
  GenerateLiarOptions,
  LiarFailure,
  LiarMeta,
  LiarPuzzle,
  LiarSummary,
  LiarValidation,
  ValidateLiarOptions,
} from "./liar.js";
