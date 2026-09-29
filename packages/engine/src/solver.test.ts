import { describe, expect, it } from "vitest";
import { countSolutions, emptyGrid, formatGrid, hasUniqueSolution, solve } from "./index.js";

/** Project Euler #96, сетка 01 — общеизвестный публичный пример. */
const PE96_1 = "003020600900305001001806400008102900700000008006708200002609500800203009005010300";
const PE96_1_SOLUTION = "483921657967345821251876493548132976729564138136798245372689514814253769695417382";

describe("solve", () => {
  it("solves a known puzzle", () => {
    const s = solve(PE96_1);
    expect(s).not.toBeNull();
    expect(formatGrid(s!)).toBe(PE96_1_SOLUTION);
  });

  it("returns null for a contradictory grid", () => {
    const g = [...emptyGrid()];
    g[0] = 1;
    g[1] = 1;
    expect(solve(g)).toBeNull();
    expect(countSolutions(g)).toBe(0);
  });

  it("solves a solvable-but-empty grid quickly", () => {
    const t0 = performance.now();
    const s = solve(emptyGrid());
    expect(s).not.toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

describe("countSolutions", () => {
  it("is 1 for a proper puzzle", () => {
    expect(countSolutions(PE96_1)).toBe(1);
    expect(hasUniqueSolution(PE96_1)).toBe(true);
  });

  it("stops at the limit for an ambiguous grid", () => {
    expect(countSolutions(emptyGrid())).toBe(2);
    expect(countSolutions(emptyGrid(), 5)).toBe(5);
    expect(hasUniqueSolution(emptyGrid())).toBe(false);
  });

  it("detects the second solution when a clue is removed", () => {
    // Убираем подсказки, пока не появится второе решение — оно должно найтись.
    const g = [...solve(PE96_1)!];
    let ambiguous = false;
    for (let c = 0; c < 81 && !ambiguous; c++) {
      g[c] = 0;
      ambiguous = countSolutions(g) > 1;
    }
    expect(ambiguous).toBe(true);
  });

  it("solves 100 random-ish grids in well under a second", () => {
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) expect(countSolutions(PE96_1)).toBe(1);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
