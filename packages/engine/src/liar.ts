/**
 * Лжец (релиз 2, PD-165): судоку, в котором ровно одна данная подсказка ложна.
 *
 * Генератор: честная сетка класса `difficulty` (обычный `generate`, тот же профиль подсказки × техника)
 * + одна ложная цифра в одну из её пустых клеток. Валидатор `validateLiar` проверяет критерий честности
 * (отчёт 05 §3, точная формулировка — README пакета, «Лжец»):
 *
 * 1. Опровержимость — сетка со всеми подсказками не имеет ни одного решения.
 * 2. Однозначность (строгая) — удаление любой другой подсказки оставляет 0 решений: лжец ровно один,
 *    второго кандидата «на лжеца» нет вообще (а не только «нет второго с единственным решением»).
 * 3. Доразрешимость — после удаления лжеца решение ровно одно.
 * 4. Нетривиальность — (а) на старте ложь не видна: нет повтора цифры в строке/столбце/блоке, у каждой
 *    пустой клетки есть кандидат, у каждой цифры есть место в каждом юните; (б) противоречие выводимо
 *    техниками не дороже потолка класса (human-решатель упирается в клетку без кандидатов, а не застревает);
 *    (в) до противоречия решатель честно ставит не меньше `minDepth` цифр.
 *
 * Без DOM, чистые функции, детерминированно по seed — как весь пакет.
 */
import { DIFFICULTY_PROFILES } from "./difficulty.js";
import { generate, dailySeed } from "./generator.js";
import { ALL_DIGITS_MASK, GRID_SIZE, UNITS, assertCell, bytesToGrid, peerMask, toBytes } from "./grid.js";
import { TECHNIQUE_ORDER, humanSolve, techniqueTier } from "./human.js";
import { Rng } from "./prng.js";
import { countSolutionsBytes, forEachSolutionBytes, solveBytes } from "./solver.js";
import type { Cell, Difficulty, Digit, Grid, GridInput, MoveLog, Technique, TechniqueOrBeyond } from "./types.js";

/**
 * Версия алгоритма генерации Лжеца. Любое изменение, меняющее сетку для существующего seed (критерий,
 * пороги, порядок перебора, seed-конвенция), поднимает её (README, «Лжец» → «Версии»). Меняется и при
 * смене `GENERATOR_VERSION` — честная основа берётся из `generate`.
 */
export const LIAR_VERSION = 1;

/**
 * Порог нетривиальности (в): доля пустых клеток (без лжеца), которую human-решатель обязан честно
 * заполнить до противоречия. 0.25 — четверть доски «выглядит нормально» (замер распределения — README).
 */
export const LIAR_MIN_DEPTH_RATIO = 0.25;

/**
 * Потолок честных основ (seed-ретраев) по умолчанию. Доля основ, у которых есть хоть одна честная ложь,
 * — от ≈ 1/2 (easy) до ≈ 1/10 (expert/master), см. README «Лжец → Производительность»; 400 даёт вероятность
 * `LiarGenerationError` порядка 10⁻¹⁸ на seed. Потолок не меняет результат, пока не исчерпан.
 */
export const LIAR_DEFAULT_MAX_BASES = 400;

export type LiarFailure =
  | "not_refutable" // 1: у полной сетки есть решение
  | "ambiguous" // 2: удаление другой подсказки тоже даёт решение(я)
  | "not_resolvable" // 3: без лжеца решений не ровно одно (или кандидата нет)
  | "visible_at_start" // 4а: ложь видна до первого хода
  | "not_deducible" // 4б: решатель в пределах потолка не дошёл до противоречия
  | "too_shallow"; // 4в: противоречие раньше `minDepth` постановок

