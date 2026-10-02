/**
 * Лесенка подсказок (PD-134): `nextHint(state)` — ближайший логичный шаг по текущей доске игрока.
 *
 * Результат разложен по ступеням лесенки (UI показывает их по одной, цифру — только на последней):
 *   1. `region`      — дом (строка/столбец/блок), где лежит шаг;
 *   2. `technique`   — id техники (`Technique`);
 *   3. `cells`       — клетки паттерна, клетки-свидетели и затронутые клетки;
 *   4. `explanation` — структурированные данные разбора (id + параметры, без готовых строк — i18n на UI);
 *   5. `placement` / `eliminations` — итог шага (UI решает, показывать ли цифру).
 *
 * Все данные — сериализуемый JSON. Движок не меняет входное состояние. Техники реализованы по их
 * общеизвестному описанию (README, «Лицензии»); код HoDoKu/Sudoku Explainer (GPL) не использовался.
 *
 * Кандидаты считаются самим движком из цифр на доске. Заметки игрока на корректность не влияют:
 * они нужны только затем, чтобы не показывать повторно шаг-вычёркивание, который игрок уже выполнил
 * в заметках (иначе подсказка зацикливалась бы на нём, ведь доска от вычёркиваний не меняется).
 */
import {
  ALL_DIGITS_MASK,
  BOX_OF,
  COL_OF,
  PEERS,
  ROW_OF,
  UNITS,
  assertCell,
  maskToDigits,
  maskToSingleDigit,
  peerMask,
  popcount,
  toBytes,
} from "./grid.js";
import { countSolutionsBytes, solveBytes } from "./solver.js";
import type { Cell, Digit, Elimination, GridInput, Technique } from "./types.js";

// ---------------------------------------------------------------------------------------------
// Публичные типы
// ---------------------------------------------------------------------------------------------

export type HintRegionKind = "row" | "col" | "box";

/** Дом. `index` — 0-based (UI показывает +1); `unit` — индекс в `UNITS` (0..8 строки, 9..17 столбцы, 18..26 блоки). */
export interface HintRegion {
  readonly kind: HintRegionKind;
  readonly index: number;
  readonly unit: number;
}

/** Состояние доски игрока. */
export interface HintState {
  /** Исходные подсказки (81). Нужны для проверки доски и вывода решения, если `solution` не передан. */
  readonly givens: GridInput;
  /** Текущая доска: подсказки + цифры игрока (возможно неверные). Подсказки должны совпадать с `givens`. */
  readonly values: GridInput;
  /**
   * Решение (81 цифра). Необязательно: если нет, выводится из `givens` (нужна единственность решения,
   * иначе результат `none/invalid_puzzle`). Передавайте, когда оно под рукой (`Puzzle.solution`) — быстрее.
   */
  readonly solution?: GridInput;
  /**
   * Заметки игрока — 81 битовая маска, бит `d` = цифра `d` (как в `timelapseFrames`), 0 — заметок в клетке нет.
   * Влияют только на то, какое из ещё не сделанных вычёркиваний показать; корректность от них не зависит.
   */
  readonly notes?: readonly number[];
  /** Клетка последнего хода игрока: при равной технике выбирается шаг, ближайший к ней. */
  readonly lastCell?: Cell;
}

/** Клетки шага по ролям. */
export interface HintCells {
  /** Клетки паттерна: клетка singles, клетки locked candidates / пары; для ошибки — неверные клетки в области. */
  readonly target: readonly Cell[];
  /**
   * Клетки-свидетели: цифры, из-за которых вывод верен (для singles/locked — клетки с цифрой, закрывающие
   * остальные клетки; для ошибки — дубликаты цифры в области). Пары свидетелей не имеют (их роль играет весь дом).
   */
  readonly witnesses: readonly Cell[];
  /** Клетки, где что-то вычёркивается (locked, пары); пусто для singles и ошибки. */
  readonly affected: readonly Cell[];
}

/**
 * Разбор — id + параметры. Ключи i18n: `hint.explain.<id>`; клетки — индексы `0..80` (UI форматирует
 * `r{row+1}c{col+1}` сам), дома — `HintRegion`.
 */
