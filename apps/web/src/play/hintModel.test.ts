import { describe, expect, it } from "vitest";
import { UNITS } from "@pundoku/engine";
import type { StepHint } from "@pundoku/engine";
import { HINT_FIXTURES, playOf, withValue } from "./hint.fixtures";
import type { FixtureName } from "./hint.fixtures";
import { computeHint, hintCellOf, hintFocusCell, hintMarks, hintRoleOf, regionCells, regionRect } from "./hintModel";

const step = (name: FixtureName): StepHint => {
  const h = computeHint(playOf(name));
  expect(h.kind, name).toBe("step");
  return h as StepHint;
};

describe("computeHint: доска игрока → подсказка движка", () => {
  it("каждая фикстура даёт ожидаемую технику", () => {
    expect(step("pointing").explanation.id).toBe("locked_pointing");
    expect(step("claiming").explanation.id).toBe("locked_claiming");
    expect(step("hiddenPair").explanation.id).toBe("hidden_pair");
    expect(step("nakedPair").explanation.id).toBe("naked_pair");
    expect(step("hiddenSingle").technique).toBe("hidden_single");
    expect(step("nakedSingle").technique).toBe("naked_single");
  });

  it("«ничего не нашёл» (beyond) — kind none, не step", () => {
    const h = computeHint(playOf("beyond"));
    expect(h).toEqual({ kind: "none", reason: "beyond" });
    expect(hintMarks(h, 1, [])).toBeNull();
    expect(hintCellOf(h)).toBeNull();
  });

  it("неверная цифра на доске → mistake, только область сургучом, клетки не называются", () => {
    const p = playOf("nakedSingle");
    const h = computeHint(p);
    expect(h.kind).toBe("step");
    const s = h as StepHint;
    const cell = s.placement!.cell;
    const wrong = (s.placement!.digit % 9) + 1;
    const bad = computeHint(withValue(p, cell, wrong));
    expect(bad.kind).toBe("mistake");
    for (const st of [1, 2, 3, 4] as const) {
      const m = hintMarks(bad, st, p.notes)!;
      expect(m.tone).toBe("wax");
      expect(m.strip.size).toBe(0);
      expect(m.ring.size).toBe(0);
      expect(m.struck.size).toBe(0);
    }
  });

  it("заданные клетки доски не теряются: values подсказки включает givens", () => {
    // Если бы values были без givens, движок увидел бы почти пустую сетку и не нашёл бы singles.
    expect(step("nakedSingle").placement).toBeDefined();
  });
});

describe("hintMarks: что на поле на каждой ступени", () => {
  it("ступени 1–2: только область", () => {
    for (const name of Object.keys(HINT_FIXTURES) as FixtureName[]) {
      if (name === "beyond") continue;
      const h = step(name);
      for (const st of [1, 2] as const) {
        const m = hintMarks(h, st, [])!;
        expect(m.tone).toBe("ink");
        expect(m.region).toEqual(h.region);
        expect(m.strip.size + m.ring.size + m.struck.size).toBe(0);
      }
    }
  });

  it("одиночка: ступень 3 — полоса на клетке, ступень 4 — ещё кольца на свидетелях", () => {
    for (const name of ["nakedSingle", "hiddenSingle"] as const) {
      const h = step(name);
      const m3 = hintMarks(h, 3, [])!;
      expect([...m3.strip]).toEqual([...h.cells.target]);
      expect(m3.ring.size).toBe(0);
      const m4 = hintMarks(h, 4, [])!;
      expect([...m4.strip]).toEqual([...h.cells.target]);
      expect([...m4.ring].sort()).toEqual([...h.cells.witnesses].sort());
      expect(m4.struck.size).toBe(0);
    }
  });

  it("паттерн: ступень 3 — кольца на клетках паттерна, ступень 4 — полосы на затронутых клетках", () => {
    for (const name of ["pointing", "claiming", "nakedPair", "hiddenPair"] as const) {
      const h = step(name);
      const m3 = hintMarks(h, 3, [])!;
      expect([...m3.ring].sort()).toEqual([...h.cells.target].sort());
      expect(m3.strip.size).toBe(0);
      const m4 = hintMarks(h, 4, [])!;
      expect([...m4.strip].sort()).toEqual([...h.cells.affected].sort());
    }
  });

  it("вычёркивание рисуется только там, где заметка у игрока реально есть", () => {
    const h = step("pointing");
    expect(h.eliminations?.length).toBeGreaterThan(0);
    // Без заметок — ничего не зачёркнуто.
    expect(hintMarks(h, 4, new Array(81).fill(0))!.struck.size).toBe(0);
    // Заметка с первым вычёркиваемым кандидатом — зачёркнут ровно он.
    const e = h.eliminations![0]!;
    const notes = new Array<number>(81).fill(0);
    notes[e.cell] = 1 << e.digit;
    const m = hintMarks(h, 4, notes)!;
    expect(m.struck.get(e.cell)).toBe(1 << e.digit);
    // На ступенях до 4 вычёркиваний нет.
    expect(hintMarks(h, 3, notes)!.struck.size).toBe(0);
  });
});

