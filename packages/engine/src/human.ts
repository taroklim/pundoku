/**
 * Human-style решатель: применяет техники от дешёвой к дорогой и логирует каждый шаг.
 *
 * Техники реализованы по их общеизвестному описанию (см. README, «Лицензии»); код
 * HoDoKu/Sudoku Explainer (GPL) не использовался.
 *
 * Внутреннее состояние — значения клеток (`vals`) и битовые маски кандидатов (`cands`,
 * бит d = цифра d). Любая техника либо ставит цифру, либо вычёркивает кандидатов; шаг
 * считается найденным только если он реально что-то меняет.
 */
import {
  BOX_OF,
  COL_OF,
  PEERS,
  ROW_OF,
  UNITS,
  assertCell,
  bytesToGrid,
  maskToDigits,
  maskToSingleDigit,
  peerMask,
  popcount,
  toBytes,
} from "./grid.js";
import { EASY_MIN_CLUES } from "./difficulty.js";
import type {
  Cell,
  Difficulty,
  Digit,
  Elimination,
  GridInput,
  HumanSolveResult,
  Step,
  Technique,
  TechniqueOrBeyond,
} from "./types.js";

/** Техники в порядке применения (дешёвая первой). Индекс = «ярус» техники. */
export const TECHNIQUE_ORDER: readonly Technique[] = [
  "naked_single",
  "hidden_single",
  "locked_candidates",
  "naked_pair",
  "hidden_pair",
];

/** Ярус техники: 0..4 для реализованных, 5 для `'beyond'`. */
export function techniqueTier(t: TechniqueOrBeyond): number {
  if (t === "beyond") return TECHNIQUE_ORDER.length;
  const i = TECHNIQUE_ORDER.indexOf(t);
  if (i < 0) throw new RangeError(`Unknown technique ${String(t)}`);
  return i;
}

/**
 * Сложность только по технической оси: singles → easy, locked → hard, pairs → expert,
 * beyond → master. Класс `medium` этой осью недостижим (это singles-сетка с малым числом
 * подсказок) — итоговая оценка по двум осям — `rateDifficulty`.
 */
export function difficultyForTechnique(t: TechniqueOrBeyond): Difficulty {
  switch (t) {
    case "naked_single":
    case "hidden_single":
      return "easy";
    case "locked_candidates":
      return "hard";
    case "naked_pair":
    case "hidden_pair":
      return "expert";
    case "beyond":
      return "master";
  }
}

/** Самая дорогая техника из списка (null для пустого). */
export function maxTechnique(list: readonly TechniqueOrBeyond[]): TechniqueOrBeyond | null {
  let best: TechniqueOrBeyond | null = null;
  for (const t of list) if (best === null || techniqueTier(t) > techniqueTier(best)) best = t;
  return best;
}

interface State {
  vals: Uint8Array;
  cands: Uint16Array;
  empty: number;
  contradiction: boolean;
  steps: Step[];
}

function initState(bytes: Uint8Array): State {
  const vals = Uint8Array.from(bytes);
  const cands = new Uint16Array(81);
  let empty = 0;
  let contradiction = false;
  for (let c = 0; c < 81; c++) {
    if (vals[c] !== 0) continue;
    empty++;
    const m = peerMask(vals, c);
    cands[c] = m;
    if (m === 0) contradiction = true;
  }
  return { vals, cands, empty, contradiction, steps: [] };
}

function place(st: State, cell: Cell, d: Digit): void {
  st.vals[cell] = d;
  st.cands[cell] = 0;
  st.empty--;
  const bit = 1 << d;
  const peers = PEERS[cell]!;
  for (let i = 0; i < 20; i++) {
    const p = peers[i]!;
    if (st.vals[p] !== 0) continue;
    const m = st.cands[p]! & ~bit;
    st.cands[p] = m;
    if (m === 0) st.contradiction = true;
  }
}

function eliminate(st: State, cell: Cell, d: Digit): void {
  const m = st.cands[cell]! & ~(1 << d);
  st.cands[cell] = m;
  if (m === 0) st.contradiction = true;
}