export type HintExplanation =
  | { readonly id: "naked_single"; readonly params: { readonly cell: Cell; readonly digit: Digit } }
  | {
      readonly id: "hidden_single";
      readonly params: { readonly cell: Cell; readonly digit: Digit; readonly region: HintRegion };
    }
  | {
      readonly id: "locked_pointing";
      readonly params: { readonly digit: Digit; readonly source: HintRegion; readonly target: HintRegion };
    }
  | {
      readonly id: "locked_claiming";
      readonly params: { readonly digit: Digit; readonly source: HintRegion; readonly target: HintRegion };
    }
  | {
      readonly id: "naked_pair";
      readonly params: {
        readonly digits: readonly [Digit, Digit];
        readonly cells: readonly [Cell, Cell];
        readonly region: HintRegion;
      };
    }
  | {
      readonly id: "hidden_pair";
      readonly params: {
        readonly digits: readonly [Digit, Digit];
        readonly cells: readonly [Cell, Cell];
        readonly region: HintRegion;
      };
    }
  | { readonly id: "mistake_conflict"; readonly params: { readonly digit: Digit; readonly region: HintRegion } }
  | { readonly id: "mistake_hidden"; readonly params: { readonly region: HintRegion } };

export type HintExplanationId = HintExplanation["id"];

export interface HintPlacement {
  readonly cell: Cell;
  readonly digit: Digit;
}

/** Куда ведёт шаг-вычёркивание: первая постановка, возникающая после него (по цепочке техник движка). */
export interface HintLead extends HintPlacement {
  readonly technique: "naked_single" | "hidden_single";
}

/** Логический шаг по доске. */
export interface StepHint {
  readonly kind: "step";
  /** Ступень 2. */
  readonly technique: Technique;
  /** Ступень 1. */
  readonly region: HintRegion;
  /** Ступень 3. */
  readonly cells: HintCells;
  /** Ступень 4. */
  readonly explanation: HintExplanation;
  /** Ступень 5 для singles: поставить цифру. */
  readonly placement?: HintPlacement;
  /**
   * Ступень 5 для locked candidates / пар: вычеркнуть кандидатов. Только ещё не отражённые в заметках
   * игрока (без `notes` — все).
   */
  readonly eliminations?: readonly Elimination[];
  /**
   * Только для шагов-вычёркиваний: постановка, к которой они приводят (`null` — цепочка техник движка
   * её не достигает). Для игроков без заметок: после шага-вычёркивания доска не меняется, так что именно
   * это и есть «что получится».
   */
  readonly leadsTo?: HintLead | null;
  /**
   * Вычёркивания, на которые опирается шаг, потому что игрок уже отметил их в заметках (и они логичны).
   * Пусто, если шаг выводится прямо из цифр доски. UI может добавить «с учётом убранных вами кандидатов».
   */
  readonly assumes: readonly Elimination[];
}

/** На доске есть неверная цифра (относительно решения). */
export interface MistakeHint {
  readonly kind: "mistake";
  /** Ступень 1: область (дом), где есть ошибка, — не точная клетка. */
  readonly region: HintRegion;
  /** Ступень 3: `target` — неверные клетки внутри области; `witnesses` — видимые дубликаты в ней. */
  readonly cells: HintCells;
  /** Ступень 4. */
  readonly explanation: HintExplanation;
  /** Сколько неверных цифр на всей доске (UI решает, показывать ли). */
  readonly totalWrong: number;
}

export type NoHintReason =
  /** Все клетки заполнены верно. */
  | "solved"
  /**
   * Ошибок нет, но ни одна техника движка не применима (нужен X-Wing и выше — их в движке нет).
   * Это не «логики не существует», а «движок её не умеет».
   */
  | "beyond"
  /** `givens` без решения или с несколькими решениями (и `solution` не передан). */
  | "invalid_puzzle";

export interface NoHint {
  readonly kind: "none";
  readonly reason: NoHintReason;
}

export type Hint = StepHint | MistakeHint | NoHint;

