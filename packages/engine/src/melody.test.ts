import { describe, expect, it } from "vitest";
import { dailyPuzzle, DEFAULT_MAX_GAP_MS, melodyOf, timelapseFrames, unitsCompletedBy } from "./index.js";
import type { CellValue, Digit, MelodyEvent, MelodyUnit, Move, MoveLog } from "./index.js";

/** Почти решённая сетка: пусты только r1c1..r1c3 (решение 1,2,3). Остальное — валидное решение-подсказки. */
const SOLVED = "123456789" + "456789123" + "789123456" + "214365897" + "365897214" + "897214365" + "531642978" + "642978531" + "978531642";
const MISSION = "000" + SOLVED.slice(3);
const puzzle = { mission: MISSION, solution: SOLVED };

const place = (t: number, cell: number, digit: Digit, extra: Partial<Move> = {}): Move => ({ t, cell, kind: "place", digit, ...extra });
const erase = (t: number, cell: number): Move => ({ t, cell, kind: "erase" });
const undo = (t: number, cell = 0): Move => ({ t, cell, kind: "undo" });
const noteAdd = (t: number, cell: number, digit: Digit): Move => ({ t, cell, kind: "note_add", digit });

const notes = (m: readonly MelodyEvent[] | null): [number, number, number][] =>
  (m ?? []).filter((e) => e.kind === "note").map((e) => [e.t, e.cell, e.digit]);
const units = (m: readonly MelodyEvent[] | null): MelodyUnit[] => (m ?? []).filter((e): e is MelodyUnit => e.kind === "unit");

describe("unitsCompletedBy", () => {
  it("empty cell closes nothing", () => {
    expect(unitsCompletedBy(MISSION, 0)).toEqual([]);
  });

  it("full grid: row, col, box in this order, cells in reading order", () => {
    const r = unitsCompletedBy(SOLVED, 40); // r5c5, блок 4
    expect(r.map((u) => [u.kind, u.index])).toEqual([
      ["row", 4],
      ["col", 4],
      ["box", 4],
    ]);
    expect(r[0]!.cells).toEqual([36, 37, 38, 39, 40, 41, 42, 43, 44]);
    expect(r[1]!.cells).toEqual([4, 13, 22, 31, 40, 49, 58, 67, 76]);
    expect(r[2]!.cells).toEqual([30, 31, 32, 39, 40, 41, 48, 49, 50]);
  });

  it("only units that are fully filled", () => {
    const g = "1" + MISSION.slice(1); // r1c1 заполнена, r1c2/r1c3 пусты
    // столбец 0 и строка 0? строка 0 не полна; столбец 0 полон; блок 0 не полон
    expect(unitsCompletedBy(g, 0).map((u) => u.kind)).toEqual(["col"]);
  });

  it("accepts number arrays, rejects bad cell", () => {
    expect(unitsCompletedBy([...SOLVED].map(Number) as CellValue[], 80)).toHaveLength(3);
    expect(() => unitsCompletedBy(SOLVED, 81)).toThrow(RangeError);
  });
});

describe("melodyOf — no melody", () => {
  it("null/undefined/empty log, synthetic log", () => {
    const log = [place(100, 0, 1), place(200, 1, 2), place(300, 2, 3)];
    expect(melodyOf(null, puzzle)).toBeNull();
    expect(melodyOf(undefined, puzzle)).toBeNull();
    expect(melodyOf([], puzzle)).toBeNull();
    expect(melodyOf(log, puzzle, { synthetic: true })).toBeNull();
    expect(melodyOf(log, puzzle)).not.toBeNull();
  });

  it("unfinished or wrong at the end", () => {
    expect(melodyOf([place(100, 0, 1), place(200, 1, 2)], puzzle)).toBeNull();
    expect(melodyOf([place(100, 0, 1), place(200, 1, 2), place(300, 2, 4)], puzzle)).toBeNull();
  });
});