function rc(cell: Cell): string {
  return `r${ROW_OF[cell]! + 1}c${COL_OF[cell]! + 1}`;
}

function unitName(u: number): string {
  if (u < 9) return `row ${u + 1}`;
  if (u < 18) return `column ${u - 9 + 1}`;
  return `box ${u - 18 + 1}`;
}

function findNakedSingle(st: State): Step | null {
  for (let c = 0; c < 81; c++) {
    if (st.vals[c] !== 0) continue;
    const d = maskToSingleDigit(st.cands[c]!);
    if (d === 0) continue;
    place(st, c, d);
    return {
      technique: "naked_single",
      cell: c,
      digit: d,
      explanation: `${rc(c)} has only one candidate: ${d}`,
    };
  }
  return null;
}

function findHiddenSingle(st: State): Step | null {
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let where = -1;
      let count = 0;
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        if (st.cands[c]! & bit) {
          count++;
          where = c;
          if (count > 1) break;
        }
      }
      if (count === 1) {
        place(st, where, d as Digit);
        return {
          technique: "hidden_single",
          cell: where,
          digit: d as Digit,
          explanation: `${d} can only go in ${rc(where)} within ${unitName(u)}`,
        };
      }
    }
  }
  return null;
}

/**
 * Locked candidates.
 * Pointing: все кандидаты цифры в блоке лежат в одной строке/столбце → вне блока в этой
 * линии цифру можно вычеркнуть. Claiming: все кандидаты цифры в строке/столбце лежат в
 * одном блоке → в остальных клетках блока цифру можно вычеркнуть.
 */
function findLockedCandidates(st: State): Step | null {
  // Pointing: блок → линия.
  for (let b = 0; b < 9; b++) {
    const unit = UNITS[18 + b]!;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let rows = 0;
      let cols = 0;
      let count = 0;
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        if (st.cands[c]! & bit) {
          count++;
          rows |= 1 << ROW_OF[c]!;
          cols |= 1 << COL_OF[c]!;
        }
      }
      if (count < 2) continue;
      if ((rows & (rows - 1)) === 0) {
        const r = 31 - Math.clz32(rows);
        const step = lockedEliminate(st, d as Digit, UNITS[r]!, (c) => BOX_OF[c] !== b, unit, bit);
        if (step) return { ...step, explanation: `Pointing: ${d} in box ${b + 1} is confined to row ${r + 1}` };
      }
      if ((cols & (cols - 1)) === 0) {
        const col = 31 - Math.clz32(cols);
        const step = lockedEliminate(st, d as Digit, UNITS[9 + col]!, (c) => BOX_OF[c] !== b, unit, bit);
        if (step) return { ...step, explanation: `Pointing: ${d} in box ${b + 1} is confined to column ${col + 1}` };
      }
    }
  }
  // Claiming: линия → блок.
  for (let u = 0; u < 18; u++) {
    const unit = UNITS[u]!;
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << d;
      let boxes = 0;
      let count = 0;
      for (let i = 0; i < 9; i++) {
        const c = unit[i]!;
        if (st.cands[c]! & bit) {
          count++;
          boxes |= 1 << BOX_OF[c]!;
        }
      }
      if (count < 2 || (boxes & (boxes - 1)) !== 0) continue;
      const b = 31 - Math.clz32(boxes);
      const inLine = u < 9 ? (c: Cell) => ROW_OF[c] !== u : (c: Cell) => COL_OF[c] !== u - 9;
      const step = lockedEliminate(st, d as Digit, UNITS[18 + b]!, inLine, unit, bit);
      if (step) return { ...step, explanation: `Claiming: ${d} in ${unitName(u)} is confined to box ${b + 1}` };
    }
  }
  return null;
}