// ---------------------------------------------------------------------------------------------
// Рабочее состояние
// ---------------------------------------------------------------------------------------------

interface Work {
  vals: Uint8Array;
  /** Маски кандидатов (бит d = цифра d). */
  cands: Uint16Array;
  /** Кандидаты, снятые вычёркиванием техники (в отличие от снятых соседними цифрами). */
  elim: Uint16Array;
}

function initWork(vals: Uint8Array): Work {
  const cands = new Uint16Array(81);
  for (let c = 0; c < 81; c++) if (vals[c] === 0) cands[c] = peerMask(vals, c);
  return { vals: Uint8Array.from(vals), cands, elim: new Uint16Array(81) };
}

function cloneWork(w: Work): Work {
  return { vals: Uint8Array.from(w.vals), cands: Uint16Array.from(w.cands), elim: Uint16Array.from(w.elim) };
}

function placeDigit(w: Work, cell: Cell, d: Digit): void {
  w.vals[cell] = d;
  w.cands[cell] = 0;
  const bit = 1 << d;
  const peers = PEERS[cell]!;
  for (let i = 0; i < 20; i++) w.cands[peers[i]!] = w.cands[peers[i]!]! & ~bit;
}

function eliminateDigit(w: Work, cell: Cell, d: Digit): void {
  const bit = 1 << d;
  w.cands[cell] = w.cands[cell]! & ~bit;
  w.elim[cell] = w.elim[cell]! | bit;
}

function regionOf(unit: number): HintRegion {
  return { kind: unit < 9 ? "row" : unit < 18 ? "col" : "box", index: unit % 9, unit };
}

// ---------------------------------------------------------------------------------------------
// Перечисление шагов по техникам (все шаги яруса, не первый)
// ---------------------------------------------------------------------------------------------

interface Raw {
  readonly technique: Technique;
  /** Порядок обнаружения при сканировании — детерминированный тай-брейк. */
  readonly order: number;
  readonly target: readonly Cell[];
  readonly digit?: Digit;
  readonly digits?: readonly [Digit, Digit];
  /** Кандидаты в `region` (singles: дома, где цифра скрыта; прочие — дом паттерна). */
  readonly units: readonly number[];
  /** Locked candidates: целевой дом вычёркивания. */
  readonly targetUnit?: number;
  readonly variant?: "pointing" | "claiming";
  readonly placement?: HintPlacement;
  readonly eliminations?: readonly Elimination[];
}

function nakedSingles(w: Work): Raw[] {
  const out: Raw[] = [];
  for (let c = 0; c < 81; c++) {
    if (w.vals[c] !== 0) continue;
    const d = maskToSingleDigit(w.cands[c]!);
    if (d === 0) continue;
    out.push({ technique: "naked_single", order: c, target: [c], units: [], placement: { cell: c, digit: d } });
  }
  return out;
}

function hiddenSingles(w: Work): Raw[] {
  const byKey = new Map<number, { cell: Cell; digit: Digit; units: number[]; order: number }>();
  let order = 0;
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let where = -1;
      let count = 0;
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        if (w.cands[c]! & bit) {
          count++;
          where = c;
          if (count > 1) break;
        }
      }
      if (count !== 1) continue;
      const key = where * 10 + d;
      const hit = byKey.get(key);
      if (hit) hit.units.push(u);
      else byKey.set(key, { cell: where, digit: d as Digit, units: [u], order: order++ });
    }
  }
  return [...byKey.values()].map((h) => ({
    technique: "hidden_single" as const,
    order: h.order,
    target: [h.cell],
    units: h.units,
    placement: { cell: h.cell, digit: h.digit },
  }));
}

