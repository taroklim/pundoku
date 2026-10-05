/**
 * Тестовая утилита (не входит в сборку — `tsconfig.build.json` исключает `*.test-util.ts`): независимая
 * проверка сгенерированного Лжеца по критерию честности. Не использует таблицу покрытия генератора —
 * только `countSolutions` по каждой подсказке, `conflicts`/`candidates`, `humanSolve`.
 */
import {
  DIFFICULTY_PROFILES,
  LIAR_MIN_DEPTH,
  Rng,
  conflicts,
  countSolutions,
  formatGrid,
  rateDifficulty,
  solve,
  validateLiar,
} from "./index.js";
import type { Difficulty, LiarPuzzle, Technique } from "./index.js";

export const clueCount = (m: string): number => m.split("").filter((ch) => ch !== "0").length;
export const withCell = (m: string, cell: number, v: number): string => m.slice(0, cell) + String(v) + m.slice(cell + 1);
export const CEILING: Record<Difficulty, Technique> = {
  easy: "hidden_single",
  medium: "hidden_single",
  hard: "locked_candidates",
  expert: "hidden_pair",
  master: "hidden_pair",
};
/** Ярус потолка класса в независимой модели: 1 — синглы, 2 — + locked candidates, 4 — + naked/hidden pairs. */
export const TIER: Record<Difficulty, number> = { easy: 1, medium: 1, hard: 2, expert: 4, master: 4 };

/** Полная независимая проверка сгенерированного Лжеца. Бросает с понятным сообщением. */
export function assertHonestLiar(p: LiarPuzzle): void {
  const { mission, honestMission, solution, liarCell: L, liarDigit, trueDigit, difficulty } = p;
  const fail = (why: string): never => {
    throw new Error(`${difficulty}/${p.seed}: ${why}\n${mission}`);
  };
  // Форма: ложь — ровно одна лишняя подсказка поверх честной сетки.
  for (let c = 0; c < 81; c++) {
    if (c === L) continue;
    if (mission[c] !== honestMission[c]) fail(`mission differs from honestMission at ${c}`);
  }
  if (honestMission[L] !== "0") fail("liar cell is not empty in honestMission");
  if (mission[L] !== String(liarDigit)) fail("mission[liarCell] != liarDigit");
  if (solution[L] !== String(trueDigit)) fail("solution[liarCell] != trueDigit");
  if (liarDigit === trueDigit) fail("lie equals the truth");
  if (formatGrid(p.givens) !== mission) fail("givens != mission");
  // Класс честной сетки — ровно профиль обычного генератора.
  if (clueCount(honestMission) !== DIFFICULTY_PROFILES[difficulty].clues) fail("honest clue count != profile");
  if (clueCount(mission) !== DIFFICULTY_PROFILES[difficulty].clues + 1) fail("liar clue count != profile + 1");
  if (rateDifficulty(honestMission) !== difficulty) fail("honest puzzle rated outside the class");
  // 1. Опровержимость.
  if (countSolutions(mission) !== 0) fail("full grid has a solution");
  // 3. Доразрешимость.
  if (countSolutions(honestMission) !== 1) fail("honest grid not unique");
  if (formatGrid(solve(honestMission)!) !== solution) fail("solution mismatch");
  // 2. Однозначность (PD-174, отчёт 05) — поштучно, без таблицы покрытия: ни одна честная подсказка не даёт
  // единственного решения при удалении (0 или ≥ 2 — можно), лжец — даёт.
  if (countSolutions(withCell(mission, L, 0), 2) !== 1) fail("removing the liar does not give a unique solution");
  for (let c = 0; c < 81; c++) {
    if (c === L || mission[c] === "0") continue;
    if (countSolutions(withCell(mission, c, 0), 2) === 1) fail(`removing honest clue ${c} gives a unique solution`);
  }
  // 4а. Не видно на старте техниками потолка класса без постановок (PD-174; синглы — включая два сингла одной
  // цифры в юните, PD-172).
  const tier = TIER[difficulty];
  if (conflicts(mission).length !== 0) fail("visible duplicate");
  const why = visibleNow(toCells(mission), tier);
  if (why !== null) fail(`visible at start: ${why}`);
  // 4б. Противоречие выводимо в пределах потолка класса: своя «волна» (все вынужденные синглы разом + вычёркивания
  // потолка) доходит до видимого противоречия, а не застревает. (Human-решатель для этого не годится: он ставит по
  // одной цифре и может застрять на «цифре негде стоять», не получив клетку без кандидатов.)
  if (waveReaches(toCells(mission), tier) === null) fail("no visible contradiction is reachable within the class ceiling");
  // 4в. Порог — по всем порядкам ходов: синглы + вычёркивания потолка класса после каждой постановки (своя модель,
  // полный перебор до порога с дедупликацией по состоянию) и случайные порядки.
  const minDepth = LIAR_MIN_DEPTH[difficulty];
  if (p.meta.minDepth !== minDepth) fail(`meta.minDepth ${p.meta.minDepth} != ${minDepth}`);
  if (p.meta.contradictionDepth < minDepth) fail(`meta depth ${p.meta.contradictionDepth} < ${minDepth}`);
  const early = minDepth > 0 ? earliestWithin(toCells(mission), minDepth - 1, tier) : null;
  if (early !== null) fail(`some order of moves shows the contradiction after ${early} placements (< ${minDepth})`);
  const rng = new Rng(`random-orders\0${mission}`);
  for (let r = 0; r < RANDOM_ORDERS; r++) {
    const d = randomOrderDepth(toCells(mission), rng, tier);
    if (d !== null && d < minDepth) fail(`random order of moves: contradiction after ${d} placements (< ${minDepth})`);
  }
  // Валидатор согласен.
  const v = validateLiar(mission, { difficulty });
  if (!v.honest) fail(`validateLiar: ${v.failures.join(",")}`);
  if (v.liarCell !== L || v.solution !== solution) fail("validateLiar found another liar/solution");
  if (v.suspects.length !== 1) fail("validateLiar suspects != [liar]");
  if (v.contradictionDepth !== p.meta.contradictionDepth) fail("validateLiar depth != meta");
}

