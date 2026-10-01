import { summary } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import {
  cellsLeft,
  closedUnits,
  createPlay,
  digitAt,
  digitCells,
  enterDigit,
  eraseCell,
  firstOpenCell,
  isWrong,
  notesOf,
  remaining,
  toggleNote,
  undo,
  waveOf,
} from "./logic";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const fresh = () => createPlay({ mission: MISSION, solution: SOLUTION });
const EMPTY_CELL = 2; // решение 4
const OTHER_EMPTY = 3; // решение 6

describe("ввод", () => {
  it("верная цифра ставится, заданная клетка неизменна", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 4, 100);
    expect(s.values[EMPTY_CELL]).toBe(4);
    expect(isWrong(s, EMPTY_CELL)).toBe(false);
    const before = s;
    s = enterDigit(s, 0, 9, 200); // клетка 0 — given
    expect(s).toBe(before);
    expect(eraseCell(s, 0, 300)).toBe(before);
  });

  it("неверная цифра подсвечивается как ошибка и логируется с correct=false", () => {
    const s = enterDigit(fresh(), EMPTY_CELL, 1, 100);
    expect(isWrong(s, EMPTY_CELL)).toBe(true);
    expect(s.log[0]).toMatchObject({ kind: "place", cell: EMPTY_CELL, digit: 1, correct: false });
    expect(summary(s.log).mistakes).toBe(1);
  });

  it("повторная та же цифра стирает клетку (как в макете)", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 4, 100);
    s = enterDigit(s, EMPTY_CELL, 4, 200);
    expect(s.values[EMPTY_CELL]).toBe(0);
    expect(s.log.map((m) => m.kind)).toEqual(["place", "erase"]);
  });

  it("цифра в клетке стирает её заметки; заметки в клетке с цифрой не ставятся", () => {
    let s = toggleNote(fresh(), EMPTY_CELL, 4, 10);
    s = toggleNote(s, EMPTY_CELL, 9, 20);
    expect(notesOf(s.notes[EMPTY_CELL] as number)).toEqual([4, 9]);
    s = enterDigit(s, EMPTY_CELL, 4, 30);
    expect(s.notes[EMPTY_CELL]).toBe(0);
    const same = toggleNote(s, EMPTY_CELL, 7, 40);
    expect(same).toBe(s);
  });

  it("заметка: повторный ввод снимает, лог note_add / note_remove", () => {
    let s = toggleNote(fresh(), EMPTY_CELL, 4, 10);
    s = toggleNote(s, EMPTY_CELL, 4, 20);
    expect(s.notes[EMPTY_CELL]).toBe(0);
    expect(s.log.map((m) => m.kind)).toEqual(["note_add", "note_remove"]);
  });

  it("стирание пустой клетки — не действие и не логируется", () => {
    const s = fresh();
    expect(eraseCell(s, EMPTY_CELL, 5)).toBe(s);
  });

  it("время хода не убывает, даже если пришло меньшее t", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 4, 500);
    s = enterDigit(s, OTHER_EMPTY, 6, 100);
    expect(s.log.map((m) => m.t)).toEqual([500, 500]);
  });
});

describe("остатки и cells left", () => {
  it("на старте: cells left = число пустых, остаток цифры = 9 - givens", () => {
    const s = fresh();
    const empties = [...MISSION].filter((c) => c === "0").length;
    expect(cellsLeft(s)).toBe(empties);
    const left = remaining(s);
    for (let d = 1; d <= 9; d++) {
      const givens = [...MISSION].filter((c) => c === String(d)).length;
      expect(left[d]).toBe(9 - givens);
    }
  });

  it("верная цифра уменьшает оба счётчика, неверная — ни один", () => {
    const s0 = fresh();
    const s1 = enterDigit(s0, EMPTY_CELL, 4, 1);
    expect(cellsLeft(s1)).toBe(cellsLeft(s0) - 1);
    expect(remaining(s1)[4]).toBe(remaining(s0)[4]! - 1);
    const s2 = enterDigit(s0, EMPTY_CELL, 1, 1);
    expect(cellsLeft(s2)).toBe(cellsLeft(s0));
    expect(remaining(s2)).toEqual(remaining(s0));
  });

  it("исправление неверной цифры на верную возвращает счёт", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 1, 1);
    s = enterDigit(s, EMPTY_CELL, 4, 2);
    expect(cellsLeft(s)).toBe(cellsLeft(fresh()) - 1);
  });
});

