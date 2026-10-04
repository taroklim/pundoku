/**
 * Тестовая утилита (не входит в сборку — `tsconfig.build.json` исключает `*.test-util.ts`): независимая
 * проверка сгенерированного Лжеца по критерию честности. Не использует таблицу покрытия генератора —
 * только `countSolutions` по каждой подсказке, `conflicts`/`candidates`, `humanSolve`.
 */
import {
  DIFFICULTY_PROFILES,
  LIAR_MIN_DEPTH_RATIO,
  candidates,
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
  // 4а. Не видно на старте.
  if (conflicts(mission).length !== 0) fail("visible duplicate");
  for (let c = 0; c < 81; c++) if (mission[c] === "0" && candidates(mission, c).length === 0) fail(`no candidates at ${c}`);
  // 4б/в. Противоречие выводимо в пределах потолка класса и не раньше порога.
  const res = humanSolve(mission, { maxTechnique: CEILING[difficulty] });
  if (!res.contradiction) fail("human solver within the class ceiling does not reach a contradiction");
  const depth = res.steps.filter((s) => s.cell !== undefined).length;
  const minDepth = Math.ceil(LIAR_MIN_DEPTH_RATIO * (81 - clueCount(honestMission)));
  if (p.meta.minDepth !== minDepth) fail(`meta.minDepth ${p.meta.minDepth} != ${minDepth}`);
  if (depth !== p.meta.contradictionDepth) fail(`depth ${depth} != meta ${p.meta.contradictionDepth}`);
  if (depth < minDepth) fail(`too shallow: ${depth} < ${minDepth}`);
  // Валидатор согласен.
  const v = validateLiar(mission, { difficulty });
  if (!v.honest) fail(`validateLiar: ${v.failures.join(",")}`);
  if (v.liarCell !== L || v.solution !== solution) fail("validateLiar found another liar/solution");
  if (v.suspects.length !== 1) fail("validateLiar suspects != [liar]");
}

