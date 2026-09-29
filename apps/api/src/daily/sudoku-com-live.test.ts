/**
 * Живой запрос к Sudoku.com — только при LIVE_SUDOKU_COM=1 (сеть, чужой сервис). Для QA:
 *   LIVE_SUDOKU_COM=1 pnpm --filter @pundoku/api test -- sudoku-com-live
 */
import { describe, expect, it } from "vitest";
import { SudokuComSource } from "./sudoku-com-source.js";

describe.skipIf(process.env.LIVE_SUDOKU_COM !== "1")("Sudoku.com live", () => {
  const source = new SudokuComSource({ baseUrl: process.env.SUDOKU_COM_BASE_URL ?? "https://sudoku.com/api/v2", timeoutMs: 10_000 });

  it("2026-09-28 → известная сетка", async () => {
    const result = await source.fetch("2026-09-28");
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.puzzle.mission).toBe("002000000085703020004920061030000084600001000000040610003080000210006740006007830");
      expect(result.puzzle.difficulty).toBe("hard");
      expect(typeof result.puzzle.winRate).toBe("number");
    }
  });

  it("далёкое будущее → not_available (204)", async () => {
    expect(await source.fetch("2099-01-01")).toEqual({ kind: "not_available" });
  });
});
