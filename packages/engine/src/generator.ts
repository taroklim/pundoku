/**
 * Генератор: полная сетка → вычитание клеток с проверкой единственности после каждого
 * удаления. Детерминирован по seed (см. prng.ts). Сложность — две оси: ровно целевое число
 * подсказок (`DIFFICULTY_PROFILES[difficulty].clues` либо `options.clues`) и самая дорогая
 * техника, потребовавшаяся human-style решателю (см. difficulty.ts).
 */
import { DIFFICULTY_PROFILES } from "./difficulty.js";
import { GRID_SIZE, bytesToGrid } from "./grid.js";
import { TECHNIQUE_ORDER, ratingTierBytes, techniqueTier, techniquesUsed } from "./human.js";
import { FISH_BASES, FISH_BASE_CLUES } from "./fish-corpus.js";
import { Rng } from "./prng.js";
import { randomIsomorph } from "./symmetry.js";
import { countSolutionsBytes, solveBytes } from "./solver.js";
import type { Difficulty, Puzzle } from "./types.js";

/**
 * Версия алгоритма генерации. Любое изменение, меняющее сетки для существующих seed (профили
 * сложности, порядок вычитания, PRNG, техники решателя), обязано поднять её и попасть в changelog
 * README («Версии алгоритма»). Версия в PRNG-seed не подмешивается — её удерживают снапшот-тесты.
 * PD-304 (рыбы, expert_plus, noXWing) версию осознанно не поднял: сетки easy..expert и сетка дня не изменились,
 * изменился только master (≈ 2 % seed), см. README «Версии алгоритма».
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
   * недостижима: при 300 попытках ≤ 20 подсказок не получается ни в одном классе, 21 — у части seed
   * (иначе `GenerationError`), 22–23 и выше — стабильно; разумный минимум — около 23 (README движка,
   * «Как определяется сложность»). Значение не по умолчанию даёт другую сетку, чем дефолт, а `rateDifficulty` такой сетки может не совпасть с `difficulty` (техническая ось
   * гарантируется, ярлык singles-сетки medium/easy определяется числом подсказок).
   */
  readonly clues?: number;
  /**
   * PD-304: принимать только сетки, решаемые техниками строго ниже X-Wing (singles, locked candidates,
   * naked/hidden pairs) — без рыб и без перебора; решение, как всегда, единственное. Классы easy..expert
   * и так ограничены потолком hidden_pair, поэтому для них опция — гарантия контракта, а не другой отбор:
   * сетка байт-в-байт та же, что без опции (тот же seed-ключ). expert_plus и master требуют X-Wing и выше —
   * с `noXWing: true` они несовместимы → `RangeError`. По умолчанию false.
   */
  readonly noXWing?: boolean;
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

const BEYOND_TIER = TECHNIQUE_ORDER.length;
const FISH_TIER = techniqueTier("x_wing");
/** Потолок `noXWing`: самая дорогая техника строго ниже X-Wing. */
const BELOW_X_WING_TIER = techniqueTier("hidden_pair");

/**
 * Полоса ярусов, которую требует класс (`lo..hi`): singles — «не дороже» (naked..hidden single), locked — ровно
 * locked, pairs — naked/hidden pair, рыбы — X-Wing/Swordfish (PD-304), beyond — застрял на всех техниках.
 * `hi` — потолок при вычитании (для beyond потолка нет).
 */
function techniqueBand(target: number): { lo: number; hi: number } {
  if (target <= techniqueTier("hidden_single")) return { lo: 0, hi: techniqueTier("hidden_single") };
  if (target === techniqueTier("locked_candidates")) return { lo: target, hi: target };
  if (target <= techniqueTier("hidden_pair")) return { lo: techniqueTier("naked_pair"), hi: techniqueTier("hidden_pair") };
  if (target <= techniqueTier("swordfish")) return { lo: techniqueTier("x_wing"), hi: techniqueTier("swordfish") };
  return { lo: BEYOND_TIER, hi: BEYOND_TIER };
}

/**
 * Одна попытка: вычитаем клетки в случайном порядке, пока подсказок не станет ровно `clues`.
 * Удаление принимается, если решение остаётся единственным и (для классов с потолком техники)
 * сетка всё ещё решается техниками не дороже потолка. Возвращает null, если ровно `clues`
 * не достигнуто (дальше вычитать нечего) либо техническая ось не попала в полосу класса.
 *
 * Потолок — `band.hi` (а не цель профиля): для singles/locked/pairs это тот же ярус, что и до PD-304
 * (hidden_single / locked / hidden_pair), поэтому поток RNG и сетки easy..expert прежние.
 */