function lockedCandidates(w: Work): Raw[] {
  const out: Raw[] = [];
  let order = 0;
  // Pointing: цифра блока лежит на одной линии → вычёркиваем её на линии вне блока.
  for (let b = 0; b < 9; b++) {
    const unit = UNITS[18 + b]!;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let rows = 0;
      let cols = 0;
      let count = 0;
      const where: Cell[] = [];
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        if (w.cands[c]! & bit) {
          count++;
          rows |= 1 << ROW_OF[c]!;
          cols |= 1 << COL_OF[c]!;
          where.push(c);
        }
      }
      if (count < 2) continue;
      if ((rows & (rows - 1)) === 0) {
        const r = 31 - Math.clz32(rows);
        order = pushLocked(out, w, order, d as Digit, 18 + b, r, "pointing", where, (c) => BOX_OF[c] !== b);
      }
      if ((cols & (cols - 1)) === 0) {
        const col = 31 - Math.clz32(cols);
        order = pushLocked(out, w, order, d as Digit, 18 + b, 9 + col, "pointing", where, (c) => BOX_OF[c] !== b);
      }
    }
  }
  // Claiming: цифра линии лежит в одном блоке → вычёркиваем её в блоке вне линии.
  for (let u = 0; u < 18; u++) {
    const unit = UNITS[u]!;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let boxes = 0;
      let count = 0;
      const where: Cell[] = [];
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        if (w.cands[c]! & bit) {
          count++;
          boxes |= 1 << BOX_OF[c]!;
          where.push(c);
        }
      }
      if (count < 2 || (boxes & (boxes - 1)) !== 0) continue;
      const b = 31 - Math.clz32(boxes);
      const inLine = u < 9 ? (c: Cell) => ROW_OF[c] !== u : (c: Cell) => COL_OF[c] !== u - 9;
      order = pushLocked(out, w, order, d as Digit, u, 18 + b, "claiming", where, inLine);
    }
  }
  return out;
}

function pushLocked(
  out: Raw[],
  w: Work,
  order: number,
  digit: Digit,
  sourceUnit: number,
  targetUnit: number,
  variant: "pointing" | "claiming",
  pattern: readonly Cell[],
  outside: (c: Cell) => boolean,
): number {
  const bit = 1 << digit;
  const target = UNITS[targetUnit]!;
  const eliminations: Elimination[] = [];
  for (let i = 0; i < 9; i++) {
    const c = target[i]!;
    if (outside(c) && w.cands[c]! & bit) eliminations.push({ cell: c, digit });
  }
  if (eliminations.length === 0) return order;
  out.push({
    technique: "locked_candidates",
    order,
    target: pattern,
    digit,
    units: [sourceUnit],
    targetUnit,
    variant,
    eliminations,
  });
  return order + 1;
}

function nakedPairs(w: Work): Raw[] {
  const out: Raw[] = [];
  let order = 0;
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    for (let i = 0; i < 9; i++) {
      const a = unit[i]!;
      const ma = w.cands[a]!;
      if (ma === 0 || popcount(ma) !== 2) continue;
      for (let j = i + 1; j < 9; j++) {
        const b = unit[j]!;
        if (w.cands[b] !== ma) continue;
        const eliminations: Elimination[] = [];
        for (let k = 0; k < 9; k++) {
          const c = unit[k]!;
          if (c === a || c === b) continue;
          const hit = w.cands[c]! & ma;
          if (hit) for (const d of maskToDigits(hit)) eliminations.push({ cell: c, digit: d });
        }
        if (eliminations.length === 0) continue;
        const [d1, d2] = maskToDigits(ma) as [Digit, Digit];
        out.push({ technique: "naked_pair", order: order++, target: [a, b], digits: [d1, d2], units: [u], eliminations });
      }
    }
  }
  return out;
}

function hiddenPairs(w: Work): Raw[] {
  const out: Raw[] = [];
  let order = 0;
  const pos = new Uint16Array(10);
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    pos.fill(0);
    for (let i = 0; i < 9; i++) {
      const m = w.cands[unit[i]!]!;
      for (let d = 1; d <= 9; d++) if (m & (1 << d)) pos[d] = pos[d]! | (1 << i);
    }
    for (let d1 = 1; d1 <= 9; d1++) {
      const p = pos[d1]!;
      if (p === 0 || popcount(p) !== 2) continue;
      for (let d2 = d1 + 1; d2 <= 9; d2++) {
        if (pos[d2] !== p) continue;
        const pairMask = (1 << d1) | (1 << d2);
        const cells: Cell[] = [];
        for (let i = 0; i < 9; i++) if (p & (1 << i)) cells.push(unit[i]!);
        const eliminations: Elimination[] = [];
        for (const c of cells) {
          const extra = w.cands[c]! & ~pairMask;
          if (extra) for (const d of maskToDigits(extra)) eliminations.push({ cell: c, digit: d });
        }
        if (eliminations.length === 0) continue;
        out.push({
          technique: "hidden_pair",
          order: order++,
          target: cells,
          digits: [d1 as Digit, d2 as Digit],
          units: [u],
          eliminations,
        });
      }
    }
  }
  return out;
}

