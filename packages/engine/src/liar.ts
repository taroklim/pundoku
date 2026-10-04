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
 *    пустой клетки есть кандидат, у каждой цифры есть место в каждом юните, нет двух синглов одной цифры в
 *    юните и клетки, вынужденной к двум цифрам (PD-172); (б) противоречие выводимо техниками не дороже потолка
 *    класса; (в) при ЛЮБОМ порядке ходов (синглы + вычёркивания потолка класса) видимое противоречие возникает
 *    не раньше `minDepth` постановок (PD-172: минимум по всем порядкам, а не по одному порядку решателя).
 *
 * Без DOM, чистые функции, детерминированно по seed — как весь пакет.
 */
import { DIFFICULTY_PROFILES } from "./difficulty.js";
import { generate, dailySeed } from "./generator.js";
import { ALL_DIGITS_MASK, GRID_SIZE, PEERS, UNITS, assertCell, bytesToGrid, peerMask, toBytes } from "./grid.js";
import { TECHNIQUE_ORDER, eliminateToFixpoint, techniqueTier } from "./human.js";
import { Rng } from "./prng.js";
import { countSolutionsBytes, forEachSolutionBytes, solveBytes } from "./solver.js";
import type { Cell, Difficulty, Digit, Grid, GridInput, MoveLog, Technique, TechniqueOrBeyond } from "./types.js";

/**
 * Версия алгоритма генерации Лжеца. Любое изменение, меняющее сетку для существующего seed (критерий,
 * пороги, порядок перебора, seed-конвенция), поднимает её (README, «Лжец» → «Версии»). Меняется и при
 * смене `GENERATOR_VERSION` — честная основа берётся из `generate`. 2 — PD-172 (новые (а)/(в), пороги по классам).
 */
export const LIAR_VERSION = 2;

/**
 * Порог нетривиальности (в) по классам (PD-172): минимальное число постановок до видимого противоречия при
 * самом удачном для игрока порядке ходов. Выбран как максимум, при котором строгая однозначность (2) ещё
 * достижима за разумное число основ (замер — README «Лжец → Порог глубины»): у expert/master все строго
 * однозначные лжи видны уже после вычёркиваний на старте, поэтому для них остаётся только (а).
 */
export const LIAR_MIN_DEPTH: Readonly<Record<Difficulty, number>> = Object.freeze({
  easy: 3,
  medium: 3,
  hard: 1,
  expert: 0,
  master: 0,
});

/** Потолок состояний на уровень точного поиска; превышен — дальше нижняя оценка (детерминированно). */
const EXACT_LEVEL_LIMIT = 20_000;

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
  /**
   * Минимум постановок до видимого противоречия по всем порядкам ходов: точный, если ≤ `minDepth`, иначе
   * нижняя оценка (> `minDepth`); null — противоречие техниками потолка не выводится.
   */
  readonly contradictionDepth: number | null;
  /** Самый дешёвый потолок техник, с которым достигается та же глубина; null — противоречие не выводится. */
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
  /** Порог (в) в постановках; по умолчанию `LIAR_MIN_DEPTH[difficulty]`, без `difficulty` — 0 (только (а)). */
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

/**
 * Волновой зонд (PD-172) — нижняя оценка глубины противоречия по ВСЕМ порядкам ходов. Волна: (1) вычёркивания
 * техниками ярусов 2..maxTier до фикс-точки (для singles-классов их нет); (2) проверка видимого противоречия
 * (`visibleContradiction`); (3) постановка ВСЕХ вынужденных синглов разом (naked; hidden — если maxTier ≥ 1).
 * Противоречие на проверке после k волн → глубина k; синглов нет и противоречия нет → null (застряли).
 *
 * Почему это нижняя оценка: постановки и вычёркивания только сужают кандидатов, поэтому сингл, вынужденный в
 * любой момент любой последовательности ходов, к той же волне уже поставлен (или уже виден конфликт), — по
 * индукции состояние после n ходов любого игрока ⊆ состояния после n волн. Видимое противоречие монотонно (раз
 * появившись, не исчезает), значит игрок не увидит его раньше, чем через `depth` постановок. `stopAfter` —
 * остановиться после этой волны без постановок (для (а): `stopAfter = 0`).
 */
