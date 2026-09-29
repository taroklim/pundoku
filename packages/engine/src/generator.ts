/**
 * Генератор: полная сетка → вычитание клеток с проверкой единственности после каждого
 * удаления. Детерминирован по seed (см. prng.ts). Сложность — по набору техник,
 * потребовавшихся human-style решателю, а не по числу подсказок.
 */
import { GRID_SIZE, bytesToGrid } from "./grid.js";
import { TECHNIQUE_ORDER, ratingTierBytes, techniqueTier, techniquesUsed } from "./human.js";
import { Rng } from "./prng.js";
import { countSolutionsBytes, solveBytes } from "./solver.js";
import type { Difficulty, Puzzle, Technique } from "./types.js";

export interface GenerateOptions {
  readonly difficulty: Difficulty;
  /** Любая строка; одна и та же строка → байт-в-байт та же сетка. */
  readonly seed: string;
  /** Максимум попыток попасть в класс сложности (по умолчанию `DEFAULT_MAX_ATTEMPTS` = 300). */
  readonly maxAttempts?: number;
}

/** Самая дорогая техника, разрешённая в классе (для expert — ограничений нет). */
const CAP: Record<Exclude<Difficulty, "expert">, Technique> = {
  easy: "hidden_single",
  medium: "locked_candidates",
  hard: "hidden_pair",
};

/**
 * Ниже этого числа подсказок вычитание прекращается, как только сложность попала в
 * класс (иначе easy-сетки получались бы с 25 подсказками и утомляли).
 */
const CLUE_FLOOR: Record<Difficulty, number> = {
  easy: 38,
  medium: 32,
  hard: 28,
  expert: 26,
};

export class GenerationError extends Error {
  constructor(difficulty: Difficulty, seed: string, attempts: number) {
    super(`Could not generate a '${difficulty}' puzzle for seed '${seed}' in ${attempts} attempts`);
    this.name = "GenerationError";
  }
}

function bytesToString(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < GRID_SIZE; i++) s += b[i];
  return s;
}

/** Случайная полная решённая сетка (рандомизированный backtracking). */
export function randomSolution(rng: Rng): Uint8Array {
  const full = solveBytes(new Uint8Array(GRID_SIZE), rng);
  if (full === null) throw new Error("unreachable: empty grid has solutions");
  return full;
}

/** Ярус самой дорогой техники, нужной сетке; TECHNIQUE_ORDER.length — beyond. */
function ratingTier(puzzle: Uint8Array, cap: Technique | undefined): number {
  return ratingTierBytes(puzzle, cap === undefined ? TECHNIQUE_ORDER.length - 1 : techniqueTier(cap));
}

/** Целевой ярус: easy → singles (0..1), medium → 2, hard → 3..4, expert → 5. */
function matchesTarget(tier: number, difficulty: Difficulty): boolean {
  switch (difficulty) {
    case "easy":
      return tier <= 1;
    case "medium":
      return tier === 2;
    case "hard":
      return tier === 3 || tier === 4;
    case "expert":
      return tier === TECHNIQUE_ORDER.length;
  }
}

/**
 * Одна попытка: вычитаем клетки в случайном порядке. Удаление принимается, если решение
 * остаётся единственным и (для easy/medium/hard) сетка всё ещё решается техниками не
 * дороже потолка класса. Как только подсказок ≤ CLUE_FLOOR и сложность в классе —
 * останавливаемся. Возвращает null, если класс не достигнут.
 */