const ENUMERATORS: readonly ((w: Work) => Raw[])[] = [
  nakedSingles,
  hiddenSingles,
  lockedCandidates,
  nakedPairs,
  hiddenPairs,
];
const FIRST_ELIMINATION_TIER = 2;

function applyRaw(w: Work, raw: Raw): void {
  if (raw.placement) placeDigit(w, raw.placement.cell, raw.placement.digit);
  else for (const e of raw.eliminations!) eliminateDigit(w, e.cell, e.digit);
}

// ---------------------------------------------------------------------------------------------
// Выбор шага
// ---------------------------------------------------------------------------------------------

/** 0 — сама клетка, 1 — сосед (общий дом), 2 — далеко. Без `lastCell` — всегда 0 (порядок скана). */
function proximity(last: Cell | undefined, cells: readonly Cell[]): number {
  if (last === undefined) return 0;
  let best = 2;
  for (const c of cells) {
    if (c === last) return 0;
    if (ROW_OF[c] === ROW_OF[last] || COL_OF[c] === COL_OF[last] || BOX_OF[c] === BOX_OF[last]) best = 1;
  }
  return best;
}

function pickBest(raws: readonly Raw[], last: Cell | undefined): Raw {
  let best = raws[0]!;
  let bestProx = proximity(last, best.target);
  for (let i = 1; i < raws.length; i++) {
    const r = raws[i]!;
    const p = proximity(last, r.target);
    if (p < bestProx || (p === bestProx && r.order < best.order)) {
      best = r;
      bestProx = p;
    }
  }
  return best;
}

/** Заметки игрока уже не содержат этого кандидата (в клетке заметки используются). */
function reflected(notes: readonly number[] | undefined, e: Elimination): boolean {
  if (!notes) return false;
  const m = notes[e.cell]!;
  return m !== 0 && (m & (1 << e.digit)) === 0;
}

/** Предпочтение дома среди равных: клетка последнего хода, затем блок → строка → столбец. */
function preferredUnit(units: readonly number[], last: Cell | undefined): number {
  const rank = (u: number): number => {
    const inLast = last !== undefined && UNITS[u]!.includes(last) ? 0 : 3;
    return inLast + (u >= 18 ? 0 : u < 9 ? 1 : 2);
  };
  let best = units[0]!;
  for (const u of units) if (rank(u) < rank(best)) best = u;
  return best;
}

