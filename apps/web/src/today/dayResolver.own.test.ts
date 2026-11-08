import { describe, expect, it } from "vitest";
import { isDayStarted, reconcileDay, shouldRefetch } from "./dayResolver";
import type { DayPuzzle } from "./dayResolver";

const latest: DayPuzzle = { date: "2026-11-08", mission: "0".repeat(81), difficulty: "hard", source: "sudoku.com", winRate: 50 };

describe("PD-305: dayResolver и наш источник", () => {
  it("наша сетка не перезапрашивается (как Sudoku.com); generator/client — временные", () => {
    expect(shouldRefetch("pundoku")).toBe(false);
    expect(shouldRefetch("sudoku.com")).toBe(false);
    expect(shouldRefetch("generator")).toBe(true);
    expect(shouldRefetch("client")).toBe(true);
  });

  it("сверка по mission нашу сетку не заменяет и не «подтверждает» — даже без ходов", () => {
    expect(reconcileDay({ mission: "1".repeat(81), source: "pundoku", hasMoves: false }, latest)).toEqual({ action: "none" });
    expect(reconcileDay({ mission: "1".repeat(81), source: "pundoku", hasMoves: true }, latest)).toEqual({ action: "none" });
    expect(reconcileDay({ mission: latest.mission, source: "pundoku", hasMoves: false }, latest)).toEqual({ action: "none" });
    // прежнее поведение для остальных источников
    expect(reconcileDay({ mission: "1".repeat(81), source: "client", hasMoves: false }, latest).action).toBe("replace");
    expect(reconcileDay({ mission: "1".repeat(81), source: "client", hasMoves: true }, latest).action).toBe("keep-own");
  });

  it("isDayStarted: ход, подсказка или решение", () => {
    expect(isDayStarted({ solved: false, play: { log: [] } })).toBe(false);
    expect(isDayStarted({ solved: false, play: { log: [] }, hints: 0 })).toBe(false);
    expect(isDayStarted({ solved: false, play: { log: [{}] } })).toBe(true);
    expect(isDayStarted({ solved: false, play: { log: [] }, hints: 1 })).toBe(true);
    expect(isDayStarted({ solved: true, play: { log: [] } })).toBe(true);
  });
});
