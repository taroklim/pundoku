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
    expect(s.corrections).toBe(3); // erase, перезапись, undo постановки
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

  it("blocker: closes boxes (cells inside a box, not necessarily adjacent)", () => {
    const log = seq([0, 11, 19, 2, 9, 5, 13, 21], [1, 3, 5, 7, 9, 2, 4, 6]);
    expect(solvingStyle(log)).toBe("blocker");
  });

  it("snake: moves geographically across boxes", () => {
    // r1c1 → r1c9 подряд: соседние клетки, блоки меняются.
    const row = seq([0, 1, 2, 3, 4, 5, 6, 7, 8], [1, 3, 5, 7, 9, 2, 4, 6, 8]);
    expect(solvingStyle(row)).toBe("snake");
    // Вдоль границы блоков вниз: r1c3 → r1c4 → r2c4 → r3c4 → … → r7c4.
    const column = seq([2, 3, 12, 21, 30, 39, 48, 57], [1, 3, 5, 7, 9, 2, 4, 6]);
    expect(solvingStyle(column)).toBe("snake");
  });

  it("sniper: jumps around; too few moves default to sniper", () => {
    const log = seq([0, 80, 8, 72, 40, 4, 76], [1, 3, 5, 7, 9, 2, 4]);
    expect(solvingStyle(log)).toBe("sniper");
    expect(solvingStyle(seq([0, 1], [1, 2]))).toBe("sniper");
  });
});