export interface LiarValidation {
  /** Все критерии выполнены. */
  readonly honest: boolean;
  /** Ложная подсказка: единственная клетка, удаление которой даёт ровно одно решение; иначе null. */
  readonly liarCell: Cell | null;
  /** Подсказки, удаление которых даёт ≥ 1 решения (у честной сетки — ровно `[liarCell]`). */
  readonly suspects: readonly Cell[];
  /** Решение после удаления лжеца (81 символ) — только если `liarCell !== null`. */
  readonly solution: string | null;
  /** Постановок human-решателя до противоречия; null — противоречие не найдено. */
  readonly contradictionDepth: number | null;
  /** Самая дорогая техника, понадобившаяся до противоречия; null — шагов не было / не найдено. */
  readonly contradictionTechnique: Technique | null;
  /** Порог (в), с которым сверялись. */
  readonly minDepth: number;
  /** Нарушенные критерии (пусто ⇔ `honest`). Порядок — как в списке критериев. */
  readonly failures: readonly LiarFailure[];
}

export interface ValidateLiarOptions {
  /**
   * Потолок техник для (б): `difficulty` → техника профиля (singles-классы — hidden_single, master — все
   * реализованные), либо явная `maxTechnique`. По умолчанию — все реализованные техники.
   */
  readonly difficulty?: Difficulty;
  readonly maxTechnique?: Technique;
  /** Порог (в) в постановках; по умолчанию `ceil(LIAR_MIN_DEPTH_RATIO × (пустые клетки + 1))`. */
  readonly minDepth?: number;
}

export interface LiarMeta {
  readonly version: number;
  /** Seed, которым получена честная основа (`generate({ difficulty, seed: baseSeed })`). */
  readonly baseSeed: string;
  /** Сколько честных основ перебрано (1 — подошла первая). */
  readonly bases: number;
  /** Сколько пар (клетка, ложная цифра) проверено до успеха, суммарно по основам. */
  readonly candidatesTried: number;
  readonly contradictionDepth: number;
  readonly contradictionTechnique: Technique | null;
  readonly minDepth: number;
}

export interface LiarPuzzle {
  /** Сетка с ложной подсказкой — то, что видит игрок. 81 символ, `0` = пусто. */
  readonly mission: string;
  /** То же массивом. */
  readonly givens: Grid;
  /** Честная сетка: `mission` без лжеца (ровно профиль класса `difficulty`). */
  readonly honestMission: string;
  /** Единственное решение честной сетки — с ним сверяются ходы игрока. */
  readonly solution: string;
  readonly liarCell: Cell;
  /** Цифра, которую показывает ложная подсказка. */
  readonly liarDigit: Digit;
  /** Истинная цифра клетки (`solution[liarCell]`). */
  readonly trueDigit: Digit;
  readonly difficulty: Difficulty;
  readonly seed: string;
  /** Техники честной сетки (как `Puzzle.techniques`). */
  readonly techniques: readonly TechniqueOrBeyond[];
  readonly meta: LiarMeta;
}

export interface GenerateLiarOptions {
  readonly difficulty: Difficulty;
  readonly seed: string;
  /** Потолок честных основ (целое ≥ 1, по умолчанию `LIAR_DEFAULT_MAX_BASES`), иначе `RangeError`. */
  readonly maxBases?: number;
}

export class LiarGenerationError extends Error {
  constructor(difficulty: Difficulty, seed: string, bases: number) {
    super(`Could not generate a '${difficulty}' liar puzzle for seed '${seed}' in ${bases} bases`);
    this.name = "LiarGenerationError";
  }
}

/** Потолок техник класса для критерия (б): ярус 0..4. Для master — все реализованные. */
function ceilingTier(options: ValidateLiarOptions): number {
  if (options.maxTechnique !== undefined) return techniqueTier(options.maxTechnique);
  if (options.difficulty !== undefined) {
    if (!Object.hasOwn(DIFFICULTY_PROFILES, options.difficulty)) {
      throw new RangeError(`Unknown difficulty '${String(options.difficulty)}'`);
    }
    return Math.min(techniqueTier(DIFFICULTY_PROFILES[options.difficulty].technique), TECHNIQUE_ORDER.length - 1);
  }
  return TECHNIQUE_ORDER.length - 1;
}

function defaultMinDepth(bytes: Uint8Array): number {
  let empty = 0;
  for (let c = 0; c < GRID_SIZE; c++) if (bytes[c] === 0) empty++;
  // +1: клетка лжеца после снятия тоже пустая — порог считается от честной сетки.
  return Math.ceil(LIAR_MIN_DEPTH_RATIO * (empty + 1));
}