function waveDepth(bytes: Uint8Array, maxTier: number, stopAfter = Infinity): number | null {
  const start = initProbe(bytes);
  if (start === null) return 0;
  const { vals, cands } = start;
  const forced = new Uint16Array(GRID_SIZE);
  for (let wave = 0; ; wave++) {
    if (maxTier >= 2) eliminateToFixpoint(vals, cands, maxTier);
    if (visibleContradiction(vals, cands, forced, maxTier >= 1)) return wave;
    if (wave >= stopAfter) return null;
    let placed = 0;
    for (let c = 0; c < GRID_SIZE; c++) {
      const f = forced[c]!;
      if (f === 0) continue;
      vals[c] = 31 - Math.clz32(f);
      cands[c] = 0;
      placed++;
    }
    if (placed === 0) return null;
    for (let c = 0; c < GRID_SIZE; c++) {
      const f = forced[c]!;
      if (f === 0) continue;
      const peers = PEERS[c]!;
      for (let i = 0; i < 20; i++) {
        const p = peers[i]!;
        if (vals[p] === 0) cands[p] = cands[p]! & ~f;
      }
    }
  }
}

/**
 * Видимое противоречие в состоянии (значения + кандидаты) и заодно вынужденные синглы (`forced`, маска на клетку):
 * пустая клетка без кандидатов; цифра без места в юните; клетка, вынужденная к двум цифрам; две клетки одного
 * юнита, вынужденные к одной цифре (PD-172 (а): «два сингла одной цифры в юните» видны так же, как пустая клетка).
 * Сингл — naked (один кандидат) и, если `hidden`, hidden (единственное место цифры в юните).
 */
function visibleContradiction(vals: Uint8Array, cands: Uint16Array, forced: Uint16Array, hidden: boolean): boolean {
  forced.fill(0);
  for (let c = 0; c < GRID_SIZE; c++) {
    if (vals[c] !== 0) continue;
    const m = cands[c]!;
    if (m === 0) return true;
    if ((m & (m - 1)) === 0) forced[c] = m;
  }
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    let have = 0;
    let once = 0;
    let twice = 0;
    for (let i = 0; i < 9; i++) {
      const c = unit[i]!;
      const v = vals[c]!;
      if (v !== 0) {
        have |= 1 << v;
        continue;
      }
      const m = cands[c]!;
      twice |= once & m;
      once |= m;
    }
    if ((have | once) !== ALL_DIGITS_MASK) return true; // цифре негде стоять
    if (!hidden) continue;
    const single = once & ~twice & ~have;
    if (single === 0) continue;
    for (let i = 0; i < 9; i++) {
      const c = unit[i]!;
      if (vals[c] === 0) forced[c] = forced[c]! | (cands[c]! & single);
    }
  }
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    let seen = 0;
    for (let i = 0; i < 9; i++) {
      const f = forced[unit[i]!]!;
      if (f & (f - 1)) return true; // клетка вынуждена к двум цифрам
      if (seen & f) return true; // два сингла одной цифры в юните
      seen |= f;
    }
  }
  return false;
}

/** (а) Ложь не видна на старте: волна 0 зонда singles без постановок и вычёркиваний. */
function visibleAtStart(bytes: Uint8Array): boolean {
  return waveDepth(bytes, 1, 0) === 0;
}

/** Состояние точного поиска: значения и кандидаты. */
interface ProbeState {
  readonly vals: Uint8Array;
  readonly cands: Uint16Array;
}