function filledIn(w: Work, u: number): number {
  let n = 0;
  for (const c of UNITS[u]!) if (w.vals[c] !== 0) n++;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Свидетели
// ---------------------------------------------------------------------------------------------

interface Why {
  witnesses: Cell[];
  assumes: Elimination[];
}

function holderOf(w: Work, cell: Cell, d: number): Cell[] {
  const out: Cell[] = [];
  const peers = PEERS[cell]!;
  for (let i = 0; i < 20; i++) if (w.vals[peers[i]!] === d) out.push(peers[i]!);
  return out;
}

/**
 * Почему цифры `d` нет среди кандидатов клеток `cells`: жадно выбираем мало клеток-держателей `d`,
 * перекрывающих все `cells`; клетки без держателя закрыты вычёркиванием → `assumes`.
 */
function whyDigitExcluded(w: Work, cells: readonly Cell[], d: Digit, into: Why): void {
  const uncovered = new Set<Cell>();
  const holders = new Map<Cell, Set<Cell>>(); // держатель → клетки, которые он закрывает
  for (const x of cells) {
    if (w.vals[x] !== 0) continue;
    const hs = holderOf(w, x, d);
    if (hs.length === 0) {
      into.assumes.push({ cell: x, digit: d });
      continue;
    }
    uncovered.add(x);
    for (const h of hs) {
      let set = holders.get(h);
      if (!set) holders.set(h, (set = new Set()));
      set.add(x);
    }
  }
  while (uncovered.size > 0) {
    let best = -1;
    let bestGain = 0;
    for (const [h, set] of [...holders.entries()].sort((a, b) => a[0] - b[0])) {
      let gain = 0;
      for (const x of set) if (uncovered.has(x)) gain++;
      if (gain > bestGain) {
        best = h;
        bestGain = gain;
      }
    }
    into.witnesses.push(best);
    for (const x of holders.get(best)!) uncovered.delete(x);
  }
}

function dedupeElims(list: readonly Elimination[]): Elimination[] {
  const seen = new Set<number>();
  const out: Elimination[] = [];
  for (const e of list) {
    const k = e.cell * 10 + e.digit;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(e);
    }
  }
  return out.sort((a, b) => a.cell - b.cell || a.digit - b.digit);
}

/** Для клетки: каждая цифра вне `keep` закрыта держателем (по одному на цифру, если `withWitnesses`) либо вычёркиванием. */
function whyCellMask(w: Work, cell: Cell, keep: number, withWitnesses: boolean, into: Why): void {
  for (let d = 1; d <= 9; d++) {
    if (keep & (1 << d)) continue;
    const hs = holderOf(w, cell, d);
    if (hs.length === 0) into.assumes.push({ cell, digit: d as Digit });
    else if (withWitnesses) into.witnesses.push(hs[0]!);
  }
}

