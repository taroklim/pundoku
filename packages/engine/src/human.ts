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
  "x_wing",
  "swordfish",
];

/**
 * Ярус техники: 0..6 для реализованных, `TECHNIQUE_ORDER.length` (7) для `'beyond'`. Рыбы (X-Wing 5, Swordfish 6)
 * добавлены в PD-304 в конец порядка — ярусы 0..4 прежние, поэтому решатель с потолком ≤ hidden_pair ведёт себя
 * байт-в-байт как раньше (сетки easy..expert и Лжец не меняются).
 */
export function techniqueTier(t: TechniqueOrBeyond): number {
  if (t === "beyond") return TECHNIQUE_ORDER.length;
  const i = TECHNIQUE_ORDER.indexOf(t);
  if (i < 0) throw new RangeError(`Unknown technique ${String(t)}`);
  return i;
}

/**
 * Сложность только по технической оси: singles → easy, locked → hard, pairs → expert,
 * X-Wing/Swordfish → expert_plus, beyond → master. Класс `medium` этой осью недостижим (это singles-сетка
 * с малым числом подсказок) — итоговая оценка по двум осям — `rateDifficulty`.
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
    case "x_wing":
    case "swordfish":
      return "expert_plus";
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
/** Рабочий буфер `findLockedCandidates`: позиции цифры d в юните u — маска индексов 0..8 (`u * 10 + d`). */
const LOCKED_POS = new Uint16Array(27 * 10);
/** Маски индексов юнита по тройкам 0–2, 3–5, 6–8 (строка блока / блок линии) и по столбцам блока. */
const TRIPLES = [0b000000111, 0b000111000, 0b111000000] as const;
const BOX_COLS = [0b001001001, 0b010010010, 0b100100100] as const;

/** Индекс тройки, содержащей все биты `p` (p ≠ 0), иначе -1. */
function confinedTo(p: number, masks: readonly number[]): number {
  for (let g = 0; g < 3; g++) if ((p & ~masks[g]!) === 0) return g;
  return -1;
}