function initProbe(bytes: Uint8Array): ProbeState | null {
  const vals = Uint8Array.from(bytes);
  const cands = new Uint16Array(GRID_SIZE);
  for (let c = 0; c < GRID_SIZE; c++) {
    const m = peerMask(vals, c);
    const v = vals[c]!;
    if (v === 0) cands[c] = m;
    else if (!(m & (1 << v))) return null; // повтор цифры в юните
  }
  return { vals, cands };
}

/**
 * (в) Точный минимум постановок до видимого противоречия по всем порядкам ходов: BFS по множествам
 * поставленных синглов (после каждой постановки — вычёркивания потолка до фикс-точки). Ищет до `cap`
 * постановок; глубже (или если уровень BFS больше `EXACT_LEVEL_LIMIT`) возвращает нижнюю оценку —
 * максимум из пройденной глубины + 1 и волнового зонда. null — противоречие не выводится вообще (б).
 */
function minPlacements(bytes: Uint8Array, maxTier: number, cap: number): number | null {
  const wave = waveDepth(bytes, maxTier);
  if (wave === null) return null;
  if (wave > cap) return wave;
  const start = initProbe(bytes);
  if (start === null) return 0;
  const forced = new Uint16Array(GRID_SIZE);
  let level: ProbeState[] = [start];
  for (let k = 0; k <= cap; k++) {
    const next: ProbeState[] = [];
    const seen = new Set<string>();
    for (const st of level) {
      if (maxTier >= 2) eliminateToFixpoint(st.vals, st.cands, maxTier);
      if (visibleContradiction(st.vals, st.cands, forced, maxTier >= 1)) return k;
      if (k === cap) continue;
      for (let c = 0; c < GRID_SIZE; c++) {
        const f = forced[c]!;
        if (f === 0) continue;
        const vals = Uint8Array.from(st.vals);
        vals[c] = 31 - Math.clz32(f);
        const key = String.fromCharCode(...vals);
        if (seen.has(key)) continue;
        seen.add(key);
        const cands = Uint16Array.from(st.cands);
        cands[c] = 0;
        const peers = PEERS[c]!;
        for (let i = 0; i < 20; i++) {
          const p = peers[i]!;
          if (vals[p] === 0) cands[p] = cands[p]! & ~f;
        }
        next.push({ vals, cands });
      }
    }
    if (next.length === 0 || next.length > EXACT_LEVEL_LIMIT) return Math.max(k + 1, wave);
    level = next;
  }
  return Math.max(cap + 1, wave);
}

/**
 * (б)+(в): глубина противоречия (`minPlacements` с поиском до `minDepth` — точная, если ≤ `minDepth`, иначе нижняя
 * оценка > `minDepth`) и техника — самый дешёвый потолок, с которым та же глубина ещё достигается (что игроку
 * нужно, чтобы увидеть ложь так рано). `known` — уже посчитанная глубина с тем же `maxTier`/`minDepth`.
 */
function contradictionProbe(
  bytes: Uint8Array,
  maxTier: number,
  minDepth: number,
  known?: number,
): { depth: number | null; technique: Technique | null } {
  const depth = known ?? minPlacements(bytes, maxTier, minDepth);
  if (depth === null) return { depth: null, technique: null };
  let t = 0;
  while (t < maxTier && minPlacements(bytes, t, minDepth) !== depth) t++;
  return { depth, technique: TECHNIQUE_ORDER[t]! };
}

function minDepthFor(difficulty: Difficulty | undefined): number {
  return difficulty === undefined ? 0 : LIAR_MIN_DEPTH[difficulty];
}

function bytesToString(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < GRID_SIZE; i++) s += b[i];
  return s;
}

/**
 * Полная проверка критерия честности для произвольной сетки (лжец заранее не известен — выводится).
 * Стоимость: (подсказки + 1) вызовов счётчика решений + волновой зонд и точный поиск глубины до `minDepth`.
 */
