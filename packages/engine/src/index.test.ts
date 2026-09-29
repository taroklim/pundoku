import { describe, expect, it } from "vitest";
import { DIFFICULTIES, GRID_SIZE, TECHNIQUE_ORDER, emptyGrid } from "./index.js";

describe("@pundoku/engine smoke", () => {
  it("emptyGrid returns 81 empty cells", () => {
    const grid = emptyGrid();
    expect(grid).toHaveLength(GRID_SIZE);
    expect(grid.every((cell) => cell === 0)).toBe(true);
  });

  it("exposes four difficulties and five techniques in cost order", () => {
    expect(DIFFICULTIES).toEqual(["easy", "medium", "hard", "expert"]);
    expect(TECHNIQUE_ORDER).toEqual([
      "naked_single",
      "hidden_single",
      "locked_candidates",
      "naked_pair",
      "hidden_pair",
    ]);
  });
});
