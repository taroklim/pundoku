/**
 * PD-304: X-Wing/Swordfish в решателе, класс expert_plus, опция `noXWing`.
 * Тяжёлый прогон ≥ 200 сеток `noXWing` — `noxwing.heavy.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { FISH_BASES, FISH_BASE_CLUES } from "./fish-corpus.js";
import {
  DIFFICULTIES,
  Rng,
  difficultyForTechnique,
  techniqueForCell,
  countSolutions,
  dailyPuzzle,
  formatGrid,
  generate,
  humanSolve,
  rateDifficulty,
  solve,
  techniquesUsed,
} from "./index.js";
import { randomIsomorph } from "./symmetry.js";
import type { Grid, Step } from "./types.js";

const CLUES_OF = (mission: string) => mission.split("").filter((ch) => ch !== "0").length;
const FISH = ["x_wing", "swordfish"] as const;
const usesFish = (mission: string) => techniquesUsed(mission).some((t) => (FISH as readonly string[]).includes(t));

/** Снапшот expert_plus: сетка из корпуса под симметрией, детерминирована seed'ом (как снапшоты generator.test.ts). */
const EXPERT_PLUS_SNAPSHOT = {
  seed: "2026-09-29",
  mission: "030700080009000050000509007000800000060000200043005006000907400004000008270010300",
  daily: "090000800006073001007200000000100000039007002040080500800000000070014208500000070",
};

/** Строки ↔ столбцы. */
const transpose = (m: string) => Array.from({ length: 81 }, (_, i) => m[(i % 9) * 9 + Math.floor(i / 9)]).join("");
const rowOf = (c: number) => Math.floor(c / 9);
const colOf = (c: number) => c % 9;

/**
 * Геометрия базовой рыбы размера n: клетки шаблона лежат в n базовых линиях и n покрывающих (объединение), все
 * вычёркивания — одна цифра, в покрывающих линиях и вне базовых. Возвращает ориентацию базы.
 */
function assertFish(step: Step, n: number, solution: Grid): "rows" | "columns" {
  const cells = step.cells!;
  const elims = step.eliminations!;
  expect(elims.length).toBeGreaterThan(0);
  const digit = elims[0]!.digit;
  const rows = new Set(cells.map(rowOf));
  const cols = new Set(cells.map(colOf));
  expect(rows.size).toBe(n);
  expect(cols.size).toBe(n);
  const byRows = elims.every((e) => cols.has(colOf(e.cell)) && !rows.has(rowOf(e.cell)));
  const byCols = elims.every((e) => rows.has(rowOf(e.cell)) && !cols.has(colOf(e.cell)));
  expect(byRows !== byCols).toBe(true);
  for (const e of elims) {
    expect(e.digit).toBe(digit);
    expect(solution[e.cell]).not.toBe(digit); // вычёркивание корректно
  }
  // В базовых линиях цифра решения стоит именно в клетках шаблона.
  for (const line of byRows ? rows : cols) {
    const where = Array.from({ length: 9 }, (_, k) => (byRows ? line * 9 + k : k * 9 + line)).filter((c) => solution[c] === digit);
    expect(where).toHaveLength(1);
    expect(cells).toContain(where[0]);
  }
  return byRows ? "rows" : "columns";
}

