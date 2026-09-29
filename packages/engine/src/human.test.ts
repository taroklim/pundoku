import { describe, expect, it } from "vitest";
import {
  TECHNIQUE_ORDER,
  countSolutions,
  formatGrid,
  humanSolve,
  parseGrid,
  rateDifficulty,
  solve,
  techniqueForCell,
  techniqueTier,
  techniquesUsed,
} from "./index.js";
import type { GridInput, Step } from "./index.js";

/** Project Euler #96, сетка 01 — решается одними naked singles. */
const PE96_1 = "003020600900305001001806400008102900700000008006708200002609500800203009005010300";

/**
 * Проверяет логическую корректность шага против настоящего решения и перебором:
 * постановка совпадает с решением; каждое вычёркивание (cell, d) обосновано — сетка с
 * cell = d решений не имеет.
 */
function assertSound(state: GridInput, step: Step): void {
  const grid = [...parseGrid(formatGrid(state))];
  const solution = solve(grid)!;
  if (step.cell !== undefined) expect(solution[step.cell]).toBe(step.digit);
  for (const e of step.eliminations ?? []) {
    expect(solution[e.cell]).not.toBe(e.digit);
    const probe = [...grid];
    probe[e.cell] = e.digit;
    expect(countSolutions(probe, 1)).toBe(0);
  }
}

describe("singles", () => {
  it("naked single: a cell with one candidate left", () => {
    // Строка 1: 1..8 стоят, девятой клетке остаётся 9.
    const g = "123456780" + "0".repeat(72);
    const res = humanSolve(g, { maxTechnique: "naked_single" });
    expect(res.steps[0]).toMatchObject({ technique: "naked_single", cell: 8, digit: 9 });
    expect(res.grid[8]).toBe(9);
  });

  it("hidden single: digit has one place in a unit even though the cell has more candidates", () => {
    // 5 стоит в строках 2 и 3 (вне блока 1) и в столбцах 2 и 3 → в блоке 1 5 только в r1c1.
    const g = [...Array<number>(81).fill(0)];
    g[9 + 4] = 5; // r2c5
    g[18 + 7] = 5; // r3c8
    g[27 + 1] = 5; // r4c2
    g[36 + 2] = 5; // r5c3
    const res = humanSolve(g as never, { maxTechnique: "hidden_single" });
    const first = res.steps[0]!;
    expect(first).toMatchObject({ technique: "hidden_single", cell: 0, digit: 5 });
    expect(first.explanation).toContain("box 1");
  });

  it("PE96 #1 is solved with naked singles only", () => {
    const res = humanSolve(PE96_1);
    expect(res.solved).toBe(true);
    expect(res.contradiction).toBe(false);
    expect(new Set(res.steps.map((s) => s.technique))).toEqual(new Set(["naked_single"]));
    expect(formatGrid(res.grid)).toBe(formatGrid(solve(PE96_1)!));
    expect(rateDifficulty(PE96_1)).toBe("easy");
    expect(techniquesUsed(PE96_1)).toEqual(["naked_single"]);
  });
});

/**
 * Состояния сеток после исчерпания singles (получены генератором на фиксированных seed,
 * проверены вручную): первый же шаг решателя — ожидаемая техника с ожидаемым эффектом.
 */
describe("locked candidates", () => {
  it("pointing (box → row): 9 in box 2 confined to row 3, eliminated from r3c3", () => {
    const state = "500286017786100902210000865657023180008010006102678500461890003875360091020001608";
    const step = humanSolve(state).steps[0]!;
    expect(step).toMatchObject({
      technique: "locked_candidates",
      eliminations: [{ cell: 20, digit: 9 }],
      cells: [21, 23],
    });
    expect(step.explanation).toMatch(/^Pointing: 9 in box 2 is confined to row 3/);
    assertSound(state, step);
  });

  it("pointing (box → column): 1 in box 3 confined to column 8", () => {
    const state = "050418000036207800000306700571640000000572001000180000008735060000820500205960000";
    const step = humanSolve(state).steps[0]!;
    expect(step).toMatchObject({
      technique: "locked_candidates",
      eliminations: [
        { cell: 70, digit: 1 },
        { cell: 79, digit: 1 },
      ],
      cells: [16, 25],
    });
    assertSound(state, step);
  });

  it("claiming (line → box): candidates of a digit in a row all inside one box", () => {
    // Конструкция: в строке 1 цифра 7 возможна только в r1c1..r1c3 (блок 1) → из
    // остальных клеток блока 1 семёрку можно вычеркнуть.
    const g = [...Array<number>(81).fill(0)];
    // Заполняем r1c4..r1c9 цифрами, среди них нет 7: 1 2 3 4 5 6.
    [1, 2, 3, 4, 5, 6].forEach((d, i) => (g[3 + i] = d));
    // Чтобы не появились singles, добавим 7 в столбцы 4..9 не нужно — они уже заняты в строке 1.
    const res = humanSolve(g as never, { maxTechnique: "locked_candidates" });
    const claiming = res.steps.find((s) => s.explanation?.startsWith("Claiming: 7 in row 1"));
    expect(claiming).toBeDefined();
    expect(claiming!.technique).toBe("locked_candidates");
    // Вычёркивается 7 из клеток блока 1 вне строки 1: r2c1..r2c3, r3c1..r3c3.
    expect(claiming!.eliminations!.map((e) => e.cell).sort((a, b) => a - b)).toEqual([9, 10, 11, 18, 19, 20]);
    expect(claiming!.eliminations!.every((e) => e.digit === 7)).toBe(true);
  });
});