function findLockedCandidates(st: State): Step | null {
  // Позиции кандидатов по юнитам — один проход. Порядок поиска и первый найденный шаг — те же, что у прежнего
  // перебора по клеткам (PD-174: только скорость; логи шагов и сетки генератора побайтно совпадают).
  const pos = LOCKED_POS;
  pos.fill(0);
  for (let u = 0; u < 27; u++) {
    const unit = UNITS[u]!;
    for (let i = 0; i < 9; i++) {
      let m = st.cands[unit[i]!]!;
      while (m !== 0) {
        const low = m & -m;
        const k = u * 10 + (31 - Math.clz32(low));
        pos[k] = pos[k]! | (1 << i);
        m ^= low;
      }
    }
  }
  // Pointing: блок → линия.
  for (let b = 0; b < 9; b++) {
    const unit = UNITS[18 + b]!;
    for (let d = 1; d <= 9; d++) {
      const p = pos[(18 + b) * 10 + d]!;
      if (p === 0 || (p & (p - 1)) === 0) continue; // меньше двух мест
      const bit = 1 << d;
      const rg = confinedTo(p, TRIPLES);
      if (rg >= 0) {
        const r = Math.floor(b / 3) * 3 + rg;
        const step = lockedEliminate(st, d as Digit, UNITS[r]!, (c) => BOX_OF[c] !== b, unit, bit);
        if (step) return { ...step, explanation: `Pointing: ${d} in box ${b + 1} is confined to row ${r + 1}` };
      }
      const cg = confinedTo(p, BOX_COLS);
      if (cg >= 0) {
        const col = (b % 3) * 3 + cg;
        const step = lockedEliminate(st, d as Digit, UNITS[9 + col]!, (c) => BOX_OF[c] !== b, unit, bit);
        if (step) return { ...step, explanation: `Pointing: ${d} in box ${b + 1} is confined to column ${col + 1}` };
      }
    }
  }
  // Claiming: линия → блок.
  for (let u = 0; u < 18; u++) {
    const unit = UNITS[u]!;
    for (let d = 1; d <= 9; d++) {
      const p = pos[u * 10 + d]!;
      if (p === 0 || (p & (p - 1)) === 0) continue; // меньше двух мест
      const g = confinedTo(p, TRIPLES);
      if (g < 0) continue;
      const bit = 1 << d;
      const b = u < 9 ? Math.floor(u / 3) * 3 + g : g * 3 + Math.floor((u - 9) / 3);
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
  let any = false;
  for (let i = 0; i < 9 && !any; i++) {
    const c = target[i]!;
    any = outside(c) && (st.cands[c]! & bit) !== 0;
  }
  if (!any) return null;
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

/** Рабочий буфер `findFish`: позиции цифры d в линии (0..8 строки, 9..17 столбцы) — маска индексов 0..8 (`line * 10 + d`). */
const FISH_POS = new Uint16Array(18 * 10);
/** Рабочий буфер `findFish`: базовые линии-кандидаты одной цифры одной ориентации. */
const FISH_BASE = new Uint8Array(9);

/**
 * Базовая рыба размера `size` (2 — X-Wing, 3 — Swordfish), реализация по общеизвестному описанию техники.
 * Цифра d в `size` строках (базовые линии) стоит только в `size` столбцах (покрывающие линии): в каждой базовой
 * строке её кандидатов 2..size, а объединение их столбцов — ровно `size` столбцов. Тогда d в этих столбцах
 * обязана стоять в базовых строках → в остальных клетках покрывающих столбцов d вычёркивается. То же со сменой
 * ролей строк и столбцов. Порядок поиска: цифра 1..9, строки-база, затем столбцы-база, сочетания линий
 * лексикографически; шаг засчитывается, только если что-то вычеркнул.
 */
function findFish(st: State, size: 2 | 3): Step | null {
  const pos = FISH_POS;
  pos.fill(0);
  for (let line = 0; line < 18; line++) {
    const unit = UNITS[line]!;
    for (let i = 0; i < 9; i++) {
      let m = st.cands[unit[i]!]!;
      while (m !== 0) {
        const low = m & -m;
        const k = line * 10 + (31 - Math.clz32(low));
        pos[k] = pos[k]! | (1 << i);
        m ^= low;
      }
    }
  }
  const base = FISH_BASE;
  for (let d = 1; d <= 9; d++) {
    for (let orient = 0; orient < 2; orient++) {
      const off = orient * 9; // база: строки (0) или столбцы (9); покрывающие линии — другая ориентация
      let nb = 0;
      for (let k = 0; k < 9; k++) {
        const pc = popcount(pos[(off + k) * 10 + d]!);
        if (pc >= 2 && pc <= size) base[nb++] = k;
      }
      if (nb < size) continue;
      for (let a = 0; a < nb; a++) {
        const ma = pos[(off + base[a]!) * 10 + d]!;
        for (let b = a + 1; b < nb; b++) {
          const mab = ma | pos[(off + base[b]!) * 10 + d]!;
          if (size === 2) {
            if (popcount(mab) !== 2) continue;
            const step = fishEliminate(st, d as Digit, orient, [base[a]!, base[b]!], mab);
            if (step) return step;
            continue;
          }
          if (popcount(mab) > 3) continue;
          for (let c = b + 1; c < nb; c++) {
            const mabc = mab | pos[(off + base[c]!) * 10 + d]!;
            if (popcount(mabc) !== 3) continue;
            const step = fishEliminate(st, d as Digit, orient, [base[a]!, base[b]!, base[c]!], mabc);
            if (step) return step;
          }
        }
      }
    }
  }
  return null;
}

/** Клетка на пересечении базовой линии `k` и покрывающей `j` (orient 0 — база строки, 1 — база столбцы). */
function fishCell(orient: number, k: number, j: number): Cell {
  return orient === 0 ? k * 9 + j : j * 9 + k;
}

function fishEliminate(st: State, d: Digit, orient: number, lines: readonly number[], cover: number): Step | null {
  const bit = 1 << d;
  const eliminations: Elimination[] = [];
  const covers: number[] = [];
  for (let j = 0; j < 9; j++) {
    if ((cover & (1 << j)) === 0) continue;
    covers.push(j);
    for (let k = 0; k < 9; k++) {
      if (lines.includes(k)) continue;
      const c = fishCell(orient, k, j);
      if (st.cands[c]! & bit) eliminations.push({ cell: c, digit: d });
    }
  }
  if (eliminations.length === 0) return null;
  const cells: Cell[] = [];
  for (const k of lines) {
    for (const j of covers) {
      const c = fishCell(orient, k, j);
      if (st.cands[c]! & bit) cells.push(c);
    }
  }
  for (const e of eliminations) eliminate(st, e.cell, e.digit);
  const technique: Technique = lines.length === 2 ? "x_wing" : "swordfish";
  const name = lines.length === 2 ? "X-Wing" : "Swordfish";
  const [baseName, coverName] = orient === 0 ? ["rows", "columns"] : ["columns", "rows"];
  const list = (xs: readonly number[]) => xs.map((x) => x + 1).join(",");
  return {
    technique,
    eliminations,
    cells,
    explanation: `${name}: ${d} in ${baseName} ${list(lines)} is confined to ${coverName} ${list(covers)}`,
  };
}

const findXWing = (st: State): Step | null => findFish(st, 2);
const findSwordfish = (st: State): Step | null => findFish(st, 3);

const FINDERS: readonly ((st: State) => Step | null)[] = [
  findNakedSingle,
  findHiddenSingle,
  findLockedCandidates,
  findNakedPair,
  findHiddenPair,
  findXWing,
  findSwordfish,
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
 * Внутреннее (Лжец, PD-172): вычёркивания техниками ярусов 2..maxTier (locked candidates, пары; рыбы при maxTier ≥ 5 —
 * Лжец их не передаёт, его потолок — hidden_pair, см. `LIAR_MAX_TIER`) до
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
 * техника решает всё, начиная с locked candidates — locked → hard, pairs → expert, X-Wing/Swordfish →
 * expert_plus, решатель застрял (или сетка противоречива) → master; если хватает singles, решает число
 * подсказок: ≥ 34 → easy, иначе medium.
 */
export function rateDifficulty(mission: GridInput): Difficulty {
  const bytes = toBytes(mission);
  const tier = ratingTierBytes(bytes);
  if (tier > 1) return difficultyForTechnique(tier === TECHNIQUE_ORDER.length ? "beyond" : TECHNIQUE_ORDER[tier]!);
  let clues = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) clues++;
  return clues >= EASY_MIN_CLUES ? "easy" : "medium";
}