/**
 * (а) Ложь не видна на старте: нет повтора в юните, у каждой пустой клетки есть кандидат,
 * у каждой ещё не поставленной цифры есть место в каждом юните (по кандидатам от значений).
 */
function visibleAtStart(bytes: Uint8Array): boolean {
  const cands = new Uint16Array(GRID_SIZE);
  for (let c = 0; c < GRID_SIZE; c++) {
    const v = bytes[c]!;
    const m = peerMask(bytes, c);
    if (v !== 0) {
      if (!(m & (1 << v))) return true; // та же цифра у соседа
      continue;
    }
    if (m === 0) return true;
    cands[c] = m;
  }
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    let covered = 0;
    for (let i = 0; i < 9; i++) {
      const c = unit[i]!;
      covered |= bytes[c] !== 0 ? 1 << bytes[c]! : cands[c]!;
    }
    if (covered !== ALL_DIGITS_MASK) return true;
  }
  return false;
}

/** (б)+(в): human-решатель в пределах потолка — постановок до противоречия и максимальная техника. */
function contradictionProbe(bytes: Uint8Array, maxTier: number): { depth: number | null; technique: Technique | null } {
  const res = humanSolve(bytesToGrid(bytes), { maxTechnique: TECHNIQUE_ORDER[maxTier]! });
  if (!res.contradiction) return { depth: null, technique: null };
  let depth = 0;
  let top = -1;
  for (const s of res.steps) {
    if (s.cell !== undefined) depth++;
    const t = techniqueTier(s.technique);
    if (t > top) top = t;
  }
  return { depth, technique: top < 0 ? null : TECHNIQUE_ORDER[top]! };
}

function bytesToString(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < GRID_SIZE; i++) s += b[i];
  return s;
}

/**
 * Полная проверка критерия честности для произвольной сетки (лжец заранее не известен — выводится).
 * Стоимость: (подсказки + 1) вызовов счётчика решений + один проход human-решателя.
 */
export function validateLiar(mission: GridInput, options: ValidateLiarOptions = {}): LiarValidation {
  const bytes = toBytes(mission);
  const maxTier = ceilingTier(options);
  const minDepth = options.minDepth ?? defaultMinDepth(bytes);
  if (!Number.isInteger(minDepth) || minDepth < 0) {
    throw new RangeError(`minDepth must be an integer >= 0, got ${String(minDepth)}`);
  }
  const failures: LiarFailure[] = [];

  // 1. Опровержимость. Повтор в юните — тоже «нет решений» (countSolutions отдаёт 0).
  if (countSolutionsBytes(bytes, 1) !== 0) failures.push("not_refutable");

  // 2–3. Подозреваемые: подсказки, без которых решение есть.
  const suspects: Cell[] = [];
  let liarCell: Cell | null = null;
  let solution: string | null = null;
  let liarCount = 0;
  const probe = Uint8Array.from(bytes);
  for (let c = 0; c < GRID_SIZE; c++) {
    const v = probe[c]!;
    if (v === 0) continue;
    probe[c] = 0;
    const n = countSolutionsBytes(probe, 2);
    if (n > 0) {
      suspects.push(c);
      if (n === 1) liarCount++;
    }
    probe[c] = v;
  }
  if (suspects.length > 1) failures.push("ambiguous");
  if (suspects.length === 1 && liarCount === 1) {
    liarCell = suspects[0]!;
    probe[liarCell] = 0;
    // Единственность уже доказана счётчиком — достаём само решение.
    solution = bytesToString(solveFirst(probe));
    probe[liarCell] = bytes[liarCell]!;
  } else {
    failures.push("not_resolvable");
  }

  // 4. Нетривиальность.
  if (visibleAtStart(bytes)) failures.push("visible_at_start");
  const { depth, technique } = contradictionProbe(bytes, maxTier);
  if (depth === null) failures.push("not_deducible");
  else if (depth < minDepth) failures.push("too_shallow");

  return {
    honest: failures.length === 0,
    liarCell,
    suspects,
    solution,
    contradictionDepth: depth,
    contradictionTechnique: technique,
    minDepth,
    failures,
  };
}