// ---------------------------------------------------------------------------------------------
// Независимая модель «видимого противоречия» и игроков (PD-172, PD-174). Своя геометрия, свои кандидаты и свои
// вычёркивания (locked candidates, naked/hidden pairs — по общеизвестным описаниям) — ни одной функции из
// liar.ts/human.ts. Ярус: 1 — только синглы, 2 — + pointing/claiming, 3 — + naked pair, 4 — + hidden pair.

const RANDOM_ORDERS = 6;
/** Потолок состояний на уровень перебора — защита теста от взрыва (бросает, а не молча занижает). */
const LEVEL_LIMIT = 200_000;
const ALL = 0b1111111110;
const UNIT_CELLS: number[][] = (() => {
  const u: number[][] = [];
  for (let r = 0; r < 9; r++) u.push(Array.from({ length: 9 }, (_, i) => r * 9 + i));
  for (let c = 0; c < 9; c++) u.push(Array.from({ length: 9 }, (_, i) => i * 9 + c));
  for (let b = 0; b < 9; b++) {
    const r0 = Math.floor(b / 3) * 3;
    const c0 = (b % 3) * 3;
    u.push(Array.from({ length: 9 }, (_, i) => (r0 + Math.floor(i / 3)) * 9 + c0 + (i % 3)));
  }
  return u;
})();
const UNITS_OF: number[][] = Array.from({ length: 81 }, (_, c) => UNIT_CELLS.flatMap((cells, u) => (cells.includes(c) ? [u] : [])));
const PEERS_OF: number[][] = Array.from({ length: 81 }, (_, c) => [
  ...new Set(UNITS_OF[c]!.flatMap((u) => UNIT_CELLS[u]!).filter((x) => x !== c)),
]);
const rowOf = (c: number) => Math.floor(c / 9);
const colOf = (c: number) => c % 9;
const boxOf = (c: number) => Math.floor(rowOf(c) / 3) * 3 + Math.floor(colOf(c) / 3);
const bits = (m: number): number[] => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => m & (1 << d));

