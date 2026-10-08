import { describe, expect, it } from "vitest";
import { BOX_OF, COL_OF, GRID_SIZE, LIT_CELLS_COUNT, PEERS, ROW_OF, isLit, litCells } from "./index.js";

describe("litCells", () => {
  it("every cell lights exactly its row, column and box, itself included", () => {
    for (let c = 0; c < GRID_SIZE; c++) {
      const lit = litCells(c);
      expect(lit).toHaveLength(LIT_CELLS_COUNT);
      expect(new Set(lit).size).toBe(LIT_CELLS_COUNT);
      expect(lit).toContain(c);
      const expected = Array.from({ length: GRID_SIZE }, (_, i) => i).filter(
        (i) => ROW_OF[i] === ROW_OF[c] || COL_OF[i] === COL_OF[c] || BOX_OF[i] === BOX_OF[c],
      );
      expect([...lit]).toEqual(expected);
    }
  });

  it("is PEERS plus the cell, sorted ascending", () => {
    for (let c = 0; c < GRID_SIZE; c++) {
      expect([...litCells(c)]).toEqual([...PEERS[c]!, c].sort((a, b) => a - b));
    }
  });

  it("corner r1c1: first row, first column and top-left box", () => {
    expect([...litCells(0)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 27, 36, 45, 54, 63, 72]);
  });

  it("centre r5c5", () => {
    const lit = litCells(40);
    expect(lit).toContain(30); // блок
    expect(lit).toContain(4); // столбец
    expect(lit).toContain(36); // строка
    expect(lit).not.toContain(0);
    expect(lit).not.toContain(80);
  });

  it("returns a frozen shared array", () => {
    expect(Object.isFrozen(litCells(5))).toBe(true);
    expect(litCells(5)).toBe(litCells(5));
  });

  it("rejects bad indices", () => {
    expect(() => litCells(-1)).toThrow(RangeError);
    expect(() => litCells(81)).toThrow(RangeError);
    expect(() => litCells(1.5)).toThrow(RangeError);
  });
});

describe("isLit", () => {
  it("agrees with litCells and is symmetric", () => {
    for (let a = 0; a < GRID_SIZE; a++) {
      const set = new Set(litCells(a));
      for (let b = 0; b < GRID_SIZE; b++) {
        expect(isLit(a, b)).toBe(set.has(b));
        expect(isLit(a, b)).toBe(isLit(b, a));
      }
    }
  });
});