describe("X-Wing / Swordfish in the human solver (PD-304)", () => {
  // Из корпуса expert_plus: единственная рыба на пути решателя — X-Wing по 6 в строках 5, 8 (столбцы 3, 9).
  const XW = "003910500408000000001060000000000005090020070500700018000000037240001050000086000";
  // Swordfish по 4 в строках 3, 6, 9 (столбцы 1, 2, 9); X-Wing этой сетке не помогает.
  const SF = "850704090000050407000200006000907000508000010009080000000060000600001005003008700";

  it("X-Wing in rows: pairs get stuck, X-Wing eliminates 6 from r6c3 and r7c3, then the grid is solved", () => {
    const solution = solve(XW)!;
    const capped = humanSolve(XW, { maxTechnique: "hidden_pair" });
    expect(capped.solved).toBe(false);
    expect(capped.contradiction).toBe(false);
    const res = humanSolve(XW);
    expect(res.solved).toBe(true);
    const fish = res.steps.filter((s) => s.technique === "x_wing" || s.technique === "swordfish");
    expect(fish).toHaveLength(1);
    const xw = fish[0]!;
    expect(xw.technique).toBe("x_wing");
    expect(assertFish(xw, 2, solution)).toBe("rows");
    expect([...xw.cells!].sort((a, b) => a - b)).toEqual([38, 44, 65, 71]);
    expect(xw.eliminations).toEqual([
      { cell: 47, digit: 6 },
      { cell: 56, digit: 6 },
    ]);
    expect(xw.explanation).toBe("X-Wing: 6 in rows 5,8 is confined to columns 3,9");
    expect(humanSolve(XW, { maxTechnique: "x_wing" }).solved).toBe(true);
    expect(rateDifficulty(XW)).toBe("expert_plus");
  });

  it("X-Wing in columns: the transposed grid needs the same X-Wing with rows and columns swapped", () => {
    const t = transpose(XW);
    const solution = solve(t)!;
    expect(humanSolve(t, { maxTechnique: "hidden_pair" }).solved).toBe(false);
    const res = humanSolve(t);
    expect(res.solved).toBe(true);
    const xw = res.steps.find((s) => s.technique === "x_wing")!;
    expect(assertFish(xw, 2, solution)).toBe("columns");
    expect([...xw.cells!].sort((a, b) => a - b)).toEqual([22, 25, 76, 79]);
    expect(xw.eliminations).toEqual([
      { cell: 23, digit: 6 },
      { cell: 24, digit: 6 },
    ]);
    expect(xw.explanation).toBe("X-Wing: 6 in columns 5,8 is confined to rows 3,9");
  });

  it("Swordfish: X-Wing is not enough, Swordfish on 4 in rows 3,6,9 is", () => {
    const solution = solve(SF)!;
    expect(humanSolve(SF, { maxTechnique: "x_wing" }).solved).toBe(false);
    const res = humanSolve(SF);
    expect(res.solved).toBe(true);
    const sf = res.steps.find((s) => s.technique === "swordfish")!;
    expect(assertFish(sf, 3, solution)).toBe("rows");
    expect(sf.explanation).toBe("Swordfish: 4 in rows 3,6,9 is confined to columns 1,2,9");
    expect(res.steps.some((s) => s.technique === "x_wing")).toBe(false);
    expect(rateDifficulty(SF)).toBe("expert_plus");
    expect(difficultyForTechnique("x_wing")).toBe("expert_plus");
    expect(difficultyForTechnique("swordfish")).toBe("expert_plus");
  });

  it("every step on every corpus base is sound; every fish step has fish geometry", () => {
    for (const m of FISH_BASES) {
      const solution = solve(m)!;
      const res = humanSolve(m);
      expect(res.solved, m).toBe(true);
      for (const s of res.steps) {
        if (s.cell !== undefined) expect(solution[s.cell]).toBe(s.digit);
        for (const e of s.eliminations ?? []) expect(solution[e.cell], m).not.toBe(e.digit);
        if (s.technique === "x_wing") assertFish(s, 2, solution);
        if (s.technique === "swordfish") assertFish(s, 3, solution);
      }
    }
  }, 120_000);

  it("techniqueForCell can now answer x_wing/swordfish instead of 'beyond'", () => {
    const tiers = new Set<string>();
    for (let c = 0; c < 81; c++) if (XW[c] === "0") tiers.add(techniqueForCell(XW, c));
    expect(tiers.has("x_wing")).toBe(true);
    expect(tiers.has("beyond")).toBe(false);
  });
});

