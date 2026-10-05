/**
 * Лжец (релиз 2, PD-165): судоку, в котором ровно одна данная подсказка ложна.
 *
 * Генератор: честная сетка класса `difficulty` (обычный `generate`, тот же профиль подсказки × техника)
 * + одна ложная цифра в одну из её пустых клеток. Валидатор `validateLiar` проверяет критерий честности
 * (отчёт 05 §3, точная формулировка — README пакета, «Лжец»):
 *
 * 1. Опровержимость — сетка со всеми подсказками не имеет ни одного решения.
 * 2. Однозначность (PD-174, критерий отчёта 05) — нет другой подсказки, удаление которой даёт ЕДИНСТВЕННОЕ
 *    решение: лжец определяется однозначно. Подсказка, без которой решений ≥ 2, кандидатом в лжецы не считается.
 * 3. Доразрешимость — после удаления лжеца решение ровно одно.
 * 4. Нетривиальность — (а) на старте ложь не видна ни одной техникой потолка класса без постановок (PD-174):
 *    после вычёркиваний потолка (hard — locked candidates, expert/master — + naked/hidden pairs) до фикс-точки нет
 *    повтора, пустой клетки без кандидатов, цифры без места в юните, двух синглов одной цифры в юните и клетки,
 *    вынужденной к двум цифрам (PD-172); (б) противоречие выводимо техниками не дороже потолка класса; (в) при
 *    ЛЮБОМ порядке ходов (синглы + вычёркивания потолка класса) видимое противоречие возникает не раньше
 *    `minDepth` постановок (PD-172: минимум по всем порядкам, а не по одному порядку решателя). У expert/master
 *    порядок вычёркиваний пар тоже перебирается, но не полностью (PD-177, `settleSweep`; остаток — README).
 *
 * Без DOM, чистые функции, детерминированно по seed — как весь пакет.
 */
import { DIFFICULTY_PROFILES } from "./difficulty.js";
import { generate, dailySeed } from "./generator.js";
import { ALL_DIGITS_MASK, GRID_SIZE, PEERS, UNITS, assertCell, bytesToGrid, peerMask, popcount, toBytes } from "./grid.js";
import { TECHNIQUE_ORDER, eliminateToFixpoint, techniqueTier } from "./human.js";
import { Rng } from "./prng.js";
import { countSolutionsBytes, forEachSolutionBytes, solveBytes } from "./solver.js";
import type { Cell, Difficulty, Digit, Grid, GridInput, MoveLog, Technique, TechniqueOrBeyond } from "./types.js";

/**
 * Версия алгоритма генерации Лжеца. Любое изменение, меняющее сетку для существующего seed (критерий,
 * пороги, порядок перебора, seed-конвенция), поднимает её (README, «Лжец» → «Версии»). Меняется и при
 * смене `GENERATOR_VERSION` — честная основа берётся из `generate`. 2 — PD-172 (новые (а)/(в), пороги по классам);
 * 3 — PD-174 (однозначность отчёта 05, (а) техниками потолка класса, новые пороги); 4 — PD-177 (expert/master:
 * (а) и (в) ещё и в других порядках вычёркиваний, `settleSweep`).
 */
export const LIAR_VERSION = 4;

/**
 * Порог нетривиальности (в) по классам (PD-174): минимальное число постановок до видимого противоречия при
 * самом удачном для игрока порядке ходов. Выбран как максимум, при котором генерация укладывается в бюджет
 * плана режимов §1.5 (замер — README «Лжец → Порог глубины» и «Производительность»).
 */
export const LIAR_MIN_DEPTH: Readonly<Record<Difficulty, number>> = Object.freeze({
  easy: 4,
  medium: 4,
  hard: 5,
  expert: 4,
  master: 4,
});

/** Потолок состояний на уровень точного поиска; превышен — дальше нижняя оценка (детерминированно). */
const EXACT_LEVEL_LIMIT = 20_000;

/**
 * Потолок честных основ (seed-ретраев) по умолчанию. Доля основ, у которых есть ложь не мельче порога, — ≈ 1/5
 * (easy) и больше 1/2 у остальных классов (замер N = 100: максимум 31 основа у easy, 4 у остальных, README «Лжец →
 * Производительность»); 400 даёт вероятность `LiarGenerationError` меньше 10⁻³⁰ на seed. Потолок не меняет
 * результат, пока не исчерпан.
 */
export const LIAR_DEFAULT_MAX_BASES = 400;

