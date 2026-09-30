import { describe, expect, it } from "vitest";
import { applyMoveLogBudget, dayRecordFromProgress, progressFromRecord } from "../sync/schema";
import { NOW, progressOf, recordOf } from "../sync/fixtures";
import { hasTimelapse, recordHasTimelapse, timelapseOf } from "./timelapse";

describe("hasTimelapse / recordHasTimelapse (PD-70)", () => {
  it("a played, solved day has a timelapse whose last frame is the solution", () => {
    const p = progressOf("2026-09-20", { withFix: true });
    expect(hasTimelapse(p)).toBe(true);
    const tl = timelapseOf(p, { durationMs: 12000 })!;
    expect(tl.frames.at(-1)!.values.join("")).toBe(p.play.solution.join(""));
    expect(tl.durationMs).toBe(12000);
    expect(tl.frames.some((f) => f.wrong.length > 0)).toBe(true); // ошибка из партии видна в кадрах
  });

  it("an unsolved or partial day does not", () => {
    expect(hasTimelapse(progressOf("2026-09-21", { solved: false, moves: 5 }))).toBe(false);
    expect(timelapseOf(progressOf("2026-09-21", { solved: false, moves: 5 }))).toBeNull();
  });

  it("a record with a moveLog does; without it (budget / 413) it does not", () => {
    const rec = recordOf("2026-09-22", { withFix: true });
    expect(recordHasTimelapse(rec)).toBe(true);
    const { moveLog: _drop, ...lean } = rec;
    void _drop;
    expect(recordHasTimelapse(lean)).toBe(false);
    expect(recordHasTimelapse({ ...rec, moveLog: "garbage" })).toBe(false);
    expect(recordHasTimelapse({ ...rec, status: "unfinished" })).toBe(false);
  });

  it("a truncated log (first half of the moves) is not whole", () => {
    const rec = recordOf("2026-09-23");
    const cut = rec.moveLog!.split(",").slice(0, 10).join(",");
    expect(recordHasTimelapse({ ...rec, moveLog: cut })).toBe(false);
  });

  it("budget-trimmed records lose the timelapse, recent ones keep it", () => {
    const days = { "2026-09-01": recordOf("2026-09-01"), "2026-09-02": recordOf("2026-09-02") };
    const out = applyMoveLogBudget(days, 0, 1);
    expect(recordHasTimelapse(out["2026-09-02"]!)).toBe(true);
    expect(recordHasTimelapse(out["2026-09-01"]!)).toBe(false);
  });

  it("a log synthesised from heat is NOT a timelapse and never leaks back into the snapshot as moveLog", () => {
    const rec = recordOf("2026-09-24", { withFix: true });
    const { moveLog: _drop, ...lean } = rec;
    void _drop;
    const restored = progressFromRecord("2026-09-24", lean)!;
    expect(restored.play.logSynthetic).toBe(true);
    expect(restored.play.log.length).toBeGreaterThan(0);
    expect(hasTimelapse(restored)).toBe(false);
    const again = dayRecordFromProgress(restored, NOW)!;
    expect(again.moveLog).toBeUndefined();
    expect(again.heat).toBe(lean.heat); // карточка дня (heat/сводка) не пострадала
    expect(again.corrections).toBe(lean.corrections);
  });

  it("a restored record with a real moveLog is not flagged and stays a timelapse", () => {
    const rec = recordOf("2026-09-25");
    const restored = progressFromRecord("2026-09-25", rec)!;
    expect(restored.play.logSynthetic).toBeUndefined();
    expect(hasTimelapse(restored)).toBe(true);
    expect(dayRecordFromProgress(restored, NOW)!.moveLog).toBe(rec.moveLog);
  });
});
