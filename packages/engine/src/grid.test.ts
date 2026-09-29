import { describe, expect, it } from "vitest";
import {
  BOX_OF,
  GRID_SIZE,
  PEERS,
  UNITS,
  candidates,
  conflicts,
  emptyGrid,
  formatGrid,
  isValidGrid,
  parseGrid,
} from "./index.js";

const PE96_1 = "003020600900305001001806400008102900700000008006708200002609500800203009005010300";

describe("grid geometry", () => {
  it("has 27 units of 9 cells and 20 peers per cell", () => {
    expect(UNITS).toHaveLength(27);
    for (const u of UNITS) expect(u).toHaveLength(9);
    for (let c = 0; c < GRID_SIZE; c++) expect(PEERS[c]).toHaveLength(20);
    expect(BOX_OF[0]).toBe(0);
    expect(BOX_OF[40]).toBe(4);
    expect(BOX_OF[80]).toBe(8);
  });
});

describe("parseGrid / formatGrid", () => {
  it("round-trips a mission string", () => {
    expect(formatGrid(parseGrid(PE96_1))).toBe(PE96_1);
  });

  it("accepts dots as empties", () => {
    const dotted = PE96_1.replaceAll("0", ".");
    expect(formatGrid(parseGrid(dotted))).toBe(PE96_1);
  });

  it("rejects wrong length and bad chars", () => {
    expect(() => parseGrid("123")).toThrow(RangeError);
    expect(() => parseGrid("x".repeat(81))).toThrow(RangeError);
  });

  it("emptyGrid is 81 zeros", () => {
    const g = emptyGrid();
    expect(g).toHaveLength(GRID_SIZE);
    expect(g.every((v) => v === 0)).toBe(true);
  });
});

describe("validation", () => {
  it("valid mission has no conflicts", () => {
    expect(conflicts(PE96_1)).toEqual([]);
    expect(isValidGrid(PE96_1)).toBe(true);
    expect(isValidGrid(emptyGrid())).toBe(true);
  });

  it("reports both cells of a duplicate in a row, column and box", () => {
    const g = [...emptyGrid()];
    g[0] = 5;
    g[8] = 5; // строка
    g[72] = 5; // столбец
    g[10] = 5; // блок
    expect(conflicts(g)).toEqual([0, 8, 10, 72]);
    expect(isValidGrid(g)).toBe(false);
  });

  it("isValidGrid is false for malformed input instead of throwing", () => {
    expect(isValidGrid("123")).toBe(false);
    expect(isValidGrid([1, 2, 3] as never)).toBe(false);
  });

  it("candidates excludes digits seen by the cell; filled cell has none", () => {
    // r1c1 в PE96 #1: строка 1 содержит 3,2,6; столбец 1 — 9,7,8; блок 1 — 3,9,1.
    expect(candidates(PE96_1, 0)).toEqual([4, 5]);
    expect(candidates(PE96_1, 2)).toEqual([]);
    expect(() => candidates(PE96_1, 81)).toThrow(RangeError);
  });
});