function solveFirst(bytes: Uint8Array): Uint8Array {
  const res = solveBytes(bytes);
  if (res === null) throw new Error("unreachable: counted solution vanished");
  return res;
}

/**
 * Сколько решений `основа − подсказка c` перебирать для таблицы покрытия; если их больше — для этой
 * подсказки однозначность проверяется у каждого кандидата отдельно (медленный путь, тот же результат).
 */
const COVERAGE_LIMIT = 512;

/**
 * Таблица покрытия для критерия (2) по честной основе. Ключевое наблюдение: `лжец − c` (c — честная
 * подсказка) = `основа − c` + ложь (L = w), и его решения — ровно решения `основа − c` с цифрой w в L.
 * Поэтому, перебрав решения `основа − c` для всех c, одной маской на клетку получаем все (L, w), для
 * которых какая-то другая подсказка тоже «лжец» (`covered[L]` бит w). Подсказки, у которых решений
 * больше `COVERAGE_LIMIT`, возвращаются в `heavy` — для них проверка остаётся поштучной.
 */
function coverage(honest: Uint8Array, limit: number): { covered: Uint16Array; heavy: Cell[] } {
  const covered = new Uint16Array(GRID_SIZE);
  const heavy: Cell[] = [];
  const empties: Cell[] = [];
  for (let c = 0; c < GRID_SIZE; c++) if (honest[c] === 0) empties.push(c);
  const work = Uint8Array.from(honest);
  for (let c = 0; c < GRID_SIZE; c++) {
    const v = work[c]!;
    if (v === 0) continue;
    work[c] = 0;
    const n = forEachSolutionBytes(work, limit, (sol) => {
      for (const e of empties) covered[e] = covered[e]! | (1 << sol[e]!);
    });
    if (n >= limit) heavy.push(c);
    work[c] = v;
  }
  return { covered, heavy };
}

/** Принятый кандидат: глубина и техника противоречия. */
interface LieCheck {
  readonly depth: number;
  readonly technique: Technique | null;
}

/**
 * Внутреннее (генератор и тесты): проверщик кандидатов «честная основа + ложь `digit` в пустую клетку
 * `cell`». Опровержимость и доразрешимость выполнены по построению (решение основы единственно, и в
 * клетке оно ≠ digit); проверяются (2) — по таблице покрытия и поштучно для `heavy`, затем (а), (б)/(в).
 * Порядок — от дешёвого к дорогому. Вердикт совпадает с `validateLiar(...).honest` (тест на полном
 * переборе кандидатов). Возвращает null, если кандидат не годится (в т. ч. digit = истинной цифре,
 * клетка не пустая, повтор у соседа). `tuning` — только для тестов: порог (в) и размер таблицы покрытия
 * (`coverageLimit: 1` загоняет все подсказки в поштучную проверку — тест медленного пути).
 */
export function lieChecker(
  honestMission: GridInput,
  solution: GridInput,
  maxTier: number,
  tuning: { readonly minDepth?: number; readonly coverageLimit?: number } = {},
): (cell: Cell, digit: Digit) => LieCheck | null {
  const honest = toBytes(honestMission);
  const sol = toBytes(solution);
  const cov = coverage(honest, tuning.coverageLimit ?? COVERAGE_LIMIT);
  const minDepth = tuning.minDepth ?? defaultMinDepth(honest);
  const liar = Uint8Array.from(honest);
  return (cell, digit) => {
    if (honest[cell] !== 0 || sol[cell] === digit) return null;
    if (cov.covered[cell]! & (1 << digit)) return null;
    liar[cell] = digit;
    try {
      if (visibleAtStart(liar)) return null;
      const { depth, technique } = contradictionProbe(liar, maxTier);
      if (depth === null || depth < minDepth) return null;
      for (const c of cov.heavy) {
        const v = liar[c]!;
        liar[c] = 0;
        const n = countSolutionsBytes(liar, 1);
        liar[c] = v;
        if (n !== 0) return null;
      }
      return { depth, technique };
    } finally {
      liar[cell] = 0;
    }
  };
}

