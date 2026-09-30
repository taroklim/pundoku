import { timelapseFingerprint } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { dailyPuzzle } from "@pundoku/engine";
import { FP_CELL, FP_GAP, FP_GRID, FP_GRID_TOP, FP_HEIGHT, FP_PAD, FP_PITCH, FP_WIDTH, fingerprintLayout } from "./fingerprint";
import { HEAT_MAX, HEAT_MIN } from "./heat";
import { createPlay, enterDigit, setInkMode } from "./logic";

function play(ink: boolean, blotsAt: number[], think: Record<number, number> = {}) {
  let p = createPlay(dailyPuzzle("2026-09-20", "easy"));
  if (ink) p = setInkMode(p, true);
  const empty = p.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  let t = 1000;
  empty.forEach((cell, idx) => {
    const digit = blotsAt.includes(idx) ? (p.solution[cell]! % 9) + 1 : p.solution[cell]!;
    p = enterDigit(p, cell, digit, (t += think[idx] ?? 800));
  });
  return p;
}

const layoutOf = (p: ReturnType<typeof play>) => {
  const mission = p.mission.join("");
  const fp = timelapseFingerprint(p.log, { mission, solution: p.solution.join("") }, { maxGapMs: Infinity });
  return { fp, mission, layout: fingerprintLayout(fp, mission) };
};

describe("fingerprintLayout (PNG 1080×1350, Rhythm)", () => {
  it("геометрия: 9 ячеек 96 + 8 зазоров 8 = 928, целое масштабирование, поля по бокам равны", () => {
    expect(9 * FP_CELL + 8 * FP_GAP).toBe(FP_GRID);
    expect(FP_PAD * 2 + FP_GRID).toBe(FP_WIDTH);
    expect(FP_PITCH).toBe(104);
    expect(FP_GRID_TOP + FP_GRID).toBeLessThan(FP_HEIGHT - FP_PAD);
  });

  it("81 квадрат: подсказки — контур размером с ячейку, остальное внутри своей ячейки на целых пикселях", () => {
    const { layout, mission } = layoutOf(play(false, []));
    expect(layout.squares).toHaveLength(81);
    for (const q of layout.squares) {
      const sx = FP_PAD + (q.cell % 9) * FP_PITCH;
      const sy = FP_GRID_TOP + Math.floor(q.cell / 9) * FP_PITCH;
      expect(Number.isInteger(q.x) && Number.isInteger(q.y) && Number.isInteger(q.size)).toBe(true);
      expect(q.x).toBeGreaterThanOrEqual(sx);
      expect(q.y).toBeGreaterThanOrEqual(sy);
      expect(q.x + q.size).toBeLessThanOrEqual(sx + FP_CELL);
      expect(q.y + q.size).toBeLessThanOrEqual(sy + FP_CELL);
      if (mission[q.cell] !== "0") expect(q).toMatchObject({ kind: "given", size: FP_CELL });
      else expect(q.kind).not.toBe("given");
    }
  });

  it("тон = порядок: первая клетка HEAT_MIN, последняя HEAT_MAX, не убывает по порядку", () => {
    const { layout, fp } = layoutOf(play(false, []));
    const byOrder = fp.cells
      .map((c, cell) => ({ c, cell }))
      .filter((e) => e.c)
      .sort((a, b) => a.c!.order - b.c!.order)
      .map((e) => layout.squares[e.cell]!.opacity);
    expect(byOrder[0]).toBeCloseTo(HEAT_MIN, 3);
    expect(byOrder.at(-1)).toBeCloseTo(HEAT_MAX, 3);
    for (let i = 1; i < byOrder.length; i++) expect(byOrder[i]!).toBeGreaterThanOrEqual(byOrder[i - 1]!);
  });

  it("размер = время раздумья: долгая пауза — меньший квадрат, размеры чётные, не меньше 0.45 ячейки", () => {
    const { layout, fp } = layoutOf(play(false, [], { 10: 60000 }));
    const cellAt = (order: number) => fp.cells.findIndex((c) => c?.order === order);
    const slow = layout.squares[cellAt(10)]!;
    const fast = layout.squares[cellAt(5)]!;
    expect(slow.size).toBeLessThan(fast.size);
    expect(slow.size).toBeGreaterThanOrEqual(Math.round(FP_CELL * 0.45) - 1);
    for (const q of layout.squares) if (q.kind !== "given") expect(q.size % 2).toBe(0);
  });

  it("клякса ink-дня — kind blot на той клетке, больше клякс нет; обычный день без кляксы", () => {
    const { layout: a } = layoutOf(play(true, [2, 9]));
    expect(a.squares.filter((q) => q.kind === "blot")).toHaveLength(2);
    const { layout: b } = layoutOf(play(false, [2, 9]));
    expect(b.squares.filter((q) => q.kind === "blot")).toHaveLength(0);
  });

  it("в макете нет ни цифр, ни текста: только геометрия", () => {
    const { layout } = layoutOf(play(false, []));
    for (const q of layout.squares) expect(Object.keys(q).sort()).toEqual(["cell", "kind", "opacity", "size", "x", "y"]);
  });
});