export function validateLiar(mission: GridInput, options: ValidateLiarOptions = {}): LiarValidation {
  const bytes = toBytes(mission);
  const maxTier = ceilingTier(options);
  const minDepth = options.minDepth ?? minDepthFor(options.difficulty);
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
  const { depth, technique } = contradictionProbe(bytes, maxTier, minDepth);
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
 * клетка не пустая, повтор у соседа). `minDepth` — порог (в); `tuning` — только для тестов: размер таблицы
 * покрытия (`coverageLimit: 1` загоняет все подсказки в поштучную проверку — тест медленного пути).
 */
export function lieChecker(
  honestMission: GridInput,
  solution: GridInput,
  maxTier: number,
  minDepth: number,
  tuning: { readonly coverageLimit?: number } = {},
): (cell: Cell, digit: Digit) => LieCheck | null {
  const honest = toBytes(honestMission);
  const sol = toBytes(solution);
  const cov = coverage(honest, tuning.coverageLimit ?? COVERAGE_LIMIT);
  const liar = Uint8Array.from(honest);
  return (cell, digit) => {
    if (honest[cell] !== 0 || sol[cell] === digit) return null;
    if (cov.covered[cell]! & (1 << digit)) return null;
    liar[cell] = digit;
    try {
      if (visibleAtStart(liar)) return null;
      const depth = minPlacements(liar, maxTier, minDepth);
      if (depth === null || depth < minDepth) return null;
      for (const c of cov.heavy) {
        const v = liar[c]!;
        liar[c] = 0;
        const n = countSolutionsBytes(liar, 1);
        liar[c] = v;
        if (n !== 0) return null;
      }
      return { depth, technique: contradictionProbe(liar, maxTier, minDepth, depth).technique };
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
  const minDepth = LIAR_MIN_DEPTH[difficulty];
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
    const check = lieChecker(base.mission, base.solution, maxTier, minDepth);
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
          minDepth,
        },
      };
    }
  }
  throw new LiarGenerationError(difficulty, seed, maxBases);
}

/**
 * Seed Лжеца дня: `<YYYY-MM-DD>/liar/<difficulty>`. Отдельная конвенция от `dailySeed` — сетка Лжеца
 * дня не совпадает с обычной сеткой дня. Дата валидируется как в `dailySeed`, сложность — как в
 * `generateLiar` (`RangeError`).
 */
export function dailyLiarSeed(date: string, difficulty: Difficulty): string {
  if (typeof difficulty !== "string" || !Object.hasOwn(DIFFICULTY_PROFILES, difficulty)) {
    throw new RangeError(`Unknown difficulty '${String(difficulty)}'`);
  }
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
  /**
   * Повторные обвинения уже обвинённой клетки (UI их не пускает). Не считаются ни верными, ни неверными, ни
   * невалидными и не влияют на `firstTry`: значим только первый вердикт по клетке.
   */
  readonly repeatedAccusations: number;
}

/**
 * Метрики Лжеца по партии. Обвинения обрабатываются в порядке массива; учитывается первое верное; повторное
 * обвинение той же клетки игнорируется (`repeatedAccusations`). `RangeError`: `moveIndex` вне 0..log.length
 * или не целое, клетка вне 0..80.
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
  let repeated = 0;
  const seen = new Set<Cell>();
  for (const a of accusations) {
    if (!Number.isInteger(a.moveIndex) || a.moveIndex < 0 || a.moveIndex > log.length) {
      throw new RangeError(`Accusation moveIndex must be an integer in 0..${log.length}, got ${String(a.moveIndex)}`);
    }
    const v = accuse(puzzle, a.cell);
    if (seen.has(a.cell)) {
      repeated++;
      continue;
    }
    seen.add(a.cell);
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
  return {
    caught: catchT !== null,
    wrongAccusations: wrong,
    firstTry,
    catchT,
    catchPlacement,
    invalidAccusations: invalid,
    repeatedAccusations: repeated,
  };
}