/** Seed честной основы: k = 0 — `liar:<seed>`, далее `liar:<seed>:<k>`. */
function baseSeedOf(seed: string, k: number): string {
  return k === 0 ? `liar:${seed}` : `liar:${seed}:${k}`;
}

/**
 * Генерирует Лжеца класса `difficulty` детерминированно по seed. Честная основа — `generate` с seed
 * `liar:<seed>` (при неудаче — `liar:<seed>:<k>`), кандидаты (клетка, цифра) перебираются в порядке
 * PRNG `liar\0<seed>\0<difficulty>\0<k>`; принимается первый, прошедший критерий. Результат всегда
 * проходит `validateLiar(mission, { difficulty })` с `honest === true`.
 * @throws {LiarGenerationError} если за `maxBases` основ кандидат не найден.
 */
export function generateLiar(options: GenerateLiarOptions): LiarPuzzle {
  const { difficulty, seed } = options;
  if (typeof difficulty !== "string" || !Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) {
    throw new RangeError(`Unknown difficulty '${String(difficulty)}'`);
  }
  if (typeof seed !== "string") throw new RangeError("seed must be a string");
  const maxBases = options.maxBases === undefined ? LIAR_DEFAULT_MAX_BASES : options.maxBases;
  if (!Number.isInteger(maxBases) || maxBases < 1) {
    throw new RangeError(`maxBases must be an integer >= 1, got ${String(maxBases)}`);
  }
  const maxTier = ceilingTier({ difficulty });
  let tried = 0;
  for (let k = 0; k < maxBases; k++) {
    const baseSeed = baseSeedOf(seed, k);
    const base = generate({ difficulty, seed: baseSeed });
    const honest = toBytes(base.mission);
    const solution = toBytes(base.solution);
    // Кандидаты (клетка, ложная цифра): пустые клетки × цифры ≠ истинной, не повторяющие соседей.
    const pairs: number[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      if (honest[c] !== 0) continue;
      const m = peerMask(honest, c);
      for (let d = 1; d <= 9; d++) if (d !== solution[c] && m & (1 << d)) pairs.push(c * 16 + d);
    }
    new Rng(`liar\0${seed}\0${difficulty}\0${k}`).shuffle(pairs);
    const check = lieChecker(base.mission, base.solution, maxTier);
    for (const p of pairs) {
      tried++;
      const cell = p >> 4;
      const digit = (p & 15) as Digit;
      const ok = check(cell, digit);
      if (ok === null) continue;
      const liar = Uint8Array.from(honest);
      liar[cell] = digit;
      return {
        mission: bytesToString(liar),
        givens: bytesToGrid(liar),
        honestMission: base.mission,
        solution: base.solution,
        liarCell: cell,
        liarDigit: digit,
        trueDigit: solution[cell]! as Digit,
        difficulty,
        seed,
        techniques: base.techniques,
        meta: {
          version: LIAR_VERSION,
          baseSeed,
          bases: k + 1,
          candidatesTried: tried,
          contradictionDepth: ok.depth,
          contradictionTechnique: ok.technique,
          minDepth: defaultMinDepth(honest),
        },
      };
    }
  }
  throw new LiarGenerationError(difficulty, seed, maxBases);
}

/**
 * Seed Лжеца дня: `<YYYY-MM-DD>/liar/<difficulty>`. Отдельная конвенция от `dailySeed` — сетка Лжеца
 * дня не совпадает с обычной сеткой дня. Дата валидируется как в `dailySeed`.
 */
export function dailyLiarSeed(date: string, difficulty: Difficulty): string {
  dailySeed(date, difficulty); // та же валидация даты/формата (RangeError)
  return `${date}/liar/${difficulty}`;
}

/** Лжец дня: `generateLiar({ difficulty, seed: dailyLiarSeed(date, difficulty) })`. */
export function dailyLiarPuzzle(date: string, difficulty: Difficulty): LiarPuzzle {
  return generateLiar({ difficulty, seed: dailyLiarSeed(date, difficulty) });
}

// ---------------------------------------------------------------------------------------------
// API для UI: обвинение и метрики партии.

