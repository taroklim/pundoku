import { countSolutions } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import {
  cluesOf,
  hiddenSolution,
  initialPermanent,
  isSolvable,
  landDay,
  landingCell,
  nextGrid,
  type PermanentGridState,
} from "./permanent";

const fresh = () => initialPermanent("test-seed");

/** Приземлить N клеток подряд (клетки 0..n-1, даты d0..). */
function withCells(n: number, base: PermanentGridState = fresh()): PermanentGridState {
  let s = base;
  for (let i = 0; i < n; i++) {
    const l = landDay(s, `d${i}`, i);
    if (!l) throw new Error("no landing");
    s = l.state;
  }
  return s;
}

describe("скрытое решение", () => {
  it("детерминировано по installSeed и номеру сетки, валидная заполненная сетка", () => {
    const a = hiddenSolution(fresh());
    expect(hiddenSolution(fresh())).toEqual(a);
    expect(a).toHaveLength(81);
    expect(a.every((d) => d >= 1 && d <= 9)).toBe(true);
    expect(countSolutions(a.join(""), 2)).toBe(1); // полная сетка — единственное «решение» самой себя
  });
  it("разные установки и разные номера — разные решения", () => {
    expect(hiddenSolution(initialPermanent("other"))).not.toEqual(hiddenSolution(fresh()));
    expect(hiddenSolution(nextGrid(fresh()))).not.toEqual(hiddenSolution(fresh()));
  });
});

describe("landDay", () => {
  it("клетка садится на желаемую позицию, цифра — из скрытого решения", () => {
    const l = landDay(fresh(), "2026-09-29", 33)!;
    expect(l.cell).toBe(33);
    expect(l.digit).toBe(hiddenSolution(fresh())[33]);
    expect(l.state.cells).toEqual([{ cell: 33, date: "2026-09-29" }]);
  });

  it("один прилёт на дату: повтор — null и состояние не меняется", () => {
    const l = landDay(fresh(), "2026-09-29", 33)!;
    expect(landDay(l.state, "2026-09-29", 5)).toBeNull();
  });

  it("занятая клетка → ближайшая свободная (Манхэттен), при равенстве — меньший индекс", () => {
    const s = landDay(fresh(), "d1", 40)!.state; // центр занят
    const l = landDay(s, "d2", 40)!;
    // соседи центра на расстоянии 1: 31 (сверху), 39 (слева), 41, 49 — минимальный индекс 31
    expect(l.cell).toBe(31);
    expect(landingCell(l.state, 40)).toBe(39);
  });

  it("свободных клеток нет — null", () => {
    let s = fresh();
    for (let i = 0; i < 81; i++) s = { ...s, cells: [...s.cells, { cell: i, date: `x${i}` }] };
    expect(landDay(s, "new", 0)).toBeNull();
  });
});

describe("cluesOf / счётчик", () => {
  it("открытые клетки совпадают со скрытым решением, остальные пусты", () => {
    const s = withCells(3);
    const c = cluesOf(s);
    const sol = hiddenSolution(s);
    expect(c.filter(Boolean)).toHaveLength(3);
    [0, 1, 2].forEach((i) => expect(c[i]).toBe(sol[i]));
  });
});

describe("isSolvable", () => {
  it("пустая и почти пустая — нет", () => {
    expect(isSolvable(fresh())).toBe(false);
    expect(isSolvable(withCells(12))).toBe(false);
  });
  it("вся сетка — да; согласуется с countSolutions на промежуточных размерах", () => {
    const full = withCells(81);
    expect(isSolvable(full)).toBe(true);
    for (const n of [20, 30, 45]) {
      const s = withCells(n);
      expect(isSolvable(s)).toBe(countSolutions(cluesOf(s).join(""), 2) === 1);
    }
  });
});

describe("nextGrid", () => {
  it("следующий индекс, пустой набор клеток, тот же installSeed", () => {
    const n = nextGrid(withCells(5));
    expect(n).toEqual({ installSeed: "test-seed", index: 1, cells: [] });
  });
});