function attempt(rng: Rng, clues: number, band: { lo: number; hi: number }): { mission: Uint8Array; solution: Uint8Array } | null {
  const solution = randomSolution(rng);
  const puzzle = Uint8Array.from(solution);
  const order = Uint8Array.from({ length: GRID_SIZE }, (_, i) => i);
  rng.shuffle(order);
  const beyond = band.lo === BEYOND_TIER;
  const capTier = beyond ? BEYOND_TIER - 1 : band.hi;
  // Только рыбы (PD-304): как только сетке понадобилась рыба, дальнейшие вычитания обязаны её сохранить —
  // иначе редкое состояние «нужен X-Wing» теряется следующим удалением. Для прочих классов флаг не взводится.
  const latch = band.lo === FISH_TIER;
  let reached = false;
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
    if (!beyond) {
      const t = ratingTier(puzzle, capTier);
      if (t > capTier || (reached && t < band.lo)) {
        puzzle[c] = d;
        continue;
      }
      if (latch && t >= band.lo) reached = true;
    }
    left--;
  }
  if (left !== clues) return null;
  const tier = ratingTier(puzzle, BEYOND_TIER - 1);
  return tier >= band.lo && tier <= band.hi ? { mission: puzzle, solution } : null;
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
  const noXWing = options.noXWing === undefined ? false : options.noXWing;
  if (typeof noXWing !== "boolean") throw new RangeError(`noXWing must be a boolean, got ${String(noXWing)}`);
  const band = techniqueBand(techniqueTier(profile.technique));
  if (noXWing && band.hi > BELOW_X_WING_TIER) {
    throw new RangeError(`noXWing is incompatible with difficulty '${difficulty}' (it requires X-Wing or beyond)`);
  }
  // Дефолтные подсказки → ключ `${seed}\0${difficulty}`; своё число подсказок — другая сетка (свой ключ).
  // `noXWing` в ключ не входит: допускается только там, где потолок класса и так ниже X-Wing, то есть отбор
  // тот же и сетка та же (см. `GenerateOptions.noXWing`).
  const rng = new Rng(clues === profile.clues ? `${seed}\0${difficulty}` : `${seed}\0${difficulty}\0${clues}`);
  const viaCorpus = band.lo === FISH_TIER && clues === FISH_BASE_CLUES;
  for (let i = 0; i < maxAttempts; i++) {
    const res = viaCorpus ? fromFishCorpus(rng) : attempt(rng, clues, band);
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
 * Внутреннее (скрипт `scripts/build-fish-corpus.ts`): чистый поиск сетки класса вычитанием — тот же путь, что у
 * остальных классов, без корпуса. Для expert_plus это медленно (замер PD-304: медиана ≈ 1–5 с в Node, хвост
 * десятки секунд) — поэтому в рантайме expert_plus с дефолтными подсказками идёт через корпус (`fromFishCorpus`).
 */
export function searchWithStats(difficulty: Difficulty, seed: string, maxAttempts: number): { mission: string; solution: string; attempts: number } | null {
  const profile = DIFFICULTY_PROFILES[difficulty];
  const band = techniqueBand(techniqueTier(profile.technique));
  const rng = new Rng(`${seed}\0${difficulty}\0search`);
  for (let i = 0; i < maxAttempts; i++) {
    const res = attempt(rng, profile.clues, band);
    if (res !== null) return { mission: bytesToString(res.mission), solution: bytesToString(res.solution), attempts: i + 1 };
  }
  return null;
}

/**
 * expert_plus (PD-304): сетка из корпуса базовых сеток (`fish-corpus.ts` — найдены этим же генератором офлайн,
 * `searchWithStats`) под случайной симметрией судоку (перестановка цифр, строк внутри полос, полос, столбцов внутри
 * стеков, стеков, транспонирование — ≈ 1,2·10⁹ вариантов на базу). Симметрия сохраняет единственность решения и
 * техники; ярус всё равно перепроверяется — вне полосы рыб попытка не засчитывается (не наблюдалось).
 */
function fromFishCorpus(rng: Rng): { mission: Uint8Array; solution: Uint8Array } | null {
  const base = FISH_BASES[rng.int(FISH_BASES.length)]!;
  const mission = randomIsomorph(rng, Uint8Array.from(base, (ch) => Number(ch)));
  const solution = solveBytes(mission);
  if (solution === null) return null;
  const tier = ratingTier(mission, BEYOND_TIER - 1);
  return tier >= FISH_TIER && tier <= techniqueTier("swordfish") ? { mission, solution } : null;
}

/**
 * Генерирует сетку заданной сложности детерминированно по seed. Бросает
 * `GenerationError`, если за `maxAttempts` (по умолчанию `DEFAULT_MAX_ATTEMPTS` = 300) попыток
 * профиль (число подсказок × техника) не достигнут; на практике медиана — от 1 до 14 попыток, максимум по замеру — 138 (expert, 3000 seed).
 * expert_plus с дефолтными подсказками — корпус под симметрией (`fromFishCorpus`), обычно 1 попытка.
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