export type LiarFailure =
  | "not_refutable" // 1: у полной сетки есть решение
  | "ambiguous" // 2: удаление другой подсказки тоже даёт единственное решение
  | "not_resolvable" // 3: без лжеца решений не ровно одно (или кандидата нет)
  | "visible_at_start" // 4а: ложь видна до первого хода
  | "not_deducible" // 4б: решатель в пределах потолка не дошёл до противоречия
  | "too_shallow"; // 4в: противоречие раньше `minDepth` постановок

export interface LiarValidation {
  /** Все критерии выполнены. */
  readonly honest: boolean;
  /** Ложная подсказка: единственная клетка, удаление которой даёт ровно одно решение; иначе null. */
  readonly liarCell: Cell | null;
  /** Кандидаты в лжецы: подсказки, удаление которых даёт ровно одно решение (у честной сетки — `[liarCell]`). */
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
 * Волновой зонд (PD-172, PD-174) — нижняя оценка глубины противоречия по ВСЕМ порядкам ходов. Волна: (1)
 * вычёркивания ярусов 2..maxTier до фикс-точки в замкнутой форме (`closeEliminations`; для singles-классов их нет);
 * (2) проверка видимого противоречия (`visibleContradiction`); (3) постановка ВСЕХ вынужденных синглов разом
 * (naked; hidden — если maxTier ≥ 1). Противоречие на проверке после k волн → k; синглов нет и противоречия нет →
 * null (застряли).
 *
 * Почему это нижняя оценка: постановки и (замкнутые, монотонные) вычёркивания только сужают кандидатов, поэтому
 * сингл, вынужденный в любой момент любой последовательности ходов, к той же волне уже поставлен (или уже виден
 * конфликт), — по индукции состояние после n волн ⊆ состояния любого игрока после n ходов (игрок применяет
 * стандартные техники в любом порядке и объёме — это частные случаи замкнутых правил). Видимое противоречие
 * монотонно, значит игрок не увидит его раньше, чем через `depth` постановок. `stopAfter` — остановиться после
 * этой волны без постановок.
 */
function waveDepth(bytes: Uint8Array, maxTier: number, stopAfter = Infinity, player = false): number | null {
  const start = initProbe(bytes);
  if (start === null) return 0;
  return waveFrom(start.vals, start.cands, maxTier, stopAfter, new Uint16Array(GRID_SIZE), false, player);
}

/**
 * Волновой зонд от произвольного состояния (меняет `vals`/`cands` на месте; `forced` — рабочий буфер). `settled` —
 * состояние уже после вычёркиваний и проверки без противоречия, а `forced` уже заполнен его синглами: волна 0
 * пропускается (BFS только что сделал ровно её). `player` — вычёркивания игрока (`settle`) вместо замкнутых: такая
 * волна — не нижняя оценка, а реализуемый ход игры (все вынужденные синглы по очереди), ею проверяется (б).
 */
function waveFrom(
  vals: Uint8Array,
  cands: Uint16Array,
  maxTier: number,
  stopAfter: number,
  forced: Uint16Array,
  settled = false,
  player = false,
): number | null {
  for (let wave = 0; ; wave++) {
    if (!(settled && wave === 0)) {
      if (player) settle(vals, cands, maxTier);
      else if (maxTier >= 2) closeEliminations(vals, cands, maxTier);
      if (visibleContradiction(vals, cands, forced, maxTier >= 1)) return wave;
    }
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

/**
 * (а) Ложь не видна на старте (PD-174): волна 0 зонда с потолком класса — вычёркивания ярусов 2..maxTier до
 * фикс-точки, без постановок, затем проверка видимого противоречия (синглы — naked и hidden). У expert/master
 * (PD-177) — и в порядке решателя, и с перебором первого шага (`settleSweep`).
 */
function visibleAtStart(bytes: Uint8Array, maxTier: number): boolean {
  const start = initProbe(bytes);
  if (start === null) return true;
  const forced = new Uint16Array(GRID_SIZE);
  const cands = Uint16Array.from(start.cands);
  settle(start.vals, cands, maxTier);
  if (visibleContradiction(start.vals, cands, forced, true)) return true;
  if (maxTier < 3) return false;
  settleSweep(start.vals, start.cands, maxTier);
  return visibleContradiction(start.vals, start.cands, forced, true);
}

/**
 * Вычёркивания ИГРОКА потолка класса до фикс-точки (на месте) — модель для (а) и точного поиска (в):
 * - singles-классы — вычёркиваний нет (только постановки);
 * - hard (locked candidates) — замкнутая форма (`closeEliminations`, от одного места цифры). Она монотонна, поэтому
 *   любой игрок со стандартными pointing/claiming в любом порядке после тех же постановок знает не больше — глубина
 *   точна по всем таким игрокам. Стандартная форма (от двух мест) немонотонна: замер PD-174 нашёл hard-ложь, где
 *   другой порядок вычёркиваний давал противоречие на постановку раньше, чем порядок решателя;
 * - expert/master (+ пары) — стандартные техники решателя в его порядке (`eliminateToFixpoint`): замкнутая форма
 *   пар разносит следствия синглов без постановок и отсекла бы почти все лжи на старте. Пары немонотонны, поэтому
 *   точный поиск у expert/master проходит второй раз с `settleSweep` — другими порядками (PD-177, README «Лжец →
 *   Как считается глубина»).
 */
function settle(vals: Uint8Array, cands: Uint16Array, maxTier: number): void {
  if (maxTier === 2) closeEliminations(vals, cands, 2);
  else if (maxTier >= 3) eliminateToFixpoint(vals, cands, maxTier);
}

/** Рабочие буферы `settleSweep`. */
const SWEEP_TRY = new Uint16Array(GRID_SIZE);
const SWEEP_ACC = new Uint16Array(GRID_SIZE);

/**
 * Вычёркивания игрока expert/master «в разных порядках» (PD-177, ярус ≥ 3, на месте). Пары и стандартные locked
 * candidates немонотонны: шаг, сделанный раньше, может разрушить шаблон другого шага, поэтому знание игрока зависит
 * от порядка (QA PD-166b: у ~9 % сеток expert/master другой порядок видел ложь на постановку раньше порядка
 * решателя). Раунд: для КАЖДОГО применимого стандартного шага — применить его первым и продолжить до фикс-точки
 * в двух порядках: решателя (locked → naked pair → hidden pair) и обратном (hidden pair → naked pair → locked);
 * знания всех вариантов объединяются (кандидат вычеркнут хоть в одном). Раунды — пока объединение растёт (каждый
 * шаг раунда что-то вычёркивает, так что раундов не больше числа кандидатов); итог — фикс-точка всех стандартных
 * правил, не слабее порядка решателя от того же состояния. Это НЕ нижняя оценка по всем порядкам (её даёт только
 * замкнутая форма — слишком сильная, см. `closeEliminations`), а расширение модели игрока; остаток — README.
 */
function settleSweep(vals: Uint8Array, cands: Uint16Array, maxTier: number): void {
  for (;;) {
    const n = playerSteps(vals, cands, maxTier, -1, ALL_STEP_KINDS);
    if (n === 0) return;
    SWEEP_ACC.set(cands);
    for (let i = 0; i < n; i++) {
      for (let order = 0; order < 2; order++) {
        SWEEP_TRY.set(cands);
        playerSteps(vals, SWEEP_TRY, maxTier, i, ALL_STEP_KINDS);
        if (order === 0) eliminateToFixpoint(vals, SWEEP_TRY, maxTier);
        else reverseToFixpoint(vals, SWEEP_TRY, maxTier);
        for (let c = 0; c < GRID_SIZE; c++) SWEEP_ACC[c] = SWEEP_ACC[c]! & SWEEP_TRY[c]!;
      }
    }
    cands.set(SWEEP_ACC);
    for (let c = 0; c < GRID_SIZE; c++) if (vals[c] === 0 && cands[c] === 0) return; // противоречие уже видно
  }
}

/** Стандартные техники до фикс-точки в обратном порядке ярусов: сначала hidden pair, затем naked pair, затем locked. */
function reverseToFixpoint(vals: Uint8Array, cands: Uint16Array, maxTier: number): void {
  for (;;) {
    let applied = false;
    for (let t = maxTier; t >= 2 && !applied; t--) applied = playerSteps(vals, cands, maxTier, 0, 1 << t) > 0;
    if (!applied) return;
  }
}

/** Виды шагов `playerSteps` — маска ярусов: 2 — locked candidates, 3 — naked pair, 4 — hidden pair. */
const ALL_STEP_KINDS = (1 << 2) | (1 << 3) | (1 << 4);
/** Рабочие буферы `playerSteps`: позиции цифры d в юните u по пустым клеткам (`u * 10 + d`), цифры юнита. */
const STEP_POS = new Uint16Array(27 * 10);
const STEP_HAVE = new Uint16Array(27);

/** Вычеркнул бы `strike` что-нибудь. */
function wouldStrike(vals: Uint8Array, cands: Uint16Array, unit: Uint8Array, where: number, mask: number): boolean {
  for (let i = 0; i < 9; i++) {
    if (!(where & (1 << i))) continue;
    const c = unit[i]!;
    if (vals[c] === 0 && cands[c]! & mask) return true;
  }
  return false;
}

/**
 * Стандартные шаги игрока ярусов 2..maxTier (виды — маска `kinds`), которые что-то вычёркивают, в фиксированном
 * порядке перечисления: locked candidates (от ДВУХ мест; pointing и claiming — по юнитам), naked pair (две клетки с
 * одинаковой парой кандидатов), hidden pair (две цифры ровно в одних и тех же двух клетках). `applyAt` ≥ 0 —
 * применить шаг с этим номером и вернуть `applyAt + 1`; иначе вернуть число шагов, ничего не меняя.
 */
function playerSteps(vals: Uint8Array, cands: Uint16Array, maxTier: number, applyAt: number, kinds: number): number {
  let n = 0;
  const take = (unit: Uint8Array, where: number, mask: number): boolean => {
    if (!wouldStrike(vals, cands, unit, where, mask)) return false;
    if (n === applyAt) {
      strike(vals, cands, unit, where, mask);
      return true;
    }
    n++;
    return false;
  };
  STEP_POS.fill(0);
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    let have = 0;
    for (let i = 0; i < 9; i++) {
      const c = unit[i]!;
      if (vals[c] !== 0) {
        have |= 1 << vals[c]!;
        continue;
      }
      let m = cands[c]!;
      while (m !== 0) {
        const low = m & -m;
        const k = u * 10 + (31 - Math.clz32(low));
        STEP_POS[k] = STEP_POS[k]! | (1 << i);
        m ^= low;
      }
    }
    STEP_HAVE[u] = have;
  }
  if (maxTier >= 2 && kinds & (1 << 2)) {
    for (let u = 0; u < 27; u++) {
      const have = STEP_HAVE[u]!;
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        if (have & bit) continue;
        const p = STEP_POS[u * 10 + d]!;
        if (p === 0 || (p & (p - 1)) === 0) continue; // меньше двух мест
        if (u >= 18) {
          const b = u - 18;
          const rg = confinedTo(p, TRIPLES);
          if (rg >= 0 && take(UNITS[Math.floor(b / 3) * 3 + rg]!, ~TRIPLES[b % 3]! & 0x1ff, bit)) return n + 1;
          const cg = confinedTo(p, BOX_COLS);
          if (cg >= 0 && take(UNITS[9 + (b % 3) * 3 + cg]!, ~TRIPLES[Math.floor(b / 3)]! & 0x1ff, bit)) return n + 1;
        } else {
          const g = confinedTo(p, TRIPLES);
          if (g < 0) continue;
          const b = u < 9 ? Math.floor(u / 3) * 3 + g : g * 3 + Math.floor((u - 9) / 3);
          const outside = u < 9 ? ~TRIPLES[u % 3]! & 0x1ff : ~BOX_COLS[(u - 9) % 3]! & 0x1ff;
          if (take(UNITS[18 + b]!, outside, bit)) return n + 1;
        }
      }
    }
  }
  if (maxTier >= 3 && kinds & (1 << 3)) {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u]!;
      for (let i = 0; i < 9; i++) {
        const ma = cands[unit[i]!]!;
        if (vals[unit[i]!] !== 0 || popcount(ma) !== 2) continue;
        for (let j = i + 1; j < 9; j++) {
          if (vals[unit[j]!] !== 0 || cands[unit[j]!] !== ma) continue;
          if (take(unit, 0x1ff & ~((1 << i) | (1 << j)), ma)) return n + 1;
        }
      }
    }
  }
  if (maxTier >= 4 && kinds & (1 << 4)) {
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u]!;
      for (let d1 = 1; d1 <= 9; d1++) {
        const p = STEP_POS[u * 10 + d1]!;
        if (popcount(p) !== 2) continue;
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          if (STEP_POS[u * 10 + d2] !== p) continue;
          if (take(unit, p, ALL_DIGITS_MASK & ~((1 << d1) | (1 << d2)))) return n + 1;
        }
      }
    }
  }
  return n;
}