export const toCells = (m: string): number[] => m.split("").map(Number);

/** Состояние игрока: значения и кандидаты (маска битов 1..9 на клетку; у заполненных — 0). */
interface St {
  readonly g: number[];
  readonly k: number[];
}

function fromGrid(g: readonly number[]): St {
  const k = g.map((v, c) => {
    if (v !== 0) return 0;
    let m = ALL;
    for (const x of PEERS_OF[c]!) if (g[x] !== 0) m &= ~(1 << g[x]!);
    return m;
  });
  return { g: [...g], k };
}

function place(st: St, c: number, d: number): St {
  const g = [...st.g];
  const k = [...st.k];
  g[c] = d;
  k[c] = 0;
  for (const x of PEERS_OF[c]!) if (g[x] === 0) k[x] = k[x]! & ~(1 << d);
  return { g, k };
}

/** Вычёркивания яруса ≥ 2 до фикс-точки (на месте). */
function eliminate(st: St, tier: number): void {
  const { g, k } = st;
  const remove = (cells: number[], mask: number): boolean => {
    let changed = false;
    for (const x of cells) if (g[x] === 0 && k[x]! & mask) {
      k[x] = k[x]! & ~mask;
      changed = true;
    }
    return changed;
  };
  for (let changed = true; changed; ) {
    changed = false;
    if (tier >= 2) {
      for (const cells of UNIT_CELLS) {
        for (let d = 1; d <= 9; d++) {
          const where = cells.filter((c) => g[c] === 0 && k[c]! & (1 << d));
          if (where.length < 2) continue;
          // Pointing/claiming: все места цифры в юните лежат в одном пересекающем юните — вычеркнуть в остальной его части.
          for (const key of [rowOf, colOf, boxOf]) {
            const v = key(where[0]!);
            if (!where.every((c) => key(c) === v)) continue;
            const other = UNIT_CELLS.find((u) => u !== cells && u.every((c) => key(c) === v) && where.every((c) => u.includes(c)));
            if (other) changed = remove(other.filter((c) => !cells.includes(c)), 1 << d) || changed;
          }
        }
      }
    }
    if (tier >= 3) {
      for (const cells of UNIT_CELLS) {
        const empty = cells.filter((c) => g[c] === 0);
        for (const a of empty) {
          if (bits(k[a]!).length !== 2) continue;
          const b = empty.find((x) => x !== a && k[x] === k[a]);
          if (b !== undefined) changed = remove(empty.filter((x) => x !== a && x !== b), k[a]!) || changed;
        }
      }
    }
    if (tier >= 4) {
      for (const cells of UNIT_CELLS) {
        for (let d1 = 1; d1 <= 9; d1++) {
          for (let d2 = d1 + 1; d2 <= 9; d2++) {
            const w1 = cells.filter((c) => g[c] === 0 && k[c]! & (1 << d1));
            const w2 = cells.filter((c) => g[c] === 0 && k[c]! & (1 << d2));
            if (w1.length !== 2 || w2.length !== 2 || w1[0] !== w2[0] || w1[1] !== w2[1]) continue;
            const keep = (1 << d1) | (1 << d2);
            for (const c of w1) if (k[c]! & ~keep) {
              k[c] = k[c]! & keep;
              changed = true;
            }
          }
        }
      }
    }
  }
}

/** Вынужденные синглы состояния: naked (один кандидат) и hidden (единственное место цифры в юните). */
function forcedOf(st: St): [number, number][] {
  const out = new Map<string, [number, number]>();
  for (let c = 0; c < 81; c++) if (st.g[c] === 0 && bits(st.k[c]!).length === 1) out.set(`${c}:${bits(st.k[c]!)[0]}`, [c, bits(st.k[c]!)[0]!]);
  for (const cells of UNIT_CELLS) {
    for (let d = 1; d <= 9; d++) {
      if (cells.some((c) => st.g[c] === d)) continue;
      const where = cells.filter((c) => st.g[c] === 0 && st.k[c]! & (1 << d));
      if (where.length === 1) out.set(`${where[0]}:${d}`, [where[0]!, d]);
    }
  }
  return [...out.values()];
}