describe("undo — зеркало контракта движка", () => {
  it("place → erase → undo: цифра вернулась, лог чистый (corrections 0)", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 4, 10);
    s = eraseCell(s, EMPTY_CELL, 20);
    expect(s.values[EMPTY_CELL]).toBe(0);
    s = undo(s, 30);
    expect(s.values[EMPTY_CELL]).toBe(4);
    expect(s.log.map((m) => m.kind)).toEqual(["place", "erase", "undo"]);
    const sum = summary(s.log);
    expect(sum.corrections).toBe(0);
    expect(sum.clean).toBe(true);
    expect(sum.placements).toBe(1);
  });

  it("place → erase → undo → undo: клетка пуста, правок 1", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 4, 10);
    s = eraseCell(s, EMPTY_CELL, 20);
    s = undo(undo(s, 30), 40);
    expect(s.values[EMPTY_CELL]).toBe(0);
    expect(summary(s.log)).toMatchObject({ corrections: 1, placements: 0 });
  });

  it("перезапись и undo возвращают прежнюю цифру", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 1, 10);
    s = enterDigit(s, EMPTY_CELL, 4, 20);
    s = undo(s, 30);
    expect(s.values[EMPTY_CELL]).toBe(1);
    expect(summary(s.log)).toMatchObject({ corrections: 1, mistakes: 1 });
  });

  it("note → undo снимает заметку, правок 0", () => {
    let s = toggleNote(fresh(), EMPTY_CELL, 4, 10);
    s = undo(s, 20);
    expect(s.notes[EMPTY_CELL]).toBe(0);
    expect(summary(s.log)).toMatchObject({ corrections: 0, clean: true });
  });

  it("стирание вместе с заметками: undo возвращает заметки целиком", () => {
    let s = toggleNote(toggleNote(fresh(), EMPTY_CELL, 4, 1), EMPTY_CELL, 9, 2);
    s = eraseCell(s, EMPTY_CELL, 3);
    expect(s.notes[EMPTY_CELL]).toBe(0);
    s = undo(s, 4);
    expect(notesOf(s.notes[EMPTY_CELL] as number)).toEqual([4, 9]);
  });

  it("цифра поверх заметок: undo возвращает заметки", () => {
    let s = toggleNote(fresh(), EMPTY_CELL, 4, 1);
    s = enterDigit(s, EMPTY_CELL, 4, 2);
    s = undo(s, 3);
    expect(s.values[EMPTY_CELL]).toBe(0);
    expect(notesOf(s.notes[EMPTY_CELL] as number)).toEqual([4]);
  });

  it("undo при пустом стеке — no-op и не пишется в лог", () => {
    const s = fresh();
    expect(undo(s, 5)).toBe(s);
  });

  it("place другой клетки, note, undo: постановка остаётся, правок 0", () => {
    let s = enterDigit(fresh(), OTHER_EMPTY, 6, 1);
    s = toggleNote(s, EMPTY_CELL, 4, 2);
    s = undo(s, 3);
    expect(s.values[OTHER_EMPTY]).toBe(6);
    expect(summary(s.log)).toMatchObject({ corrections: 0, placements: 1 });
  });
});

describe("юниты и решено", () => {
  it("строка закрывается верной цифрой в последней пустой клетке", () => {
    let s = fresh();
    const row0 = [2, 3, 5, 6, 7, 8]; // пустые клетки строки 0
    for (const c of row0.slice(0, -1)) s = enterDigit(s, c, s.solution[c] as number, 1);
    expect(closedUnits(s, 8).some((u) => u[0] === 0 && u[1] === 1)).toBe(false);
    s = enterDigit(s, 8, s.solution[8] as number, 2);
    expect(closedUnits(s, 8).some((u) => u.join() === [0, 1, 2, 3, 4, 5, 6, 7, 8].join())).toBe(true);
  });

  it("сетка решена, когда все клетки верны; после решения ввод заблокирован", () => {
    let s = fresh();
    for (let i = 0; i < 81; i++) if (!s.mission[i]) s = enterDigit(s, i, s.solution[i] as number, i + 1);
    expect(s.solved).toBe(true);
    expect(cellsLeft(s)).toBe(0);
    expect(eraseCell(s, EMPTY_CELL, 999)).toBe(s);
    expect(undo(s, 999)).toBe(s);
    expect(digitAt(s, EMPTY_CELL)).toBe(4);
    expect(summary(s.log).clean).toBe(true);
  });

  it("firstOpenCell — первая пустая клетка", () => {
    expect(firstOpenCell(fresh())).toBe(2);
  });
});

describe("PD-89: волна и эхо цифры", () => {
  const row0 = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const col2 = [2, 11, 20, 29, 38, 47, 56, 65, 74];

  it("waveOf: шаг клетки — расстояние от поставленной по юниту; общая клетка берёт минимум", () => {
    const w = waveOf([row0], 2);
    expect(w.cells).toEqual(row0);
    expect(w.steps).toEqual([2, 1, 0, 1, 2, 3, 4, 5, 6]);
    const both = waveOf([row0, col2], 2);
    expect(both.cells.length).toBe(17); // клетка 2 общая
    expect(both.steps[both.cells.indexOf(2)]).toBe(0);
    expect(both.steps[both.cells.indexOf(11)]).toBe(1);
    expect(both.steps[both.cells.indexOf(0)]).toBe(2);
  });

  it("digitCells: заданные по номеру, затем цифры игрока в порядке постановки", () => {
    let s = fresh();
    // Цифра 4: решение ставит её в клетках 2 (пусто), 12?; соберём все по решению.
    const cells = [...Array(81).keys()].filter((i) => s.solution[i] === 4);
    const open = cells.filter((i) => !s.mission[i]);
    const given = cells.filter((i) => s.mission[i]);
    [...open].reverse().forEach((c, k) => {
      s = enterDigit(s, c, 4, k + 1);
    });
    const out = digitCells(s, 4);
    expect(out).toHaveLength(9);
    expect(out.slice(0, given.length)).toEqual(given);
    expect(out.slice(given.length)).toEqual([...open].reverse());
  });
});