function attempt(rng: Rng, difficulty: Difficulty): { mission: Uint8Array; solution: Uint8Array } | null {
  const solution = randomSolution(rng);
  const puzzle = Uint8Array.from(solution);
  const order = Uint8Array.from({ length: GRID_SIZE }, (_, i) => i);
  rng.shuffle(order);
  const cap = difficulty === "expert" ? undefined : CAP[difficulty];
  const floor = CLUE_FLOOR[difficulty];
  let clues = GRID_SIZE;
  let tier = 0;

  for (let i = 0; i < GRID_SIZE; i++) {
    const c = order[i]!;
    const d = puzzle[c]!;
    puzzle[c] = 0;
    if (countSolutionsBytes(puzzle, 2) !== 1) {
      puzzle[c] = d;
      continue;
    }
    if (cap !== undefined) {
      // Под потолком класса: не даём сетке стать сложнее целевой.
      const t = ratingTier(puzzle, cap);
      if (t > techniqueTier(cap)) {
        puzzle[c] = d;
        continue;
      }
      tier = t;
    }
    clues--;
    if (clues <= floor) {
      if (cap === undefined) tier = ratingTier(puzzle, undefined);
      if (matchesTarget(tier, difficulty)) break;
    }
  }
  if (cap === undefined) tier = ratingTier(puzzle, undefined);
  return matchesTarget(tier, difficulty) ? { mission: puzzle, solution } : null;
}

/**
 * Потолок числа попыток по умолчанию. По замеру (README «Попытки и время генерации») hard в худшем
 * случае требует ~90 попыток, поэтому прежние 100 были на грани; 300 даёт трёхкратный запас.
 * RNG последовательный (каждая попытка продолжает поток предыдущей), так что увеличение потолка
 * НЕ меняет уже существующие сетки — только превращает бывший `GenerationError` в успех.
 */
export const DEFAULT_MAX_ATTEMPTS = 300;

/** Сетка + сколько попыток понадобилось (диагностика/замеры; в публичный `Puzzle` не входит). */
export function generateWithStats(options: GenerateOptions): { puzzle: Puzzle; attempts: number } {
  const { difficulty, seed } = options;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const rng = new Rng(`${seed}\0${difficulty}`);
  for (let i = 0; i < maxAttempts; i++) {
    const res = attempt(rng, difficulty);
    if (res === null) continue;
    const mission = bytesToString(res.mission);
    return {
      attempts: i + 1,
      puzzle: {
        mission,
        givens: bytesToGrid(res.mission),
        solution: bytesToString(res.solution),
        difficulty,
        seed,
        techniques: techniquesUsed(mission),
      },
    };
  }
  throw new GenerationError(difficulty, seed, maxAttempts);
}

/**
 * Генерирует сетку заданной сложности детерминированно по seed. Бросает
 * `GenerationError`, если за `maxAttempts` (по умолчанию `DEFAULT_MAX_ATTEMPTS` = 300) попыток
 * класс не достигнут; на практике медиана — единицы попыток, максимум по замеру ~90.
 */
export function generate(options: GenerateOptions): Puzzle {
  return generateWithStats(options).puzzle;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Реальная календарная дата (григорианская), а не просто «похожая на дату» строка. */
function isRealDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!;
  return d <= dim;
}

/**
 * Seed для фолбэка Today: дата `YYYY-MM-DD` + сложность. Одна дата → одна сетка у всех.
 * Это единая конвенция сетки дня для сервера и офлайн-клиента: seed нельзя собирать вручную.
 * @throws {RangeError} если дата не в формате YYYY-MM-DD или не существует в календаре
 *   (`2026-13-45`, `2026-02-30`, мусор).
 */
export function dailySeed(date: string, difficulty: Difficulty): string {
  if (!DATE_RE.test(date)) throw new RangeError(`Date must be YYYY-MM-DD, got '${date}'`);
  if (!isRealDate(date)) throw new RangeError(`Date '${date}' does not exist in the calendar`);
  return `${date}/${difficulty}`;
}

/** Сетка дня из фолбэка: `generate({ difficulty, seed: dailySeed(date, difficulty) })`. */
export function dailyPuzzle(date: string, difficulty: Difficulty): Puzzle {
  return generate({ difficulty, seed: dailySeed(date, difficulty) });
}