/** Рабочие буферы `closeEliminations`: позиции цифры d в юните u (маска индексов 0..8, `u * 10 + d`), цифры юнита. */
const POS = new Uint16Array(27 * 10);
const HAVE = new Uint16Array(27);
/** Рабочие буферы naked/hidden-правил: индексы и маски «малых» (≤ 2) клеток или цифр юнита. */
const SMALL_IDX = new Uint8Array(9);
const SMALL_MASK = new Uint16Array(9);
/** Тройки индексов юнита: 0–2, 3–5, 6–8 (строка блока / блок линии) и столбцы блока. */
const TRIPLES = [0b000000111, 0b000111000, 0b111000000] as const;
const BOX_COLS = [0b001001001, 0b010010010, 0b100100100] as const;

function confinedTo(p: number, masks: readonly number[]): number {
  for (let g = 0; g < 3; g++) if ((p & ~masks[g]!) === 0) return g;
  return -1;
}

/** Вычеркнуть `mask` у пустых клеток юнита `unit` с индексами из `where` (маска 0..8); true — что-то изменилось. */
function strike(vals: Uint8Array, cands: Uint16Array, unit: Uint8Array, where: number, mask: number): boolean {
  let changed = false;
  for (let i = 0; i < 9; i++) {
    if (!(where & (1 << i))) continue;
    const c = unit[i]!;
    if (vals[c] === 0 && cands[c]! & mask) {
      cands[c] = cands[c]! & ~mask;
      changed = true;
    }
  }
  return changed;
}