describe("undo contract", () => {
  const erase = (t: number, cell: number): Move => ({ t, cell, kind: "erase" });
  const undo = (t: number, cell: number): Move => ({ t, cell, kind: "undo" });
  const note = (t: number, cell: number, digit: Digit): Move => ({ t, cell, kind: "note_add", digit });

  it("place → erase → undo: the digit is back in the heatmap with its original time, erase correction is cancelled", () => {
    const log: MoveLog = [
      place(0, 0, 1, { correct: true }),
      place(4000, 1, 2, { correct: true }),
      erase(6000, 1),
      undo(8000, 1),
    ];
    const h = heatmap(log, { mission: MISSION });
    expect(h[1]).toBe(0.5); // 4000 / 8000, а не null
    const s = summary(log);
    expect(s.corrections).toBe(0);
    expect(s.clean).toBe(true);
    expect(s.placements).toBe(2);
    expect(s.durationMs).toBe(8000);
  });

  it("place → erase (no undo) still counts one correction and clears the heatmap", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), erase(1000, 0)];
    expect(heatmap(log, { mission: MISSION })[0]).toBeNull();
    expect(summary(log).corrections).toBe(1);
  });

  it("erase of an empty cell is a no-op for corrections; its undo is a no-op too", () => {
    const log: MoveLog = [erase(0, 0), undo(100, 0)];
    expect(summary(log)).toMatchObject({ corrections: 0, clean: true });
  });

  it("note_add → undo does not break clean or anything else", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), note(1000, 1, 5), undo(1500, 1), place(3000, 1, 2, { correct: true })];
    const s = summary(log);
    expect(s).toMatchObject({ clean: true, corrections: 0, mistakes: 0, placements: 2 });
    expect(heatmap(log, { mission: MISSION }).slice(0, 2)).toEqual([0, 1]);
  });

  it("note_remove → undo and note_add spam are neutral", () => {
    const log: MoveLog = [
      note(0, 2, 4),
      { t: 100, cell: 2, kind: "note_remove", digit: 4 },
      undo(200, 2),
      undo(300, 2),
      place(400, 2, 3, { correct: true }),
    ];
    expect(summary(log)).toMatchObject({ clean: true, corrections: 0, placements: 1 });
  });

  it("undo of a place: cell returns to empty, +1 correction, placement is not counted", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), place(2000, 1, 2, { correct: true }), undo(3000, 1)];
    const h = heatmap(log, { mission: MISSION });
    expect(h[0]).toBe(0);
    expect(h[1]).toBeNull();
    const s = summary(log);
    expect(s).toMatchObject({ corrections: 1, clean: false, placements: 1, firstCell: 0 });
  });

  it("undo of an overwrite restores the previous digit (its time), correction stays 1", () => {
    const log: MoveLog = [
      place(1000, 0, 1, { correct: true }),
      place(3000, 0, 4, { correct: false }),
      undo(4000, 0),
      place(5000, 2, 3, { correct: true }),
    ];
    expect(heatmap(log, { mission: MISSION })[0]).toBe(0.2); // 1000 / 5000
    const s = summary(log);
    expect(s.corrections).toBe(1);
    expect(s.mistakes).toBe(1); // ошибка была допущена, отмена её не стирает
    expect(s.placements).toBe(2);
  });

  it("place → erase → undo → undo: second undo takes the place back", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), erase(1000, 0), undo(2000, 0), undo(3000, 0)];
    expect(heatmap(log, { mission: MISSION })[0]).toBeNull();
    expect(summary(log)).toMatchObject({ corrections: 1, placements: 0, firstCell: null });
  });

  it("multiple undo walks the stack back step by step; extra undo on an empty stack is a no-op", () => {
    const moves: Move[] = [
      place(0, 0, 1, { correct: true }),
      note(500, 1, 3),
      place(1000, 1, 2, { correct: true }),
      erase(1500, 0),
      place(2000, 2, 3, { correct: true }),
    ];
    let log: MoveLog = moves;
    // откат: place(2), erase(0), place(1), note, place(0)
    const expectedHeat: (number | null)[][] = [
      [null, 0.5, null], // после undo place cell 2: erase(0) ещё действует
      [0, 0.5, null], // undo erase → r1c1 вернулся
      [0, null, null], // undo place cell 1
      [0, null, null], // undo note
      [null, null, null], // undo place cell 0
      [null, null, null], // лишний undo — no-op
    ];
    let t = 3000;
    for (const want of expectedHeat) {
      log = [...log, undo(t, 0)];
      t += 1000;
      const h = heatmap(log, { mission: MISSION }).slice(0, 3);
      // Нормировка к длительности лога меняется — сравниваем «заполнена/нет» и порядок.
      expect(h.map((v) => v !== null)).toEqual(want.map((v) => v !== null));
    }
    const s = summary(log);
    expect(s.placements).toBe(0);
    expect(s.firstCell).toBeNull();
  });

  it("undo ignores its own cell/digit: what is reverted is decided by the stack", () => {
    const a: MoveLog = [place(0, 0, 1, { correct: true }), place(1000, 1, 2, { correct: true }), undo(2000, 0)];
    const b: MoveLog = [place(0, 0, 1, { correct: true }), place(1000, 1, 2, { correct: true }), undo(2000, 55)];
    expect(heatmap(a, { mission: MISSION }).slice(0, 2)).toEqual(heatmap(b, { mission: MISSION }).slice(0, 2));
    expect(heatmap(a, { mission: MISSION })[1]).toBeNull();
    expect(summary(a)).toEqual(summary(b));
  });

  it("undo is deterministic and the log stays append-only/serialisable", () => {
    const log: MoveLog = [place(0, 0, 1, { correct: true }), erase(500, 0), undo(900, 0)];
    const before = JSON.stringify(log);
    summary(log);
    heatmap(log, { mission: MISSION });
    expect(JSON.stringify(log)).toBe(before);
    expect(appendMove(log, undo(1000, 0))).toHaveLength(4);
  });

  it("solvingStyle ignores placements taken back by undo", () => {
    const seq: MoveLog = [];
    let log: MoveLog = seq;
    // 4 постановок «сканером», между ними отменённые прыжки в далёкие клетки
    const cells = [0, 20, 40, 60];
    let t = 0;
    for (const c of cells) {
      log = [...log, place(t, 80 - c, 5), undo(t + 10, 80 - c), place(t + 20, c, 1)];
      t += 1000;
    }
    expect(solvingStyle(log)).toBe("scanner");
  });

  it("honest card: an undone mistake is still a mistake", () => {
    const log: MoveLog = [place(0, 0, 5, { correct: false }), undo(500, 0), place(1000, 0, 1, { correct: true })];
    expect(summary(log)).toMatchObject({ mistakes: 1, clean: false });
  });
});
