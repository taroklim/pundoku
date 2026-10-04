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
  humanSolve,
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
  // 2. Строгая однозначность — поштучно, без таблицы покрытия.
  for (let c = 0; c < 81; c++) {
    if (c === L || mission[c] === "0") continue;
    if (countSolutions(withCell(mission, c, 0), 1) !== 0) fail(`removing honest clue ${c} gives a solution`);
  }
  // 4а. Не видно на старте (включая два сингла одной цифры в юните — PD-172).
  if (conflicts(mission).length !== 0) fail("visible duplicate");
  const why = visibleNow(toCells(mission));
  if (why !== null) fail(`visible at start: ${why}`);
  // 4б. Противоречие выводимо в пределах потолка класса (human-решатель упирается в клетку без кандидатов).
  if (!humanSolve(mission, { maxTechnique: CEILING[difficulty] }).contradiction) {
    fail("human solver within the class ceiling does not reach a contradiction");
  }
  // 4в. Порог — по всем порядкам синглов (вычёркивания потолка только приближают противоречие, так что
  // глубина для singles-игрока — верхняя граница глубины критерия; проверяем её ≥ порога независимо).
  const minDepth = LIAR_MIN_DEPTH[difficulty];
  if (p.meta.minDepth !== minDepth) fail(`meta.minDepth ${p.meta.minDepth} != ${minDepth}`);
  if (p.meta.contradictionDepth < minDepth) fail(`meta depth ${p.meta.contradictionDepth} < ${minDepth}`);
  const early = minDepth > 0 ? earliestWithin(toCells(mission), minDepth - 1) : null;
  if (early !== null) fail(`some order of singles shows the contradiction after ${early} placements (< ${minDepth})`);
  const rng = new Rng(`random-orders\0${mission}`);
  for (let r = 0; r < RANDOM_ORDERS; r++) {
    const d = randomOrderDepth(toCells(mission), rng);
    if (d !== null && d < minDepth) fail(`random order of singles: contradiction after ${d} placements (< ${minDepth})`);
  }
  // Валидатор согласен.
  const v = validateLiar(mission, { difficulty });
  if (!v.honest) fail(`validateLiar: ${v.failures.join(",")}`);
  if (v.liarCell !== L || v.solution !== solution) fail("validateLiar found another liar/solution");
  if (v.suspects.length !== 1) fail("validateLiar suspects != [liar]");
  if (v.contradictionDepth !== p.meta.contradictionDepth) fail("validateLiar depth != meta");
}

// ---------------------------------------------------------------------------------------------
// Независимая модель «видимого противоречия» и игроков-синглистов (PD-172). Своя геометрия и свои кандидаты —
// ни одной функции из liar.ts/human.ts.

const RANDOM_ORDERS = 6;
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

export const toCells = (m: string): number[] => m.split("").map(Number);

function cellCandidates(g: readonly number[], c: number): Set<number> {
  const out = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (const u of UNITS_OF[c]!) for (const x of UNIT_CELLS[u]!) if (x !== c) out.delete(g[x]!);
  return out;
}

/** Вынужденные синглы: naked (один кандидат) и hidden (единственное место цифры в юните) — пары [клетка, цифра]. */
export function forcedSingles(g: readonly number[]): [number, number][] {
  const cands = g.map((v, c) => (v === 0 ? cellCandidates(g, c) : new Set<number>()));
  const out = new Map<string, [number, number]>();
  for (let c = 0; c < 81; c++) if (g[c] === 0 && cands[c]!.size === 1) out.set(`${c}:${[...cands[c]!][0]}`, [c, [...cands[c]!][0]!]);
  for (const cells of UNIT_CELLS) {
    for (let d = 1; d <= 9; d++) {
      const where = cells.filter((c) => g[c] === 0 && cands[c]!.has(d));
      if (where.length === 1) out.set(`${where[0]}:${d}`, [where[0]!, d]);
    }
  }
  return [...out.values()];
}

/** Видимое противоречие (null — нет): повтор, клетка без кандидатов, цифре негде стоять, конфликт синглов. */
export function visibleNow(g: readonly number[]): string | null {
  for (const cells of UNIT_CELLS) {
    const vals = cells.map((c) => g[c]!).filter((v) => v !== 0);
    if (new Set(vals).size !== vals.length) return "duplicate";
  }
  for (let c = 0; c < 81; c++) if (g[c] === 0 && cellCandidates(g, c).size === 0) return `no candidates at ${c}`;
  for (const cells of UNIT_CELLS) {
    for (let d = 1; d <= 9; d++) {
      if (cells.some((c) => g[c] === d)) continue;
      if (!cells.some((c) => g[c] === 0 && cellCandidates(g, c).has(d))) return `no place for ${d}`;
    }
  }
  const forced = forcedSingles(g);
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

/**
 * Полный перебор порядков синглов глубины ≤ k (без мемоизации): минимальное число постановок, после которого
 * противоречие видно, если оно ≤ k; иначе null.
 */
export function earliestWithin(g: number[], k: number): number | null {
  if (visibleNow(g) !== null) return 0;
  if (k <= 0) return null;
  let best: number | null = null;
  for (const [c, d] of forcedSingles(g)) {
    g[c] = d;
    const r = earliestWithin(g, (best === null ? k : best - 1) - 1);
    g[c] = 0;
    if (r !== null) best = r + 1;
    if (best === 1) break;
  }
  return best;
}

/** Случайный игрок-синглист: постановок до видимого противоречия; null — застрял/решил без противоречия. */
export function randomOrderDepth(g: number[], rng: Rng): number | null {
  for (let placed = 0; ; placed++) {
    if (visibleNow(g) !== null) return placed;
    const f = forcedSingles(g);
    if (f.length === 0) return null;
    const [c, d] = f[rng.int(f.length)]!;
    g[c] = d;
  }
}