/**
 * Вычёркивания для ВОЛНОВОГО ЗОНДА (PD-174): техники ярусов 2..maxTier в замкнутой (монотонной) форме, до
 * фикс-точки, на месте. Заполненная клетка участвует в правилах как клетка с единственным кандидатом (своей цифрой).
 * - locked candidates (ярус 2): все места цифры d в блоке (d в блоке не стоит) в одной строке/столбце → d
 *   вычёркивается в остальной части линии; все места d в линии в одном блоке → в остальной части блока. От ОДНОГО
 *   места (стандартная формулировка — от двух);
 * - naked pair (ярус 3): объединение кандидатов двух клеток юнита ≤ 2 цифр → они вычёркиваются у остальных клеток;
 * - hidden pair (ярус 4): объединение мест двух цифр юнита ≤ 2 клеток → у этих клеток остаются только эти цифры.
 * Это НЕ модель игрока (она сильнее: в вырожденных случаях, например две клетки с одним кандидатом, правило
 * разносит следствия синглов без постановки). Нужна она ради монотонности: меньше кандидатов или больше
 * постановок → условие правила сохраняется. Стандартные правила игрока (`eliminateToFixpoint`) — частные случаи,
 * поэтому по индукции состояние волны n ⊆ состояния ЛЮБОГО игрока со стандартными техниками (в любом порядке и
 * объёме) после n постановок, и волна — честная нижняя оценка. Со стандартными правилами это неверно: сужение
 * кандидатов может «сломать» шаблон пары, и волна обгоняла бы реального игрока.
 */