function lockedEliminate(
  st: State,
  d: Digit,
  target: Uint8Array,
  outside: (c: Cell) => boolean,
  source: Uint8Array,
  bit: number,
): Step | null {
  const eliminations: Elimination[] = [];
  for (let i = 0; i < 9; i++) {
    const c = target[i]!;
    if (outside(c) && st.cands[c]! & bit) eliminations.push({ cell: c, digit: d });
  }
  if (eliminations.length === 0) return null;
  for (const e of eliminations) eliminate(st, e.cell, e.digit);
  const cells: Cell[] = [];
  for (let i = 0; i < 9; i++) {
    const c = source[i]!;
    if (st.cands[c]! & bit) cells.push(c);
  }
  return { technique: "locked_candidates", eliminations, cells };
}

/** Naked pair: две клетки юнита с одинаковой парой кандидатов → эти цифры вычёркиваются из остальных клеток юнита. */
function findNakedPair(st: State): Step | null {
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    for (let i = 0; i < 9; i++) {
      const a = unit[i]!;
      const ma = st.cands[a]!;
      if (ma === 0 || popcount(ma) !== 2) continue;
      for (let j = i + 1; j < 9; j++) {
        const b = unit[j]!;
        if (st.cands[b] !== ma) continue;
        const eliminations: Elimination[] = [];
        for (let k = 0; k < 9; k++) {
          const c = unit[k]!;
          if (c === a || c === b) continue;
          const hit = st.cands[c]! & ma;
          if (hit) for (const d of maskToDigits(hit)) eliminations.push({ cell: c, digit: d });
        }
        if (eliminations.length === 0) continue;
        for (const e of eliminations) eliminate(st, e.cell, e.digit);
        const [d1, d2] = maskToDigits(ma);
        return {
          technique: "naked_pair",
          eliminations,
          cells: [a, b],
          explanation: `Naked pair ${d1}${d2} in ${rc(a)},${rc(b)} (${unitName(u)})`,
        };
      }
    }
  }
  return null;
}

/** Hidden pair: две цифры юнита возможны только в одних и тех же двух клетках → прочие кандидаты этих клеток вычёркиваются. */
function findHiddenPair(st: State): Step | null {
  const pos = new Uint16Array(10);
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    pos.fill(0);
    for (let i = 0; i < 9; i++) {
      const m = st.cands[unit[i]!]!;
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
          const extra = st.cands[c]! & ~pairMask;
          if (extra) for (const d of maskToDigits(extra)) eliminations.push({ cell: c, digit: d });
        }
        if (eliminations.length === 0) continue;
        for (const e of eliminations) eliminate(st, e.cell, e.digit);
        return {
          technique: "hidden_pair",
          eliminations,
          cells,
          explanation: `Hidden pair ${d1}${d2} in ${rc(cells[0]!)},${rc(cells[1]!)} (${unitName(u)})`,
        };
      }
    }
  }
  return null;
}

const FINDERS: readonly ((st: State) => Step | null)[] = [
  findNakedSingle,
  findHiddenSingle,
  findLockedCandidates,
  findNakedPair,
  findHiddenPair,
];

/**
 * Применяет техники ярусов ≤ maxTier до фикс-точки (решено, застряли или противоречие).
 * Возвращает максимальный использованный ярус (-1, если шагов не было).
 */
function run(st: State, maxTier: number): number {
  let used = -1;
  while (!st.contradiction && st.empty > 0) {
    let step: Step | null = null;
    let tier = 0;
    for (; tier <= maxTier; tier++) {
      step = FINDERS[tier]!(st);
      if (step) break;
    }
    if (!step) break;
    st.steps.push(step);
    if (tier > used) used = tier;
  }
  return used;
}

/**
 * Внутреннее (Лжец, PD-172): вычёркивания техниками ярусов 2..maxTier (locked candidates, пары) до
 * фикс-точки — без постановок цифр. Меняет `cands` на месте; `vals` только читается. Останавливается
 * на первой клетке без кандидатов. Возвращает максимальный ярус, который что-то вычеркнул (-1 — ничего).
 */
