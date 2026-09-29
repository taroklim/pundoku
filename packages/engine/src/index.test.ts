import { describe, expect, it } from "vitest";
import { DIFFICULTIES, GRID_SIZE, emptyGrid } from "./index.js";

describe("@pundoku/engine smoke", () => {
  it("emptyGrid returns 81 empty cells", () => {
    const grid = emptyGrid();
    expect(grid).toHaveLength(GRID_SIZE);
    expect(grid.every((cell) => cell === 0)).toBe(true);
  });

  it("exposes four difficulties", () => {
    expect(DIFFICULTIES).toEqual(["easy", "medium", "hard", "expert"]);
  });
});