/** Видимое противоречие состояния (null — нет): повтор, клетка без кандидатов, цифре негде стоять, конфликт синглов. */
function visibleIn(st: St): string | null {
  const { g, k } = st;
  for (const cells of UNIT_CELLS) {
    const vals = cells.map((c) => g[c]!).filter((v) => v !== 0);
    if (new Set(vals).size !== vals.length) return "duplicate";
  }
  for (let c = 0; c < 81; c++) if (g[c] === 0 && k[c] === 0) return `no candidates at ${c}`;
  for (const cells of UNIT_CELLS) {
    for (let d = 1; d <= 9; d++) {
      if (cells.some((c) => g[c] === d)) continue;
      if (!cells.some((c) => g[c] === 0 && k[c]! & (1 << d))) return `no place for ${d}`;
    }
  }
  const forced = forcedOf(st);
  for (const [c, d] of forced) {
    for (const [c2, d2] of forced) {
      if (c === c2 && d !== d2) return `cell ${c} forced to ${d} and ${d2}`;
      if (c !== c2 && d === d2 && UNITS_OF[c]!.some((u) => UNITS_OF[c2]!.includes(u))) {
        return `two singles of ${d} in one unit (${c}, ${c2})`;
      }
    }
  }
  return null;
}

/** Видимое противоречие на старте при вычёркиваниях яруса `tier` без постановок (null — нет). */
export function visibleNow(g: readonly number[], tier = 1): string | null {
  const st = fromGrid(g);
  if (tier >= 2) eliminate(st, tier);
  return visibleIn(st);
}

/** Вынужденные синглы сетки (без вычёркиваний). */
export function forcedSingles(g: readonly number[]): [number, number][] {
  return forcedOf(fromGrid(g));
}

/**
 * Полный перебор порядков ходов глубины ≤ k (BFS по множествам поставленных синглов, после каждой постановки —
 * вычёркивания яруса `tier`): минимальное число постановок, после которого противоречие видно, если оно ≤ k; иначе null.
 */
export function earliestWithin(g: number[], k: number, tier = 1): number | null {
  let level: St[] = [fromGrid(g)];
  for (let depth = 0; depth <= k; depth++) {
    const next: St[] = [];
    const seen = new Set<string>();
    for (const st of level) {
      if (tier >= 2) eliminate(st, tier);
      if (visibleIn(st) !== null) return depth;
      if (depth === k) continue;
      for (const [c, d] of forcedOf(st)) {
        const nx = place(st, c, d);
        const key = nx.g.join("");
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(nx);
      }
    }
    if (next.length > LEVEL_LIMIT) throw new Error(`earliestWithin: level ${depth + 1} has ${next.length} states`);
    if (next.length === 0) return null;
    level = next;
  }
  return null;
}

/** Волна: все вынужденные синглы разом + вычёркивания яруса `tier`; число волн до видимого противоречия, null — застряли. */
export function waveReaches(g: number[], tier = 1): number | null {
  let st = fromGrid(g);
  for (let wave = 0; ; wave++) {
    if (tier >= 2) eliminate(st, tier);
    if (visibleIn(st) !== null) return wave;
    const f = forcedOf(st);
    if (f.length === 0) return null;
    for (const [c, d] of f) st = place(st, c, d);
  }
}

/** Случайный игрок (синглы + вычёркивания яруса `tier`): постановок до видимого противоречия; null — застрял/решил. */
export function randomOrderDepth(g: number[], rng: Rng, tier = 1): number | null {
  let st = fromGrid(g);
  for (let placed = 0; ; placed++) {
    if (tier >= 2) eliminate(st, tier);
    if (visibleIn(st) !== null) return placed;
    const f = forcedOf(st);
    if (f.length === 0) return null;
    const [c, d] = f[rng.int(f.length)]!;
    st = place(st, c, d);
  }
}
