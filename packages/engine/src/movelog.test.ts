import { describe, expect, it } from "vitest";
import { appendMove, createMoveLog, heatmap, solvingStyle, summary } from "./index.js";
import type { Digit, Move, MoveLog } from "./index.js";

/** Миссия: r1c1..r1c3 пустые, остальное — подсказки (для простоты heatmap). */
const MISSION = "000456789" + "1".repeat(72);
const SOLUTION = "123456789" + "1".repeat(72);

function place(t: number, cell: number, digit: Digit, extra: Partial<Move> = {}): Move {
  return { t, cell, kind: "place", digit, ...extra };
}

describe("appendMove", () => {
  it("is append-only and validates time order", () => {
    let log = createMoveLog();
    log = appendMove(log, place(0, 0, 1));
    log = appendMove(log, place(1000, 1, 2));
    expect(log).toHaveLength(2);
    expect(() => appendMove(log, place(500, 2, 3))).toThrow(RangeError);
    expect(() => appendMove(log, place(2000, 81, 3))).toThrow(RangeError);
    expect(JSON.parse(JSON.stringify(log))).toEqual(log);
  });
});

describe("heatmap", () => {
  it("normalises the moment of the final correct fill; givens and unfilled cells are null", () => {
    const log: MoveLog = [
      place(0, 0, 1, { correct: true }),
      place(5000, 1, 9, { correct: false }),
      { t: 6000, cell: 1, kind: "erase" },
      place(10000, 1, 2, { correct: true }),
    ];
    const h = heatmap(log, { mission: MISSION });
    expect(h[0]).toBe(0);
    expect(h[1]).toBe(1);
    expect(h[2]).toBeNull(); // не заполнена
    expect(h[3]).toBeNull(); // подсказка
    expect(h).toHaveLength(81);
  });

  it("derives correctness from the solution when moves are not annotated", () => {
    const log: MoveLog = [place(0, 0, 1), place(4000, 1, 5), place(8000, 2, 3)];
    const h = heatmap(log, { mission: MISSION, solution: SOLUTION });
    expect(h[0]).toBe(0);
    expect(h[1]).toBeNull(); // 5 ≠ 2
    expect(h[2]).toBe(1);
  });

  it("a placement overwritten by a wrong digit is no longer counted", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), place(1000, 0, 4, { correct: false })];
    expect(heatmap(log, { mission: MISSION })[0]).toBeNull();
  });
});

describe("summary", () => {
  it("clean run: no corrections, even intervals, max technique and first cell", () => {
    const log: MoveLog = [
      place(1000, 4, 1, { correct: true, technique: "naked_single" }),
      place(2000, 7, 2, { correct: true, technique: "locked_candidates" }),
      place(3000, 9, 3, { correct: true, technique: "hidden_single" }),
      { t: 3500, cell: 10, kind: "note_add", digit: 4 },
      place(4000, 10, 4, { correct: true }),
    ];
    const s = summary(log);
    expect(s).toMatchObject({
      durationMs: 4000,
      clean: true,
      corrections: 0,
      mistakes: 0,
      maxTechnique: "locked_candidates",
      firstCell: 4,
      placements: 4,
      evenness: 0,
      intervalVariance: 0,
    });
  });

  it("counts mistakes, erases, undos and overwrites as corrections", () => {
    const log: MoveLog = [
      place(0, 0, 5, { correct: false }),
      { t: 1000, cell: 0, kind: "erase" },
      place(2000, 0, 1, { correct: true }),
      place(3000, 1, 9, { correct: false }),
      place(4000, 1, 2, { correct: true }), // перезапись
      place(5000, 2, 3, { correct: true }),
      { t: 6000, cell: 2, kind: "undo" },
    ];
    const s = summary(log);
    expect(s.clean).toBe(false);
    expect(s.mistakes).toBe(2);
    expect(s.corrections).toBe(3);
    expect(s.maxTechnique).toBeNull();
    expect(s.firstCell).toBe(0);
  });

  it("evenness grows with bursts and stalls", () => {
    const even: MoveLog = [place(0, 0, 1), place(1000, 1, 2), place(2000, 2, 3), place(3000, 3, 4)];
    const bursty: MoveLog = [place(0, 0, 1), place(100, 1, 2), place(200, 2, 3), place(90_000, 3, 4)];
    expect(summary(even).evenness).toBe(0);
    expect(summary(bursty).evenness).toBeGreaterThan(1);
    expect(summary(bursty).intervalVariance).toBeGreaterThan(summary(even).intervalVariance);
    expect(summary([]).durationMs).toBe(0);
    expect(summary([]).firstCell).toBeNull();
  });
});

describe("solvingStyle", () => {
  const seq = (cells: number[], digits: Digit[]): MoveLog =>
    cells.map((cell, i) => place(i * 1000, cell, digits[i]!));

  it("scanner: goes digit by digit", () => {
    const log = seq([0, 20, 40, 60, 80, 10, 30], [1, 1, 1, 2, 2, 3, 3]);
    expect(solvingStyle(log)).toBe("scanner");
  });

  it("blocker: closes boxes", () => {
    const log = seq([0, 1, 10, 20, 3, 4, 13, 23], [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(solvingStyle(log)).toBe("blocker");
  });

  it("snake: moves geographically across boxes", () => {
    // r1c3 → r1c4 → r1c5 → r1c6 → r1c7 → r1c8: соседи, но блоки меняются.
    const log = seq([2, 3, 4, 5, 6, 7, 8], [1, 3, 5, 7, 9, 2, 4]);
    expect(solvingStyle(log)).toBe("snake");
  });

  it("sniper: jumps around; too few moves default to sniper", () => {
    const log = seq([0, 80, 8, 72, 40, 4, 76], [1, 3, 5, 7, 9, 2, 4]);
    expect(solvingStyle(log)).toBe("sniper");
    expect(solvingStyle(seq([0, 1], [1, 2]))).toBe("sniper");
  });
});