describe("pairs", () => {
  it("naked pair 35 in row 5 eliminates 3/5 from the rest of the row", () => {
    const state = "870040600140060080693020500014050070706094100008170406469537821521489060387010900";
    const step = humanSolve(state).steps[0]!;
    expect(step).toMatchObject({
      technique: "naked_pair",
      cells: [37, 43],
      eliminations: [
        { cell: 39, digit: 3 },
        { cell: 44, digit: 3 },
        { cell: 44, digit: 5 },
      ],
    });
    expect(step.explanation).toBe("Naked pair 35 in r5c2,r5c8 (row 5)");
    assertSound(state, step);
  });

  it("hidden pair 16 in column 1 strips other candidates from the two cells", () => {
    const state = "897126354001008006060007000906432010345871692010965400000053047000714060000089000";
    const step = humanSolve(state).steps[0]!;
    expect(step).toMatchObject({
      technique: "hidden_pair",
      cells: [54, 72],
      eliminations: [
        { cell: 54, digit: 2 },
        { cell: 72, digit: 2 },
        { cell: 72, digit: 4 },
        { cell: 72, digit: 5 },
        { cell: 72, digit: 7 },
      ],
    });
    expect(step.explanation).toBe("Hidden pair 16 in r7c1,r9c1 (column 1)");
    assertSound(state, step);
  });

  it("maxTechnique below the needed one leaves the solver stuck", () => {
    const state = "870040600140060080693020500014050070706094100008170406469537821521489060387010900";
    const res = humanSolve(state, { maxTechnique: "locked_candidates" });
    expect(res.solved).toBe(false);
    expect(res.contradiction).toBe(false);
    expect(humanSolve(state).solved).toBe(true);
  });
});

describe("every step of a full human solve is sound", () => {
  const missions = [
    "000089100002100000000050370005043000090600002000008934720090003000000080006005090", // hard
    "830901020000850030001070000005300600000549070400000800602000080000000005190000300", // expert
  ];
  for (const mission of missions) {
    it(`replays ${mission.slice(0, 12)}…`, () => {
      const solution = solve(mission)!;
      const res = humanSolve(mission);
      // Постановки совпадают с решением, вычёркивания никогда не трогают цифру решения.
      for (const s of res.steps) {
        if (s.cell !== undefined) expect(solution[s.cell]).toBe(s.digit);
        for (const e of s.eliminations ?? []) expect(solution[e.cell]).not.toBe(e.digit);
        expect(TECHNIQUE_ORDER).toContain(s.technique);
      }
      for (let c = 0; c < 81; c++) if (res.grid[c] !== 0) expect(res.grid[c]).toBe(solution[c]);
    });
  }
});

describe("rateDifficulty", () => {
  it("classifies reference puzzles", () => {
    expect(rateDifficulty("104708500025030704087009020050060070270300019009017000503072001700150000608003250")).toBe("easy");
    expect(rateDifficulty("400600370000010020200000054030900401891400532040100000054001007107050000000300000")).toBe("medium");
    expect(rateDifficulty("000089100002100000000050370005043000090600002000008934720090003000000080006005090")).toBe("hard");
    expect(rateDifficulty("830901020000850030001070000005300600000549070400000800602000080000000005190000300")).toBe("expert");
  });

  it("a solved grid is easy; a contradictory one is expert (solver cannot proceed)", () => {
    expect(rateDifficulty(solve(PE96_1)!)).toBe("easy");
    const bad = [...parseGrid(PE96_1)];
    bad[0] = 3; // 3 уже есть в строке 1 → противоречие
    expect(humanSolve(bad).contradiction).toBe(true);
    expect(rateDifficulty(bad)).toBe("expert");
  });
});

describe("techniqueForCell", () => {
  it("returns the cheapest tier that derives the cell", () => {
    expect(techniqueForCell("123456780" + "0".repeat(72), 8)).toBe("naked_single");
    // PE96 #1: каждая пустая клетка выводится одними naked singles.
    const g = parseGrid(PE96_1);
    for (let c = 0; c < 81; c++) if (g[c] === 0) expect(techniqueForCell(PE96_1, c)).toBe("naked_single");
  });

  it("is 'beyond' when the cell needs more than the implemented techniques", () => {
    const expert = "830901020000850030001070000005300600000549070400000800602000080000000005190000300";
    const res = humanSolve(expert);
    expect(res.solved).toBe(false);
    const stuck = res.grid.findIndex((v) => v === 0);
    expect(techniqueForCell(expert, stuck)).toBe("beyond");
  });

  it("treats an already-filled cell as if it were empty", () => {
    const filled = [...parseGrid("123456780" + "0".repeat(72))];
    filled[8] = 9;
    expect(techniqueForCell(filled, 8)).toBe("naked_single");
  });

  it("escalates monotonically: tier of the technique is never below a single", () => {
    const hard = "000089100002100000000050370005043000090600002000008934720090003000000080006005090";
    const tiers = new Set<number>();
    for (let c = 0; c < 81; c++) if (hard[c] === "0") tiers.add(techniqueTier(techniqueForCell(hard, c)));
    // Hard-сетка: часть клеток — singles, часть требует locked candidates / пар.
    expect([...tiers].some((t) => t >= 2)).toBe(true);
    expect([...tiers].some((t) => t <= 1)).toBe(true);
    expect(tiers.has(TECHNIQUE_ORDER.length)).toBe(false);
  });
});