export type AccusationVerdict =
  /** Верно: это лжец. `trueDigit` — истинная цифра клетки (UI досчитывает доску). */
  | { readonly kind: "liar"; readonly cell: Cell; readonly trueDigit: Digit }
  /** Неверно: подсказка честная. */
  | { readonly kind: "honest"; readonly cell: Cell }
  /** Клетка — не данная подсказка (обвинять можно только подсказки). */
  | { readonly kind: "not_a_given"; readonly cell: Cell };

/** Проверка обвинения клетки. Чистая функция; `RangeError` на клетке вне 0..80. */
export function accuse(puzzle: Pick<LiarPuzzle, "mission" | "liarCell" | "trueDigit">, cell: Cell): AccusationVerdict {
  assertCell(cell);
  if (puzzle.mission[cell] === "0" || puzzle.mission[cell] === ".") return { kind: "not_a_given", cell };
  if (cell === puzzle.liarCell) return { kind: "liar", cell, trueDigit: puzzle.trueDigit };
  return { kind: "honest", cell };
}

/**
 * Обвинение в логе партии. Хранится отдельно от `MoveLog` (тип `Move` не меняется — таймлапс/сводка/ink
 * работают как раньше): `moveIndex` — длина `MoveLog` в момент обвинения (сколько ходов уже сделано).
 */
export interface Accusation {
  /** Миллисекунды от старта партии (та же шкала, что `Move.t`). */
  readonly t: number;
  readonly cell: Cell;
  readonly moveIndex: number;
}

export interface LiarSummary {
  /** Лжец пойман (было верное обвинение). */
  readonly caught: boolean;
  /** Неверных обвинений (до поимки и после — после поимки обвинять UI не даёт, но лог читается любой). */
  readonly wrongAccusations: number;
  /** Пойман первым же обвинением. */
  readonly firstTry: boolean;
  /** Время верного обвинения, мс; null — не пойман. */
  readonly catchT: number | null;
  /**
   * «Ход обвинения» для карточки: сколько цифр игрок поставил до верного обвинения (`place` в
   * `log.slice(0, moveIndex)`, авто-замены кляксы не считаются). null — не пойман.
   */
  readonly catchPlacement: number | null;
  /** Обвинения не-подсказок (UI их не должен пропускать; считаются, но не влияют на остальное). */
  readonly invalidAccusations: number;
}

/**
 * Метрики Лжеца по партии. Обвинения обрабатываются в порядке массива; учитывается первое верное.
 * `RangeError`: `moveIndex` вне 0..log.length или не целое.
 */
export function liarSummary(
  puzzle: Pick<LiarPuzzle, "mission" | "liarCell" | "trueDigit">,
  accusations: readonly Accusation[],
  log: MoveLog,
): LiarSummary {
  let wrong = 0;
  let invalid = 0;
  let catchT: number | null = null;
  let catchIndex: number | null = null;
  let firstTry = false;
  let valid = 0;
  for (const a of accusations) {
    if (!Number.isInteger(a.moveIndex) || a.moveIndex < 0 || a.moveIndex > log.length) {
      throw new RangeError(`Accusation moveIndex must be an integer in 0..${log.length}, got ${String(a.moveIndex)}`);
    }
    const v = accuse(puzzle, a.cell);
    if (v.kind === "not_a_given") {
      invalid++;
      continue;
    }
    valid++;
    if (v.kind === "honest") {
      wrong++;
      continue;
    }
    if (catchT === null) {
      catchT = a.t;
      catchIndex = a.moveIndex;
      firstTry = valid === 1;
    }
  }
  let catchPlacement: number | null = null;
  if (catchIndex !== null) {
    catchPlacement = 0;
    for (let i = 0; i < catchIndex; i++) {
      const m = log[i]!;
      // Авто-замена кляксы (correct + blot) — не постановка игрока (как в summary, PD-71).
      if (m.kind === "place" && !(m.blot === true && m.correct === true)) catchPlacement++;
    }
  }
  return { caught: catchT !== null, wrongAccusations: wrong, firstTry, catchT, catchPlacement, invalidAccusations: invalid };
}