function closeEliminations(vals: Uint8Array, cands: Uint16Array, maxTier: number): void {
  for (let changed = true; changed; ) {
    changed = false;
    // Позиции цифр по юнитам (пустые клетки с кандидатом и заполненная клетка со своей цифрой).
    POS.fill(0);
    for (let u = 0; u < 27; u++) {
      const unit = UNITS[u]!;
      let have = 0;
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        const v = vals[c]!;
        let m = v !== 0 ? 1 << v : cands[c]!;
        if (v !== 0) have |= 1 << v;
        while (m !== 0) {
          const low = m & -m;
          const k = u * 10 + (31 - Math.clz32(low));
          POS[k] = POS[k]! | (1 << i);
          m ^= low;
        }
      }
      HAVE[u] = have;
    }
    // Locked candidates (pointing: блок → линия; claiming: линия → блок). Стоящая в юните цифра пропускается: её
    // вычёркивания уже сделаны постановкой. Устаревшие после вычёркиваний этого прохода позиции — надмножество
    // настоящих, так что вывод остаётся верным; следующий проход пересчитает.
    for (let u = 0; u < 27; u++) {
      const have = HAVE[u]!;
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << d;
        if (have & bit) continue;
        const p = POS[u * 10 + d]!;
        if (p === 0) continue;
        if (u >= 18) {
          const b = u - 18;
          const rg = confinedTo(p, TRIPLES);
          if (rg >= 0) {
            const r = Math.floor(b / 3) * 3 + rg;
            changed = strike(vals, cands, UNITS[r]!, ~TRIPLES[b % 3]! & 0x1ff, bit) || changed;
          }
          const cg = confinedTo(p, BOX_COLS);
          if (cg >= 0) {
            const col = (b % 3) * 3 + cg;
            changed = strike(vals, cands, UNITS[9 + col]!, ~TRIPLES[Math.floor(b / 3)]! & 0x1ff, bit) || changed;
          }
        } else {
          const g = confinedTo(p, TRIPLES);
          if (g < 0) continue;
          // Блок линии и индексы клеток блока вне линии.
          const b = u < 9 ? Math.floor(u / 3) * 3 + g : g * 3 + Math.floor((u - 9) / 3);
          const outside = u < 9 ? ~TRIPLES[u % 3]! & 0x1ff : ~BOX_COLS[(u - 9) % 3]! & 0x1ff;
          changed = strike(vals, cands, UNITS[18 + b]!, outside, bit) || changed;
        }
      }
    }
    if (maxTier >= 3) {
      // Naked pair (замкнутая): две клетки юнита, объединение кандидатов ≤ 2.
      for (let u = 0; u < 27; u++) {
        const unit = UNITS[u]!;
        let n = 0;
        for (let i = 0; i < 9; i++) {
          const c = unit[i]!;
          const m = vals[c] !== 0 ? 1 << vals[c]! : cands[c]!;
          if (m !== 0 && popcount(m) <= 2) {
            SMALL_IDX[n] = i;
            SMALL_MASK[n++] = m;
          }
        }
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            const m = SMALL_MASK[a]! | SMALL_MASK[b]!;
            if (popcount(m) > 2) continue;
            changed = strike(vals, cands, unit, 0x1ff & ~((1 << SMALL_IDX[a]!) | (1 << SMALL_IDX[b]!)), m) || changed;
          }
        }
      }
    }
    if (maxTier >= 4) {
      // Hidden pair (замкнутая): объединение мест двух цифр юнита ≤ 2 клеток. Позиции — из таблицы прохода (после
      // вычёркиваний этого прохода — надмножество настоящих, условие от этого только строже).
      for (let u = 0; u < 27; u++) {
        const unit = UNITS[u]!;
        let n = 0;
        for (let d = 1; d <= 9; d++) {
          const pd = POS[u * 10 + d]!;
          if (pd !== 0 && popcount(pd) <= 2) {
            SMALL_IDX[n] = d;
            SMALL_MASK[n++] = pd;
          }
        }
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            const where = SMALL_MASK[a]! | SMALL_MASK[b]!;
            if (popcount(where) > 2) continue;
            const keep = (1 << SMALL_IDX[a]!) | (1 << SMALL_IDX[b]!);
            for (let i = 0; i < 9; i++) {
              if (!(where & (1 << i))) continue;
              const c = unit[i]!;
              if (vals[c] === 0 && cands[c]! & ~keep) {
                cands[c] = cands[c]! & keep;
                changed = true;
              }
            }
          }
        }
      }
    }
  }
}