describe("melodyOf — path", () => {
  it("one note per final placement, in path order, with unit arpeggios after the closing note", () => {
    const m = melodyOf([place(1000, 2, 3), place(2000, 0, 1), place(2500, 1, 2)], puzzle);
    expect(notes(m)).toEqual([
      [1000, 2, 3],
      [2000, 0, 1],
      [2500, 1, 2],
    ]);
    // каждая клетка закрывает свой столбец (остальное — подсказки); последняя закрывает ещё строку 0 и блок 0
    expect(m!.map((e) => (e.kind === "note" ? `n${e.cell}` : `${e.unit}${e.index}`))).toEqual([
      "n2",
      "col2",
      "n0",
      "col0",
      "n1",
      "row0",
      "col1",
      "box0",
    ]);
    const row = units(m).find((u) => u.unit === "row")!;
    expect(row).toMatchObject({ t: 2500, cell: 1, digit: 2, index: 0 });
    expect(row.cells).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(row.digits).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("undo, erase and overwritten digits do not sound; note sounds at the final placement", () => {
    const log: MoveLog = [
      place(100, 0, 7), // ошибка
      undo(200),
      noteAdd(300, 1, 2),
      place(400, 1, 2),
      place(500, 2, 9), // ошибка
      place(600, 2, 3), // перезапись
      place(700, 0, 1),
      erase(800, 0),
      place(900, 0, 1), // итог клетки 0 — здесь
    ];
    const m = melodyOf(log, puzzle);
    expect(notes(m)).toEqual([
      [400, 1, 2],
      [600, 2, 3],
      [900, 0, 1],
    ]);
  });

  it("undo of a correct digit followed by re-placement: sounds once, at the re-placement", () => {
    const m = melodyOf([place(100, 0, 1), place(200, 1, 2), undo(300), place(400, 2, 3), place(500, 1, 2)], puzzle);
    expect(notes(m).map(([, cell]) => cell)).toEqual([0, 2, 1]);
    expect(notes(m)[2]![0]).toBe(500);
  });

  it("ink blot: the blot is silent, its auto-replacement sounds", () => {
    const log = [place(100, 0, 5, { correct: false, blot: true }), place(100, 0, 1, { correct: true, blot: true }), place(200, 1, 2), place(300, 2, 3)];
    expect(notes(melodyOf(log, puzzle))).toEqual([
      [100, 0, 1],
      [200, 1, 2],
      [300, 2, 3],
    ]);
  });

  it("time is the timelapse time: pauses compressed, durationMs/speed respected, frames match", () => {
    const log = [place(1000, 0, 1), place(60_000, 1, 2), place(61_000, 2, 3)];
    expect(notes(melodyOf(log, puzzle)).map(([t]) => t)).toEqual([1000, 1000 + DEFAULT_MAX_GAP_MS, 2000 + DEFAULT_MAX_GAP_MS]);
    for (const opts of [{}, { durationMs: 10_000 }, { speed: 2 }, { maxGapMs: Infinity }]) {
      const frames = timelapseFrames(log, puzzle, opts).frames.filter((f) => f.move >= 0);
      expect(notes(melodyOf(log, puzzle, opts)).map(([t]) => t)).toEqual(frames.map((f) => f.t));
    }
    expect(() => melodyOf(log, puzzle, { speed: 0 })).toThrow(RangeError);
  });

  it("deterministic and does not mutate the log", () => {
    const log = Object.freeze([place(100, 0, 1), place(200, 1, 2), place(300, 2, 3)].map((m) => Object.freeze(m)));
    expect(melodyOf(log, puzzle)).toEqual(melodyOf(log, puzzle));
  });

  it("full daily puzzle: 81 − clues notes, all 27 units close exactly once, last event closes the grid", () => {
    const p = dailyPuzzle("2026-10-05", "easy");
    const empty = [...p.mission].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0);
    const log = empty.map((cell, i) => place(i * 700, cell, Number(p.solution[cell]) as Digit));
    const m = melodyOf(log, p)!;
    expect(notes(m)).toHaveLength(empty.length);
    const closed = units(m).map((u) => `${u.unit}${u.index}`);
    // юнит без пустых клеток «закрыт» с начала и в мелодии не звучит; любой другой звучит ровно один раз
    const withEmpty = new Set<string>();
    for (const cell of empty) {
      for (const u of unitsCompletedBy(p.solution, cell)) withEmpty.add(`${u.kind}${u.index}`);
    }
    expect(new Set(closed)).toEqual(withEmpty);
    expect(closed).toHaveLength(withEmpty.size);
    for (const u of units(m)) expect([...u.digits].sort()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(m[m.length - 1]!.kind).toBe("unit");
  });

  it("works without solution (correctness from Move.correct or assumed)", () => {
    const m = melodyOf([place(100, 0, 1), place(200, 1, 2), place(300, 2, 3)], { mission: MISSION });
    expect(notes(m)).toHaveLength(3);
  });
});
