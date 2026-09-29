/**
 * Генератор: полная сетка → вычитание клеток с проверкой единственности после каждого
 * удаления. Детерминирован по seed (см. prng.ts). Сложность — две оси: ровно целевое число
 * подсказок (`DIFFICULTY_PROFILES[difficulty].clues` либо `options.clues`) и самая дорогая
 * техника, потребовавшаяся human-style решателю (см. difficulty.ts).
 */
import { DIFFICULTY_PROFILES } from "./difficulty.js";
import { GRID_SIZE, bytesToGrid } from "./grid.js";
import { TECHNIQUE_ORDER, ratingTierBytes, techniqueTier, techniquesUsed } from "./human.js";
import { Rng } from "./prng.js";
import { countSolutionsBytes, solveBytes } from "./solver.js";
import type { Difficulty, Puzzle } from "./types.js";

/**
 * Версия алгоритма генерации. Любое изменение, меняющее сетки для существующих seed (профили
 * сложности, порядок вычитания, PRNG, техники решателя), обязано поднять её и попасть в changelog
 * README («Версии алгоритма»). Версия в PRNG-seed не подмешивается — её удерживают снапшот-тесты.
 */
export const GENERATOR_VERSION = 2;

/** Минимально осмысленное число подсказок (нижняя граница для судоку с единственным решением). */
const MIN_CLUES = 17;

export interface GenerateOptions {
  readonly difficulty: Difficulty;
  /** Любая строка; одна и та же строка → байт-в-байт та же сетка. */
  readonly seed: string;
  /** Максимум попыток попасть в профиль (по умолчанию `DEFAULT_MAX_ATTEMPTS`). Целое ≥ 1, иначе `RangeError`. */
  readonly maxAttempts?: number;
  /**
   * Целевое число подсказок — вторая ось сложности; по умолчанию из `DIFFICULTY_PROFILES`
   * (easy 38, medium 30, hard 26, expert 24, master 24). Сетка получает ровно столько подсказок.
   * Целое число в 17..80, иначе `RangeError` (в т. ч. `null`). Нижняя часть диапазона практически
   * недостижима: при 300 попытках ≤ 20 подсказок не получается ни в одном классе, 21–22 — нестабильно
   * (`GenerationError`), стабильно — от ~23 (README «Как определяется сложность»). Значение не по умолчанию даёт другую сетку, чем
   * дефолт, а `rateDifficulty` такой сетки может не совпасть с `difficulty` (техническая ось
   * гарантируется, ярлык singles-сетки medium/easy определяется числом подсказок).
   */
  readonly clues?: number;
}

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

/** Ярус самой дорогой техники, нужной сетке (не глубже `maxTier`); TECHNIQUE_ORDER.length — beyond. */
function ratingTier(puzzle: Uint8Array, maxTier: number): number {
  return ratingTierBytes(puzzle, maxTier);
}

/**
 * Требуемый класс техники: ярус сетки в пределах цели профиля. singles — «не дороже» (0..1),
 * locked — ровно locked (2), pairs — naked/hidden pair (3..4), beyond — застрял (5).
 */
function matchesTechnique(tier: number, target: number): boolean {
  if (target <= 1) return tier <= 1;
  if (target === 2) return tier === 2;
  if (target <= 4) return tier === 3 || tier === 4;
  return tier === TECHNIQUE_ORDER.length;
}

/**
 * Одна попытка: вычитаем клетки в случайном порядке, пока подсказок не станет ровно `clues`.
 * Удаление принимается, если решение остаётся единственным и (для классов с потолком техники)
 * сетка всё ещё решается техниками не дороже потолка. Возвращает null, если ровно `clues`
 * не достигнуто (дальше вычитать нечего) либо техническая ось не совпала с классом.
 */
function attempt(rng: Rng, clues: number, target: number): { mission: Uint8Array; solution: Uint8Array } | null {
  const solution = randomSolution(rng);
  const puzzle = Uint8Array.from(solution);
  const order = Uint8Array.from({ length: GRID_SIZE }, (_, i) => i);
  rng.shuffle(order);
  const beyond = target === TECHNIQUE_ORDER.length;
  const capTier = beyond ? TECHNIQUE_ORDER.length - 1 : target;
  let left = GRID_SIZE;

  for (let i = 0; i < GRID_SIZE && left > clues; i++) {
    const c = order[i]!;
    const d = puzzle[c]!;
    puzzle[c] = 0;
    if (countSolutionsBytes(puzzle, 2) !== 1) {
      puzzle[c] = d;
      continue;
    }
    // Под потолком класса: не даём сетке стать сложнее целевой. Для master потолка нет.
    if (!beyond && ratingTier(puzzle, capTier) > capTier) {
      puzzle[c] = d;
      continue;
    }
    left--;
  }
  if (left !== clues) return null;
  const tier = ratingTier(puzzle, TECHNIQUE_ORDER.length - 1);
  return matchesTechnique(tier, target) ? { mission: puzzle, solution } : null;
}

/**
 * Потолок числа попыток по умолчанию. По замеру v2 (README «Попытки и время генерации») худший класс —
 * expert: максимум 138 попыток на 3000 seed (медиана 14), поэтому 300 даёт запас ≈ 2× к максимуму.
 * RNG последовательный (каждая попытка продолжает поток предыдущей), так что увеличение потолка
 * НЕ меняет уже существующие сетки — только превращает бывший `GenerationError` в успех.
 */
export const DEFAULT_MAX_ATTEMPTS = 300;

/** Сетка + сколько попыток понадобилось (диагностика/замеры; в публичный `Puzzle` не входит). */
export function generateWithStats(options: GenerateOptions): { puzzle: Puzzle; attempts: number } {
  const { difficulty, seed } = options;
  // hasOwn, а не индексация: `constructor`/`toString`/`__proto__` — не сложности, а свойства прототипа.
  if (typeof difficulty !== "string" || !Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) {
    throw new RangeError(`Unknown difficulty '${String(difficulty)}'`);
  }
  const profile = DIFFICULTY_PROFILES[difficulty];
  // `null` — не «не задано»: явный null/NaN/строка отвергаются, а не молча заменяются дефолтом.
  const clues = options.clues === undefined ? profile.clues : options.clues;
  if (!Number.isInteger(clues) || clues < MIN_CLUES || clues >= GRID_SIZE) {
    throw new RangeError(`clues must be an integer in ${MIN_CLUES}..${GRID_SIZE - 1}, got ${String(clues)}`);
  }
  const maxAttempts = options.maxAttempts === undefined ? DEFAULT_MAX_ATTEMPTS : options.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be an integer >= 1, got ${String(maxAttempts)}`);
  }
  // Дефолтные подсказки → ключ `${seed}\0${difficulty}`; своё число подсказок — другая сетка (свой ключ).
  const rng = new Rng(clues === profile.clues ? `${seed}\0${difficulty}` : `${seed}\0${difficulty}\0${clues}`);
  const target = techniqueTier(profile.technique);
  for (let i = 0; i < maxAttempts; i++) {
    const res = attempt(rng, clues, target);
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
 * профиль (число подсказок × техника) не достигнут; на практике медиана — от 1 до 14 попыток, максимум по замеру — 138 (expert, 3000 seed).
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