export function eliminateToFixpoint(vals: Uint8Array, cands: Uint16Array, maxTier: number): number {
  let empty = 0;
  for (let c = 0; c < 81; c++) if (vals[c] === 0) empty++;
  const st: State = { vals, cands, empty, contradiction: false, steps: [] };
  let used = -1;
  for (;;) {
    let tier = 2;
    for (; tier <= maxTier; tier++) if (FINDERS[tier]!(st)) break;
    if (tier > maxTier) return used;
    if (tier > used) used = tier;
    if (st.contradiction) return used;
  }
}

/**
 * Внутреннее (для генератора): ярус самой дорогой техники, нужной сетке, при решателе,
 * ограниченном ярусами ≤ maxTier. `TECHNIQUE_ORDER.length` — застрял или противоречие.
 */
export function ratingTierBytes(bytes: Uint8Array, maxTier: number = TECHNIQUE_ORDER.length - 1): number {
  const st = initState(bytes);
  if (st.contradiction) return TECHNIQUE_ORDER.length;
  const used = run(st, maxTier);
  if (st.contradiction || st.empty > 0) return TECHNIQUE_ORDER.length;
  return Math.max(used, 0);
}

export interface HumanSolveOptions {
  /** Ограничить решатель техниками не дороже этой (по умолчанию — все реализованные). */
  readonly maxTechnique?: Technique;
}

/**
 * Решает сетку человеческими техниками, логируя каждый шаг. `solved === false` — решатель
 * застрял (нужна техника сверх реализованных) либо сетка противоречива.
 */
export function humanSolve(grid: GridInput, options: HumanSolveOptions = {}): HumanSolveResult {
  const st = initState(toBytes(grid));
  const maxTier = options.maxTechnique ? techniqueTier(options.maxTechnique) : TECHNIQUE_ORDER.length - 1;
  if (!st.contradiction) run(st, maxTier);
  return {
    solved: !st.contradiction && st.empty === 0,
    steps: st.steps,
    grid: bytesToGrid(st.vals),
    contradiction: st.contradiction,
  };
}

/**
 * Минимальная техника, которой клетка выводится в текущем состоянии сетки.
 *
 * Ярусы техник подключаются по очереди: если клетка заполняется одними naked singles
 * (возможно, после цепочки других singles) — `naked_single`; если для этого нужны ещё
 * hidden singles — `hidden_single`; и т. д. `'beyond'` — реализованных техник не хватает.
 * Если клетка уже заполнена, оценка делается так, как если бы она была пустой (удобно
 * вызывать и до, и после хода игрока).
 */
export function techniqueForCell(grid: GridInput, cell: Cell): TechniqueOrBeyond {
  assertCell(cell);
  const bytes = toBytes(grid);
  bytes[cell] = 0;
  const st = initState(bytes);
  if (st.contradiction) return "beyond";
  for (let tier = 0; tier < TECHNIQUE_ORDER.length; tier++) {
    run(st, tier);
    if (st.contradiction) return "beyond";
    if (st.vals[cell] !== 0) return TECHNIQUE_ORDER[tier]!;
  }
  return "beyond";
}

/** Техники, понадобившиеся human-style решателю (в порядке первого применения); `'beyond'` последним, если застрял. */
export function techniquesUsed(grid: GridInput): TechniqueOrBeyond[] {
  const res = humanSolve(grid);
  const out: TechniqueOrBeyond[] = [];
  for (const s of res.steps) if (!out.includes(s.technique)) out.push(s.technique);
  if (!res.solved) out.push("beyond");
  return out;
}

/**
 * Оценка сложности сетки по двум осям (см. `difficulty.ts`, README «Как определяется сложность»):
 * техника решает всё, начиная с locked candidates — locked → hard, pairs → expert, решатель застрял
 * (или сетка противоречива) → master; если хватает singles, решает число подсказок: ≥ 34 → easy,
 * иначе medium.
 */
export function rateDifficulty(mission: GridInput): Difficulty {
  const bytes = toBytes(mission);
  const tier = ratingTierBytes(bytes);
  if (tier > 1) return difficultyForTechnique(tier === TECHNIQUE_ORDER.length ? "beyond" : TECHNIQUE_ORDER[tier]!);
  let clues = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) clues++;
  return clues >= EASY_MIN_CLUES ? "easy" : "medium";
}