describe("геометрия области и роли клеток", () => {
  it("regionCells: девять клеток, как у движка", () => {
    const h = step("nakedSingle");
    const cells = regionCells(h.region);
    expect(cells).toHaveLength(9);
    expect(new Set(cells).size).toBe(9);
    expect(cells).toEqual([...UNITS[h.region.unit]!]);
    expect(regionCells({ kind: "row", index: 2, unit: 2 })).toEqual([18, 19, 20, 21, 22, 23, 24, 25, 26]);
    expect(regionCells({ kind: "col", index: 4, unit: 13 })).toEqual([4, 13, 22, 31, 40, 49, 58, 67, 76]);
    expect(regionCells({ kind: "box", index: 5, unit: 23 })).toEqual([33, 34, 35, 42, 43, 44, 51, 52, 53]);
  });

  it("regionRect: строка и столбец пересекают два зазора между блоками, блок — ни одного", () => {
    expect(regionRect({ kind: "row", index: 4, unit: 4 })).toMatchObject({ r: 4, c: 0, h: 1, w: 9, gx: 2, gy: 0, br: 1 });
    expect(regionRect({ kind: "col", index: 7, unit: 16 })).toMatchObject({ r: 0, c: 7, h: 9, w: 1, gx: 0, gy: 2, bc: 2 });
    expect(regionRect({ kind: "box", index: 5, unit: 23 })).toMatchObject({ r: 3, c: 6, h: 3, w: 3, br: 1, bc: 2 });
  });

  it("роли: кольцо — свидетель, полоса — клетка, остальное — область", () => {
    const h = step("hiddenSingle");
    const m = hintMarks(h, 4, [])!;
    const inRegion = new Set(regionCells(h.region));
    const target = h.cells.target[0]!;
    expect(hintRoleOf(m, target, inRegion)).toBe("cell");
    const w = h.cells.witnesses[0]!;
    expect(hintRoleOf(m, w, inRegion)).toBe("witness");
    expect(hintRoleOf(null, 0, inRegion)).toBeNull();
    const plain = [...inRegion].find((c) => !m.strip.has(c) && !m.ring.has(c))!;
    expect(hintRoleOf(m, plain, inRegion)).toBe("region");
  });

  it("клетка журнала и клетка выбора при закрытии", () => {
    const single = step("nakedSingle");
    expect(hintCellOf(single)).toBe(single.placement!.cell);
    expect(hintFocusCell(single)).toBe(single.placement!.cell);
    const pattern = step("pointing");
    expect(hintCellOf(pattern)).toBe(pattern.leadsTo?.cell ?? null);
    expect(hintFocusCell(pattern)).toBe(pattern.cells.target[0]);
  });
});