/** Состояние точного поиска: значения и кандидаты; `placed` — постановки от старта (коды `клетка·16 + цифра`, по возрастанию). */
interface ProbeState {
  readonly vals: Uint8Array;
  readonly cands: Uint16Array;
  readonly placed: readonly number[];
}

function initProbe(bytes: Uint8Array): { vals: Uint8Array; cands: Uint16Array } | null {
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
 * (в) Точный минимум постановок до видимого противоречия по всем порядкам ходов: BFS по последовательностям
 * постановок синглов; после каждой постановки — вычёркивания игрока потолка до фикс-точки (`settle`). Состояния
 * склеиваются по множеству постановок (у expert/master — и по кандидатам: накопленное знание зависит от пути). Ищет до
 * `cap` постановок; глубже (или если уровень BFS больше `EXACT_LEVEL_LIMIT`) возвращает нижнюю оценку — максимум из
 * пройденной глубины + 1 и волнового зонда. null — противоречие не выводится вообще (б): волна игрока (все
 * вынужденные синглы, вычёркивания игрока) застревает.
 *
 * Expert/master (PD-177): если в порядке решателя глубина d ≥ 1, поиск повторяется до min(d − 1, max(cap − 1, 0))
 * постановок с вычёркиваниями `settleSweep` (другие порядки шагов); нашёл раньше — глубина та, что нашёл. Итог у
 * expert/master: точный в порядке решателя, если ≤ cap, и не больше найденного в других порядках до cap − 1, — для
 * вердикта «глубина ≥ cap» этого достаточно. Второй проход идёт только у кандидатов, переживших первый.
 *
 * Отсечение (PD-174): состояние уровня k не раскрывается, если волновой зонд от него не находит противоречия за
 * `cap − k` волн — волна есть нижняя оценка по всем продолжениям (и по всем порядкам вычёркиваний), значит из этого
 * состояния противоречие не раньше чем через `cap − k + 1` постановок, то есть глубже `cap`. Результат тот же, что
 * без отсечения.
 */
function minPlacements(bytes: Uint8Array, maxTier: number, cap: number): number | null {
  // (б): игрок с техниками потолка доходит до противоречия (у hard+ замкнутая волна сильнее игрока — для (б) не годится).
  if (maxTier >= 2 && waveDepth(bytes, maxTier, Infinity, true) === null) return null;
  const wave = waveDepth(bytes, maxTier);
  if (wave === null) return null;
  if (wave > cap) return wave;
  const depth = searchDepth(bytes, maxTier, cap, wave, false);
  if (maxTier < 3 || depth === 0) return depth;
  // Другие порядки — до cap − 1: этого достаточно для вердикта «глубина ≥ cap» (порог), а уровень cap — самый
  // дорогой (замер PD-177: ×1,7 к цене проверки вместо ×2,8, поймано столько же). Уровень 0 (видно на старте, как (а))
  // проверяется всегда — он дешёвый.
  const sweepCap = Math.min(depth - 1, Math.max(cap - 1, 0));
  const early = searchDepth(bytes, maxTier, sweepCap, wave, true);
  return early <= sweepCap ? early : depth;
}

/** BFS `minPlacements` до `cap` постановок; `sweep` — вычёркивания `settleSweep` вместо порядка решателя. */
function searchDepth(bytes: Uint8Array, maxTier: number, cap: number, wave: number, sweep: boolean): number {
  const start = initProbe(bytes);
  if (start === null) return 0;
  const settleState = (vals: Uint8Array, cands: Uint16Array): void => {
    if (sweep) settleSweep(vals, cands, maxTier);
    else settle(vals, cands, maxTier);
  };
  const forced = new Uint16Array(GRID_SIZE);
  const scratch = new Uint16Array(GRID_SIZE);
  const probeVals = new Uint8Array(GRID_SIZE);
  const probeCands = new Uint16Array(GRID_SIZE);
  settleState(start.vals, start.cands);
  let level: ProbeState[] = [{ ...start, placed: [] }];
  for (let k = 0; k <= cap; k++) {
    const next: ProbeState[] = [];
    const seen = new Set<string>();
    for (const st of level) {
      if (visibleContradiction(st.vals, st.cands, forced, maxTier >= 1)) return k;
      if (k === cap) continue;
      probeVals.set(st.vals);
      probeCands.set(st.cands);
      scratch.set(forced);
      if (waveFrom(probeVals, probeCands, maxTier, cap - k, scratch, true) === null) continue; // глубже cap
      for (let c = 0; c < GRID_SIZE; c++) {
        const f = forced[c]!;
        if (f === 0) continue;
        const digit = 31 - Math.clz32(f);
        // Ключ дедупликации — множество постановок от старта (то же, что значения сетки: старт общий). До яруса 2
        // включительно вычёркивания игрока монотонны и состояние определяется постановками; со стандартными парами
        // (ярус ≥ 3) накопленное знание зависит от пути — в ключ входят и кандидаты после вычёркиваний.
        const code = c * 16 + digit;
        const placed = [...st.placed, code].sort((x, y) => x - y);
        let key = placed.join(",");
        if (maxTier < 3 && seen.has(key)) continue;
        const vals = Uint8Array.from(st.vals);
        vals[c] = digit;
        const cands = Uint16Array.from(st.cands);
        cands[c] = 0;
        const peers = PEERS[c]!;
        for (let i = 0; i < 20; i++) {
          const p = peers[i]!;
          if (vals[p] === 0) cands[p] = cands[p]! & ~f;
        }
        settleState(vals, cands);
        if (maxTier >= 3) {
          key += `|${String.fromCharCode(...cands)}`;
          if (seen.has(key)) continue;
        }
        seen.add(key);
        next.push({ vals, cands, placed });
      }
    }
    // Пусто — все пути отсечены (глубже cap) или застряли (противоречия на них нет вообще).
    if (next.length === 0) return Math.max(cap + 1, wave);
    if (next.length > EXACT_LEVEL_LIMIT) return Math.max(k + 1, wave);
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

/**
 * Внутреннее (замеры и тесты): глубина (в) для произвольной сетки — `minPlacements` с поиском до `cap` постановок
 * (точная, если ≤ `cap`, иначе нижняя оценка > `cap`); null — противоречие техниками потолка не выводится.
 */
export function contradictionDepth(mission: GridInput, maxTier: number, cap: number): number | null {
  return minPlacements(toBytes(mission), maxTier, cap);
}

/**
 * Внутреннее (тесты, PD-177): волновой зонд от старта — нижняя оценка глубины (в) по всем игрокам (вычёркивания
 * ярусов 2..maxTier в замкнутой форме); null — волна застряла. Замкнутые правила монотонны, поэтому их фикс-точка
 * не зависит от порядка — тест сверяет её с независимой моделью точно.
 */
export function contradictionWave(mission: GridInput, maxTier: number): number | null {
  return waveDepth(toBytes(mission), maxTier);
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

  // 2–3. Кандидаты в лжецы: подсказки, без которых решение ровно одно (≥ 2 решений — не кандидат, PD-174).
  const suspects: Cell[] = [];
  let liarCell: Cell | null = null;
  let solution: string | null = null;
  const probe = Uint8Array.from(bytes);
  for (let c = 0; c < GRID_SIZE; c++) {
    const v = probe[c]!;
    if (v === 0) continue;
    probe[c] = 0;
    if (countSolutionsBytes(probe, 2) === 1) suspects.push(c);
    probe[c] = v;
  }
  if (suspects.length > 1) failures.push("ambiguous");
  if (suspects.length === 1) {
    liarCell = suspects[0]!;
    probe[liarCell] = 0;
    // Единственность уже доказана счётчиком — достаём само решение.
    solution = bytesToString(solveFirst(probe));
    probe[liarCell] = bytes[liarCell]!;
  } else {
    failures.push("not_resolvable");
  }

  // 4. Нетривиальность.
  if (visibleAtStart(bytes, maxTier)) failures.push("visible_at_start");
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
 * Поэтому, перебрав решения `основа − c` для всех c и посчитав (до двух) решения с каждой цифрой в каждой
 * клетке, одной маской на клетку получаем все (L, w), для которых какая-то другая подсказка тоже даёт
 * ЕДИНСТВЕННОЕ решение (`covered[L]` бит w). Подсказки, у которых решений не меньше `COVERAGE_LIMIT` (перебор
 * неполный — «ровно одно» по нему не определить), возвращаются в `heavy` — для них проверка поштучная.
 */
function coverage(honest: Uint8Array, limit: number): { covered: Uint16Array; heavy: Cell[] } {
  const covered = new Uint16Array(GRID_SIZE);
  const heavy: Cell[] = [];
  const empties: Cell[] = [];
  for (let c = 0; c < GRID_SIZE; c++) if (honest[c] === 0) empties.push(c);
  const work = Uint8Array.from(honest);
  const once = new Uint16Array(GRID_SIZE);
  const twice = new Uint16Array(GRID_SIZE);
  for (let c = 0; c < GRID_SIZE; c++) {
    const v = work[c]!;
    if (v === 0) continue;
    work[c] = 0;
    once.fill(0);
    twice.fill(0);
    const n = forEachSolutionBytes(work, limit, (sol) => {
      for (const e of empties) {
        const bit = 1 << sol[e]!;
        twice[e] = twice[e]! | (once[e]! & bit);
        once[e] = once[e]! | bit;
      }
    });
    if (n >= limit) heavy.push(c);
    else for (const e of empties) covered[e] = covered[e]! | (once[e]! & ~twice[e]!);
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
 * клетке оно ≠ digit), а значит и то, что сам лжец — кандидат; проверяются (2) — по таблице покрытия и
 * поштучно для `heavy`, затем (а), (б)/(в).
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
      if (visibleAtStart(liar, maxTier)) return null;
      const depth = minPlacements(liar, maxTier, minDepth);
      if (depth === null || depth < minDepth) return null;
      for (const c of cov.heavy) {
        const v = liar[c]!;
        liar[c] = 0;
        const n = countSolutionsBytes(liar, 2);
        liar[c] = v;
        if (n === 1) return null;
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
  return generateLiarWithDepth(options, undefined);
}

/**
 * Внутреннее (калибровка порога в `scripts/measure-liar.ts`): `generateLiar` с порогом (в) `minDepth` вместо
 * `LIAR_MIN_DEPTH[difficulty]` (undefined — порог класса). Результат с нестандартным порогом — не продуктовый Лжец.
 */
export function generateLiarWithDepth(options: GenerateLiarOptions, minDepthOverride: number | undefined): LiarPuzzle {
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
  const minDepth = minDepthOverride ?? LIAR_MIN_DEPTH[difficulty];
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