describe("expert_plus: needs X-Wing/Swordfish, no backtracking (PD-304)", () => {
  it("snapshot: same seed → same grid; dailyPuzzle uses the daily seed", () => {
    const a = generate({ difficulty: "expert_plus", seed: EXPERT_PLUS_SNAPSHOT.seed });
    expect(a.mission).toBe(EXPERT_PLUS_SNAPSHOT.mission);
    expect(generate({ difficulty: "expert_plus", seed: EXPERT_PLUS_SNAPSHOT.seed })).toEqual(a);
    expect(dailyPuzzle("2026-11-08", "expert_plus").mission).toBe(EXPERT_PLUS_SNAPSHOT.daily);
  });

  it("a sample of 60 seeds: unique, 24 clues, fish required (pairs are not enough), solved without 'beyond'", () => {
    const missions = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const p = generate({ difficulty: "expert_plus", seed: `fish-sample-${i}` });
      missions.add(p.mission);
      expect(countSolutions(p.mission), p.mission).toBe(1);
      expect(formatGrid(solve(p.mission)!)).toBe(p.solution);
      expect(CLUES_OF(p.mission)).toBe(24);
      expect(humanSolve(p.mission, { maxTechnique: "hidden_pair" }).solved, p.mission).toBe(false);
      expect(humanSolve(p.mission).solved, p.mission).toBe(true);
      expect(p.techniques).not.toContain("beyond");
      expect(p.techniques.some((t) => (FISH as readonly string[]).includes(t)), p.mission).toBe(true);
      expect(rateDifficulty(p.mission)).toBe("expert_plus");
    }
    expect(missions.size).toBe(60);
  }, 120_000);

  it("master now means: stuck even with fish (needs something stronger or backtracking)", () => {
    for (let i = 0; i < 20; i++) {
      const p = generate({ difficulty: "master", seed: `fish-master-${i}` });
      expect(humanSolve(p.mission).solved, p.mission).toBe(false);
      expect(p.techniques.at(-1)).toBe("beyond");
      expect(rateDifficulty(p.mission)).toBe("master");
    }
  }, 120_000);
});

describe("fish corpus (base grids of expert_plus)", () => {
  it("every base: 24 clues, unique solution, rated expert_plus; no duplicates", () => {
    expect(FISH_BASES.length).toBeGreaterThanOrEqual(200);
    expect(new Set(FISH_BASES).size).toBe(FISH_BASES.length);
    for (const m of FISH_BASES) {
      expect(m).toMatch(/^[0-9]{81}$/);
      expect(CLUES_OF(m)).toBe(FISH_BASE_CLUES);
      expect(countSolutions(m), m).toBe(1);
      expect(rateDifficulty(m), m).toBe("expert_plus");
    }
  }, 120_000);

  it("symmetries keep uniqueness and the technique band (5 random isomorphs of every base)", () => {
    const rng = new Rng("symmetry-check");
    for (const m of FISH_BASES) {
      for (let k = 0; k < 5; k++) {
        const iso = Array.from(randomIsomorph(rng, Uint8Array.from(m, (ch) => Number(ch)))).join("");
        expect(countSolutions(iso), iso).toBe(1);
        expect(rateDifficulty(iso), iso).toBe("expert_plus");
      }
    }
  }, 120_000);
});

describe("generate({ noXWing }) (PD-304)", () => {
  it("easy..expert: the same grid as without the option (classes are already capped below X-Wing)", () => {
    for (const difficulty of ["easy", "medium", "hard", "expert"] as const) {
      for (const seed of ["2026-09-29", "pundoku", "noxw-1", "noxw-2"]) {
        expect(generate({ difficulty, seed, noXWing: true }), `${difficulty}/${seed}`).toEqual(generate({ difficulty, seed }));
      }
    }
    expect(generate({ difficulty: "expert", seed: "x", noXWing: false })).toEqual(generate({ difficulty: "expert", seed: "x" }));
  }, 120_000);

  it("expert_plus and master require X-Wing or beyond → RangeError; non-boolean → RangeError", () => {
    for (const difficulty of ["expert_plus", "master"] as const) {
      expect(() => generate({ difficulty, seed: "x", noXWing: true })).toThrow(RangeError);
      expect(() => generate({ difficulty, seed: "x", noXWing: true })).toThrow(/noXWing/);
    }
    for (const bad of [null, 1, "true", {}]) {
      expect(() => generate({ difficulty: "expert", seed: "x", noXWing: bad as never }), String(bad)).toThrow(RangeError);
    }
  });

  it("existing classes never need fish (spot check over all classes but expert_plus/master)", () => {
    for (const difficulty of DIFFICULTIES.filter((d) => d !== "expert_plus" && d !== "master")) {
      for (let i = 0; i < 5; i++) {
        const p = generate({ difficulty, seed: `nofish-${i}`, noXWing: true });
        expect(usesFish(p.mission), `${difficulty}: ${p.mission}`).toBe(false);
        expect(humanSolve(p.mission, { maxTechnique: "hidden_pair" }).solved).toBe(true);
      }
    }
  }, 120_000);
});