function sorted(cells: readonly Cell[]): Cell[] {
  return [...new Set(cells)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------------------------
// Сборка результата
// ---------------------------------------------------------------------------------------------

function buildStep(w: Work, raw: Raw, eliminations: readonly Elimination[] | undefined, last: Cell | undefined): StepHint {
  const why: Why = { witnesses: [], assumes: [] };
  let region: HintRegion;
  let explanation: HintExplanation;
  let affected: Cell[] = [];

  switch (raw.technique) {
    case "naked_single": {
      const { cell, digit } = raw.placement!;
      let bestU = 18 + BOX_OF[cell]!;
      for (const u of [18 + BOX_OF[cell]!, ROW_OF[cell]!, 9 + COL_OF[cell]!]) {
        const better = filledIn(w, u) > filledIn(w, bestU);
        const tie = filledIn(w, u) === filledIn(w, bestU) && last !== undefined && UNITS[u]!.includes(last) && !UNITS[bestU]!.includes(last);
        if (better || tie) bestU = u;
      }
      region = regionOf(bestU);
      whyCellMask(w, cell, 1 << digit, true, why);
      explanation = { id: "naked_single", params: { cell, digit } };
      break;
    }
    case "hidden_single": {
      const { cell, digit } = raw.placement!;
      region = regionOf(preferredUnit(raw.units, last));
      whyDigitExcluded(w, Array.from(UNITS[region.unit]!).filter((c) => c !== cell), digit, why);
      explanation = { id: "hidden_single", params: { cell, digit, region } };
      break;
    }
    case "locked_candidates": {
      const digit = raw.digit!;
      region = regionOf(raw.units[0]!);
      const rest = Array.from(UNITS[region.unit]!).filter((c) => !raw.target.includes(c));
      whyDigitExcluded(w, rest, digit, why);
      const target = regionOf(raw.targetUnit!);
      explanation = {
        id: raw.variant === "pointing" ? "locked_pointing" : "locked_claiming",
        params: { digit, source: region, target },
      };
      affected = sorted(eliminations!.map((e) => e.cell));
      break;
    }
    case "naked_pair": {
      region = regionOf(raw.units[0]!);
      const keep = (1 << raw.digits![0]) | (1 << raw.digits![1]);
      for (const c of raw.target) whyCellMask(w, c, keep, false, why);
      explanation = {
        id: "naked_pair",
        params: { digits: raw.digits!, cells: [raw.target[0]!, raw.target[1]!], region },
      };
      affected = sorted(eliminations!.map((e) => e.cell));
      break;
    }
    case "hidden_pair": {
      region = regionOf(raw.units[0]!);
      const rest = Array.from(UNITS[region.unit]!).filter((c) => !raw.target.includes(c));
      for (const d of raw.digits!) whyDigitExcluded(w, rest, d, { witnesses: [], assumes: why.assumes });
      explanation = {
        id: "hidden_pair",
        params: { digits: raw.digits!, cells: [raw.target[0]!, raw.target[1]!], region },
      };
      affected = sorted(eliminations!.map((e) => e.cell));
      break;
    }
  }

  const base = {
    kind: "step" as const,
    technique: raw.technique,
    region,
    cells: { target: [...raw.target], witnesses: sorted(why.witnesses), affected },
    explanation,
    assumes: dedupeElims(why.assumes),
  };
  if (raw.placement) return { ...base, placement: { ...raw.placement } };

  const after = cloneWork(w);
  applyRaw(after, raw);
  return { ...base, eliminations: eliminations!.map((e) => ({ ...e })), leadsTo: leadFrom(after) };
}

/** Первая постановка по цепочке техник (дешёвая первой, порядок скана); `null`, если цепочка застревает. */
function leadFrom(start: Work): HintLead | null {
  const w = start;
  for (let guard = 0; guard < 2000; guard++) {
    let raws: Raw[] = [];
    for (let tier = 0; tier < ENUMERATORS.length && raws.length === 0; tier++) raws = ENUMERATORS[tier]!(w);
    if (raws.length === 0) return null;
    const raw = pickBest(raws, undefined);
    if (raw.placement) return { ...raw.placement, technique: raw.technique as "naked_single" | "hidden_single" };
    applyRaw(w, raw);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Ошибки игрока
// ---------------------------------------------------------------------------------------------

function mistakeHint(vals: Uint8Array, wrong: readonly Cell[], last: Cell | undefined): MistakeHint {
  // Видимые дубликаты у неверных клеток.
  const dupOf = (c: Cell): Cell[] => {
    const out: Cell[] = [];
    for (const p of PEERS[c]!) if (vals[p] === vals[c]) out.push(p);
    return out;
  };
  const withDup = wrong.filter((c) => dupOf(c).length > 0);
  // Приоритет: клетка последнего хода, затем с видимым дубликатом, затем по индексу.
  const chosen =
    last !== undefined && wrong.includes(last) ? last : withDup.length > 0 ? withDup[0]! : wrong[0]!;
  const dups = dupOf(chosen);
  let region: HintRegion;
  let explanation: HintExplanation;
  if (dups.length > 0) {
    const p = dups[0]!;
    const unit =
      ROW_OF[p] === ROW_OF[chosen] ? ROW_OF[chosen]! : COL_OF[p] === COL_OF[chosen] ? 9 + COL_OF[chosen]! : 18 + BOX_OF[chosen]!;
    region = regionOf(unit);
    explanation = { id: "mistake_conflict", params: { digit: vals[chosen] as Digit, region } };
  } else {
    region = regionOf(18 + BOX_OF[chosen]!);
    explanation = { id: "mistake_hidden", params: { region } };
  }
  const inRegion = new Set<number>(UNITS[region.unit]!);
  const target = wrong.filter((c) => inRegion.has(c));
  const witnesses =
    explanation.id === "mistake_conflict"
      ? sorted(target.flatMap((c) => dupOf(c).filter((p) => inRegion.has(p))))
      : [];
  return { kind: "mistake", region, cells: { target, witnesses, affected: [] }, explanation, totalWrong: wrong.length };
}

// ---------------------------------------------------------------------------------------------
// Точка входа
// ---------------------------------------------------------------------------------------------

function checkNotes(notes: readonly number[] | undefined): void {
  if (notes === undefined) return;
  if (notes.length !== 81) throw new RangeError(`notes must have 81 masks, got ${notes.length}`);
  for (let i = 0; i < 81; i++) {
    const m = notes[i];
    if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > ALL_DIGITS_MASK) {
      throw new RangeError(`Invalid notes mask ${String(m)} at ${i}`);
    }
  }
}

/**
 * Ближайший логичный шаг по доске игрока.
 *
 * **Порядок выбора** (детерминированный; один и тот же `state` → один и тот же результат):
 * 1. Ошибка игрока (цифра не совпадает с решением) → `mistake`, пока она на доске.
 * 2. Иначе самая дешёвая применимая техника (`TECHNIQUE_ORDER`: naked single → hidden single → locked
 *    candidates → naked pair → hidden pair); кандидаты считаются из цифр доски.
 * 3. Внутри техники — шаг, ближайший к `lastCell` (сама клетка → сосед по дому → далеко), при равенстве
 *    или без `lastCell` — первый в порядке скана (дома 0..26 по возрастанию, цифры 1..9, клетки 0..80).
 * 4. Шаги-вычёркивания, которые игрок уже сделал в заметках, молча применяются к рабочему состоянию и
 *    пропускаются; поиск идёт дальше (после них могут открыться singles).
 * 5. Ничего не применимо → `none` (`beyond` либо `solved`).
 *
 * Решение для `mistake` берётся из `solution` либо из `givens`. Это «оракул», допустимый только для явной
 * подсказки (помощь помечает день); первая ступень выдаёт только дом.
 *
 * Чистая функция: входные данные не меняются. @throws {RangeError} на неверную форму входа,
 * `values`, не содержащий подсказки `givens`, несогласованное с `givens` решение, `lastCell` вне 0..80.
 */
export function nextHint(state: HintState): Hint {
  const givens = toBytes(state.givens);
  const values = toBytes(state.values);
  for (let c = 0; c < 81; c++) {
    if (givens[c] !== 0 && values[c] !== givens[c]) {
      throw new RangeError(`values[${c}] differs from the given ${givens[c]}`);
    }
  }
  const notes = state.notes;
  checkNotes(notes);
  const last = state.lastCell;
  if (last !== undefined) assertCell(last);

  let solution: Uint8Array;
  if (state.solution !== undefined) {
    solution = toBytes(state.solution);
    for (let c = 0; c < 81; c++) {
      if (solution[c] === 0 || (givens[c] !== 0 && givens[c] !== solution[c])) {
        throw new RangeError("solution must be complete and agree with givens");
      }
    }
    if (countSolutionsBytes(solution, 1) !== 1) throw new RangeError("solution has conflicts");
  } else {
    if (countSolutionsBytes(givens, 2) !== 1) return { kind: "none", reason: "invalid_puzzle" };
    solution = solveBytes(givens)!;
  }

  const wrong: Cell[] = [];
  let empty = 0;
  for (let c = 0; c < 81; c++) {
    if (values[c] === 0) empty++;
    else if (values[c] !== solution[c]) wrong.push(c);
  }
  if (wrong.length > 0) return mistakeHint(values, wrong, last);
  if (empty === 0) return { kind: "none", reason: "solved" };

  const w = initWork(values);
  for (let guard = 0; guard < 2000; guard++) {
    let restart = false;
    for (let tier = 0; tier < ENUMERATORS.length; tier++) {
      const raws = ENUMERATORS[tier]!(w);
      if (raws.length === 0) continue;
      if (tier < FIRST_ELIMINATION_TIER) return buildStep(w, pickBest(raws, last), undefined, last);
      const open: { raw: Raw; remaining: Elimination[] }[] = [];
      for (const raw of raws) {
        const remaining = raw.eliminations!.filter((e) => !reflected(notes, e));
        if (remaining.length === 0) {
          applyRaw(w, raw);
          restart = true;
        } else open.push({ raw, remaining });
      }
      if (restart) break;
      const best = pickBest(
        open.map((o) => o.raw),
        last,
      );
      return buildStep(w, best, open.find((o) => o.raw === best)!.remaining, last);
    }
    if (!restart) break;
  }
  return { kind: "none", reason: "beyond" };
}
