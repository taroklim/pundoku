import { describe, expect, it } from "vitest";
import { INK_RULES, blotsOf, heatmap, inkAllows, inkViolations, solvingStyle, summary } from "./index.js";
import type { Digit, InkRules, Move, MoveLog } from "./index.js";

const MISSION = "000456789" + "1".repeat(72);

const place = (t: number, cell: number, digit: Digit, extra: Partial<Move> = {}): Move => ({
  t,
  cell,
  kind: "place",
  digit,
  ...extra,
});
/** Клякса + авто-замена в один и тот же `t` (как пишет стор). */
const blot = (t: number, cell: number, wrong: Digit, right: Digit): Move[] => [
  place(t, cell, wrong, { correct: false, blot: true }),
  place(t, cell, right, { correct: true, blot: true }),
];

describe("inkAllows (правила в одном месте)", () => {
  it("undo is never allowed; place/erase only on an empty cell; notes per rules", () => {
    expect(inkAllows("undo", false)).toBe(false);
    expect(inkAllows("undo", true)).toBe(false);
    expect(inkAllows("place", false)).toBe(true);
    expect(inkAllows("place", true)).toBe(false);
    expect(inkAllows("erase", true)).toBe(false);
    expect(inkAllows("erase", false)).toBe(true); // стирание заметок пустой клетки
    expect(inkAllows("note_add", false)).toBe(true);
    expect(inkAllows("note_remove", true)).toBe(false);
    const noNotes: InkRules = { ...INK_RULES, allowNotes: false };
    expect(inkAllows("note_add", false, noNotes)).toBe(false);
  });
});

describe("blot in summary / heatmap / solvingStyle", () => {
  it("one blot = one correction + one mistake, regardless of the auto-replace flag", () => {
    const withReplace: MoveLog = [place(0, 0, 1, { correct: true }), ...blot(1000, 1, 9, 2), place(2000, 2, 3, { correct: true })];
    const s = summary(withReplace);
    expect(s.corrections).toBe(1);
    expect(s.mistakes).toBe(1);
    expect(s.clean).toBe(false);
    // Авто-замена — не действие игрока: 3 постановки (а не 4).
    expect(s.placements).toBe(3);

    const keepWrong: MoveLog = [place(0, 0, 1, { correct: true }), place(1000, 1, 9, { correct: false, blot: true }), place(2000, 2, 3, { correct: true })];
    const k = summary(keepWrong);
    expect(k.corrections).toBe(1);
    expect(k.mistakes).toBe(1);
    expect(k.placements).toBe(3);
  });

  it("n blots = n corrections", () => {
    const log: MoveLog = [...blot(0, 0, 9, 1), ...blot(10, 1, 9, 2), ...blot(20, 2, 9, 3)];
    expect(summary(log).corrections).toBe(3);
    expect(summary(log).mistakes).toBe(3);
  });

  it("old logs without the blot field behave exactly as before (overwrite still +1 once)", () => {
    const log: MoveLog = [place(0, 0, 9, { correct: false }), place(10, 0, 1, { correct: true })];
    const s = summary(log);
    expect(s.corrections).toBe(1);
    expect(s.mistakes).toBe(1);
    expect(s.placements).toBe(2);
  });

  it("heatmap of a blot cell is the moment of the replacement (correct digit); kept blot is null", () => {
    const log: MoveLog = [...blot(5000, 0, 9, 1), place(10000, 1, 2, { correct: true })];
    const h = heatmap(log, { mission: MISSION });
    expect(h[0]).toBe(0.5);
    const kept = heatmap([place(5000, 0, 9, { correct: false, blot: true }), place(10000, 1, 2, { correct: true })], { mission: MISSION });
    expect(kept[0]).toBeNull();
  });

  it("solvingStyle ignores auto-replacements", () => {
    // 4 соседних постановки подряд; клякса в середине не ломает «змейку» дублем клетки.
    const cells = [0, 1, 2, 3, 4];
    const log: Move[] = [];
    let t = 0;
    for (const c of cells) {
      t += 100;
      if (c === 2) log.push(...blot(t, c, 9, 3));
      else log.push(place(t, c, ((c + 1) % 9 || 9) as Digit, { correct: true }));
    }
    expect(solvingStyle(log)).toBe(solvingStyle(log.filter((m) => !(m.blot && m.correct === true)).map((m) => ({ ...m }))));
  });
});

describe("blotsOf", () => {
  it("lists one entry per blot; empty for normal logs", () => {
    expect(blotsOf([place(0, 0, 1, { correct: true })])).toEqual([]);
    expect(blotsOf([...blot(10, 4, 9, 2), ...blot(20, 7, 8, 5)])).toEqual([
      { cell: 4, digit: 9, t: 10 },
      { cell: 7, digit: 8, t: 20 },
    ]);
  });
});

describe("inkViolations", () => {
  const ok: MoveLog = [
    { t: 0, cell: 5, kind: "note_add", digit: 3 },
    place(10, 0, 1, { correct: true }),
    ...blot(20, 1, 9, 2),
    { t: 30, cell: 6, kind: "erase" }, // стирание заметок пустой клетки
  ];

  it("a legal ink log has no violations", () => {
    expect(inkViolations(ok)).toEqual([]);
  });

  it("detects each forbidden move", () => {
    const rule = (log: MoveLog, rules?: InkRules): string[] => inkViolations(log, rules).map((v) => v.rule);
    expect(rule([place(0, 0, 1, { correct: true }), { t: 1, cell: 0, kind: "undo" }])).toContain("undo");
    expect(rule([place(0, 0, 1, { correct: true }), { t: 1, cell: 0, kind: "erase" }])).toContain("erase_filled");
    expect(rule([place(0, 0, 1, { correct: true }), place(1, 0, 2, { correct: true })])).toContain("place_on_filled");
    expect(rule([place(0, 0, 1, { correct: true }), { t: 1, cell: 0, kind: "note_add", digit: 3 }])).toContain("note_on_filled");
    expect(rule([place(0, 0, 9, { correct: false })])).toContain("unmarked_mistake");
    expect(rule([place(0, 0, 9, { correct: false, blot: true }), place(1, 1, 1, { correct: true })])).toContain("blot_without_replacement");
    expect(rule([place(0, 0, 9, { correct: false, blot: true })])).toContain("blot_without_replacement");
    expect(rule([place(0, 0, 1, { correct: true, blot: true })])).toContain("unexpected_replacement");
    expect(rule([{ t: 0, cell: 0, kind: "note_add", digit: 1 }], { ...INK_RULES, allowNotes: false })).toContain("notes_disallowed");
  });

  it("kept-blot variant (autoReplaceBlot = false) is legal without replacement", () => {
    const rules: InkRules = { ...INK_RULES, autoReplaceBlot: false };
    expect(inkViolations([place(0, 0, 9, { correct: false, blot: true })], rules)).toEqual([]);
  });
});
