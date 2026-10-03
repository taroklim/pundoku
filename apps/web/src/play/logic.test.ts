import { heatmap, summary, timelapseFrames } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import {
  candidatesOf,
  deadEndCount,
  cellsLeft,
  closedUnits,
  createPlay,
  digitAt,
  digitCells,
  enterDigit,
  eraseCell,
  fillCandidates,
  firstOpenCell,
  isDigitClosed,
  isGridFull,
  isWrong,
  notesOf,
  peersOf,
  remaining,
  setInkMode,
  toggleNote,
  undo,
  unsettledCells,
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

  it("PD-115: повторная/двойная та же цифра в клетке — no-op (не стирает), стирает только eraseCell", () => {
    const s1 = enterDigit(fresh(), EMPTY_CELL, 4, 100);
    const s2 = enterDigit(s1, EMPTY_CELL, 4, 200);
    expect(s2).toBe(s1); // ни значения, ни лога, ни undo-записи
    expect(s2.values[EMPTY_CELL]).toBe(4);
    expect(s2.log.map((m) => m.kind)).toEqual(["place"]);
    // «нервный» тап: чётное число касаний больше не оставляет пустую клетку
    let s = s1;
    for (let k = 0; k < 6; k++) s = enterDigit(s, EMPTY_CELL, 4, 300 + k);
    expect(s.values[EMPTY_CELL]).toBe(4);
    // неверная цифра тоже не стирается повтором
    const w1 = enterDigit(fresh(), EMPTY_CELL, 1, 100);
    expect(enterDigit(w1, EMPTY_CELL, 1, 200)).toBe(w1);
    // а явное стирание работает
    const erased = eraseCell(s1, EMPTY_CELL, 400);
    expect(erased.values[EMPTY_CELL]).toBe(0);
    expect(erased.log.map((m) => m.kind)).toEqual(["place", "erase"]);
  });

  it("PD-115: другая цифра заменяет поставленную (замена, не стирание)", () => {
    const s = enterDigit(enterDigit(fresh(), EMPTY_CELL, 4, 100), EMPTY_CELL, 7, 200);
    expect(s.values[EMPTY_CELL]).toBe(7);
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

  it("PD-118: любая поставленная цифра (и верная, и неверная) уменьшает оба счётчика — счёт по доске, не по решению", () => {
    const s0 = fresh();
    const s1 = enterDigit(s0, EMPTY_CELL, 4, 1);
    expect(cellsLeft(s1)).toBe(cellsLeft(s0) - 1);
    expect(remaining(s1)[4]).toBe(remaining(s0)[4]! - 1);
    // неверная единица: пустых клеток меньше на одну, у цифры 1 остаток меньше, у верной 4 — прежний
    const s2 = enterDigit(s0, EMPTY_CELL, 1, 1);
    expect(cellsLeft(s2)).toBe(cellsLeft(s0) - 1);
    expect(remaining(s2)[1]).toBe(remaining(s0)[1]! - 1);
    expect(remaining(s2)[4]).toBe(remaining(s0)[4]);
  });

  it("PD-118: замена цифры в клетке переносит остаток с одной цифры на другую, cells left не меняется", () => {
    const s1 = enterDigit(fresh(), EMPTY_CELL, 1, 1);
    const s2 = enterDigit(s1, EMPTY_CELL, 4, 2); // исправили ошибку
    expect(cellsLeft(s2)).toBe(cellsLeft(s1));
    expect(remaining(s2)[1]).toBe(remaining(fresh())[1]);
    expect(remaining(s2)[4]).toBe(remaining(fresh())[4]! - 1);
    expect(cellsLeft(s2)).toBe(cellsLeft(fresh()) - 1);
  });

  it("PD-118: стирание возвращает счёт; остаток не уходит ниже нуля", () => {
    let s = enterDigit(fresh(), EMPTY_CELL, 1, 1);
    s = eraseCell(s, EMPTY_CELL, 2);
    expect(cellsLeft(s)).toBe(cellsLeft(fresh()));
    // десятая «1» (две лишние в разных юнитах): остаток зажат на 0
    let p = fresh();
    const open = [...Array(81).keys()].filter((i) => MISSION[i] === "0");
    for (const i of open.slice(0, 12)) p = enterDigit(p, i, 1, 5);
    expect(Math.min(...remaining(p).slice(1))).toBeGreaterThanOrEqual(0);
  });

  it("PD-118/117: cells left = 0 при заполненной сетке с ошибкой; решено — только при всех верных", () => {
    let s = fresh();
    const open = [...Array(81).keys()].filter((i) => MISSION[i] === "0");
    for (const i of open) s = enterDigit(s, i, i === EMPTY_CELL ? 1 : (s.solution[i] as number), 10);
    expect(cellsLeft(s)).toBe(0);
    expect(s.solved).toBe(false);
    expect(isGridFull(s)).toBe(true);
    expect(unsettledCells(s)).toBe(1); // «верность» считает отдельная функция (Year)
    s = enterDigit(s, EMPTY_CELL, 4, 20);
    expect(s.solved).toBe(true);
    expect(isGridFull(s)).toBe(false);
  });

  it("M8: цифра «закрыта» только когда все девять верны (isDigitClosed), даже если остаток уже 0", () => {
    let s = fresh();
    const open = [...Array(81).keys()].filter((i) => MISSION[i] === "0" && SOLUTION[i] === "4");
    for (const i of open) s = enterDigit(s, i, 4, 5);
    expect(isDigitClosed(s, 4)).toBe(true);
    // ставим четвёрку и в чужую клетку: остаток 0 остаётся, но «закрыта верно» — нет только если стоящие неверны
    const wrongOne = [...Array(81).keys()].find((i) => MISSION[i] === "0" && SOLUTION[i] !== "4")!;
    const w = enterDigit(fresh(), wrongOne, 4, 5);
    expect(remaining(w)[4]).toBe(remaining(fresh())[4]! - 1);
    expect(isDigitClosed(w, 4)).toBe(false);
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

describe("PD-119: автоочистка соседних кандидатов", () => {
  const isEmpty = (s: ReturnType<typeof fresh>, i: number) => !s.mission[i] && !s.values[i];
  /** Во всех пустых клетках доски — заметки {4, 6} (ручные). */
  const withNotes46 = () => {
    let s = fresh();
    let t = 0;
    for (let i = 0; i < 81; i++) {
      if (!isEmpty(s, i) || i === EMPTY_CELL) continue;
      s = toggleNote(toggleNote(s, i, 4, (t += 10)), i, 6, (t += 10));
    }
    return s;
  };

  it("peersOf: 20 соседей по строке/столбцу/блоку, без самой клетки", () => {
    for (const c of [0, 2, 40, 80]) {
      const p = peersOf(c);
      expect(p).toHaveLength(20);
      expect(p).not.toContain(c);
      expect(new Set(p).size).toBe(20);
    }
    expect(peersOf(0)).toContain(8); // строка
    expect(peersOf(0)).toContain(72); // столбец
    expect(peersOf(0)).toContain(20); // блок
    expect(peersOf(0)).not.toContain(30);
  });

  it("цифра убирается из заметок ТОЛЬКО у соседей; чужие кандидаты и не-соседи не тронуты; свои заметки сброшены", () => {
    const s0 = toggleNote(withNotes46(), EMPTY_CELL, 9, 5000); // свои заметки клетки — уйдут при постановке
    const s = enterDigit(s0, EMPTY_CELL, 4, 6000, undefined, true);
    const peers = new Set(peersOf(EMPTY_CELL));
    for (let i = 0; i < 81; i++) {
      if (i === EMPTY_CELL || !isEmpty(s0, i)) continue;
      expect(notesOf(s.notes[i] ?? 0)).toEqual(peers.has(i) ? [6] : [4, 6]);
    }
    expect(s.notes[EMPTY_CELL]).toBe(0);
    expect(s.values[EMPTY_CELL]).toBe(4);
  });

  it("по умолчанию выключено на уровне логики: соседние заметки остаются (как до PD-119)", () => {
    const s0 = withNotes46();
    const s = enterDigit(s0, EMPTY_CELL, 4, 6000);
    expect(s.notes.map((m, i) => (i === EMPTY_CELL ? 0 : m))).toEqual(s0.notes.map((m, i) => (i === EMPTY_CELL ? 0 : m)));
    expect(s.undoStack.at(-1)).not.toHaveProperty("also");
  });

  it("один шаг undo откатывает ход И очистку: заметки соседей вернулись, лог — place + undo, правки как у обычного хода", () => {
    const s0 = withNotes46();
    const s1 = enterDigit(s0, EMPTY_CELL, 4, 6000, undefined, true);
    expect(s1.undoStack).toHaveLength(s0.undoStack.length + 1); // одна запись, не «ход + N очисток»
    expect(s1.log.map((m) => m.kind)).toEqual([...s0.log.map((m) => m.kind), "place"]);
    const s2 = undo(s1, 7000);
    expect(s2.notes).toEqual(s0.notes);
    expect(s2.values).toEqual(s0.values);
    expect(s2.undoStack).toEqual(s0.undoStack);
    expect(s2.log.at(-1)).toMatchObject({ kind: "undo", cell: EMPTY_CELL });
    // счёт правок как у обычной постановки с откатом (очистка заметок в логе не видна и ничего не добавляет)
    expect(summary(s2.log).corrections).toBe(summary(undo(enterDigit(s0, EMPTY_CELL, 4, 6000), 7000).log).corrections);
  });

  it("цепочка: два хода с очисткой и два undo подряд возвращают исходные заметки пошагово", () => {
    const s0 = withNotes46();
    const s1 = enterDigit(s0, EMPTY_CELL, 4, 6000, undefined, true);
    const s2 = enterDigit(s1, OTHER_EMPTY, 6, 7000, undefined, true);
    expect(s2.undoStack).toHaveLength(s0.undoStack.length + 2);
    const u1 = undo(s2, 8000);
    expect(u1.notes).toEqual(s1.notes);
    expect(undo(u1, 9000).notes).toEqual(s0.notes);
  });

  it("НЕ оракул: неверная цифра чистит соседей так же, как верная (ход определяется доской, а не решением)", () => {
    const s0 = withNotes46();
    const right = enterDigit(s0, EMPTY_CELL, 4, 6000, undefined, true); // верная
    const wrong = enterDigit(s0, EMPTY_CELL, 1, 6000, undefined, true); // неверная (решение 4)
    expect(isWrong(wrong, EMPTY_CELL)).toBe(true);
    // 4 убрана у соседей при верной; при неверной убирается 1 — у соседей её не было, а 4 остаётся: сравниваем «форму» очистки
    const changed = (a: typeof s0, b: typeof s0) => a.notes.map((m, i) => (m === b.notes[i] ? -1 : i)).filter((i) => i >= 0);
    const peersWith = (d: number) => peersOf(EMPTY_CELL).filter((i) => isEmpty(s0, i) && ((s0.notes[i] ?? 0) & (1 << d)) !== 0);
    expect(changed(s0, right).filter((i) => i !== EMPTY_CELL)).toEqual(peersWith(4));
    expect(changed(s0, wrong).filter((i) => i !== EMPTY_CELL)).toEqual(peersWith(1));
    // та же цифра 4, но поставленная на неверное место (клетка 3 — решение 6), очищает соседей точно так же
    const wrong4 = enterDigit(s0, OTHER_EMPTY, 4, 6000, undefined, true);
    expect(isWrong(wrong4, OTHER_EMPTY)).toBe(true);
    expect(changed(s0, wrong4).filter((i) => i !== OTHER_EMPTY)).toEqual(peersWith4(s0, OTHER_EMPTY));
  });

  it("ink: автоочистки нет даже при включённой настройке — заметки ручные", () => {
    const base = setInkMode(fresh(), true);
    const s0 = toggleNote(toggleNote(base, OTHER_EMPTY, 4, 100), 11, 4, 200);
    const s = enterDigit(s0, EMPTY_CELL, 4, 300, undefined, true);
    expect(notesOf(s.notes[OTHER_EMPTY] ?? 0)).toContain(4);
    expect(notesOf(s.notes[11] ?? 0)).toContain(4);
    expect(s.undoStack).toHaveLength(0); // в ink undo нет
  });

  it("журнал, тепловая карта и таймлапс не замечают очистку (формат лога прежний)", () => {
    let s = withNotes46();
    let t = 10000;
    for (let i = 0; i < 81; i++) if (isEmpty(s, i)) s = enterDigit(s, i, s.solution[i]!, (t += 1000), undefined, true);
    expect(s.solved).toBe(true);
    expect(s.log.filter((m) => m.kind === "place")).toHaveLength(MISSION.split("0").length - 1);
    expect(summary(s.log).clean).toBe(true);
    const ctx = { mission: s.mission.join(""), solution: s.solution.join("") };
    expect(heatmap(s.log, ctx)).toHaveLength(81);
    expect(timelapseFrames(s.log, ctx).frames.length).toBeGreaterThan(0);
  });
});

/** Соседи `cell` с цифрой `d` в заметках, пустые клетки игрока. */
function peersWith4(s: ReturnType<typeof createPlay>, cell: number): number[] {
  return peersOf(cell).filter((i) => !s.mission[i] && !s.values[i] && ((s.notes[i] ?? 0) & (1 << 4)) !== 0);
}

describe("PD-119: Fill candidates", () => {
  const empties = (s: ReturnType<typeof fresh>) => [...s.mission.keys()].filter((i) => !s.mission[i] && !s.values[i]);

  it("candidatesOf: по доске (заданные и цифры игрока, в т. ч. неверные), решение не используется", () => {
    const s0 = fresh();
    // клетка 2 (строка 0: 5,3 · столбец 2: 8 · блок 0: 5,3,6,9,8): кандидатов {1,2,4,7}
    expect(notesOf(candidatesOf(s0, EMPTY_CELL))).toEqual([1, 2, 4]);
    const s1 = enterDigit(s0, OTHER_EMPTY, 1, 100); // неверная 1 в строке 0 (решение клетки 3 — 6): кандидатов стало меньше
    expect(notesOf(candidatesOf(s1, EMPTY_CELL))).toEqual([2, 4]);
  });

  it("заполняет все пустые клетки без заметок их кандидатами; чужие заметки и заданные клетки не трогает", () => {
    let s0 = toggleNote(fresh(), EMPTY_CELL, 7, 100); // ручная заметка — святое
    s0 = toggleNote(s0, EMPTY_CELL, 4, 200);
    const s = fillCandidates(s0, 1000);
    for (const i of empties(s0)) {
      if (i === EMPTY_CELL) expect(notesOf(s.notes[i] ?? 0)).toEqual([4, 7]);
      else expect(s.notes[i]).toBe(candidatesOf(s0, i));
    }
    for (let i = 0; i < 81; i++) if (s0.mission[i]) expect(s.notes[i]).toBe(0);
    expect(s.values).toEqual(s0.values);
  });

  it("PD-143 b: deadEndCount — пустые клетки без заметок и без кандидатов; Fill их пропускает", () => {
    let s0 = fresh();
    expect(deadEndCount(s0)).toBe(0);
    for (const [cell, d] of [[5, 1], [6, 2], [7, 4]] as const) s0 = enterDigit(s0, cell, d, 100 + cell); // неверные 1,2,4 в строке клетки 2
    expect(candidatesOf(s0, EMPTY_CELL)).toBe(0);
    const dead = deadEndCount(s0);
    expect(dead).toBeGreaterThanOrEqual(1);
    const s1 = fillCandidates(s0, 1000);
    expect(s1.notes[EMPTY_CELL]).toBe(0);
    expect(deadEndCount(s1)).toBe(dead);
  });

  it("одно действие — один undo: откат возвращает ВСЕ клетки; в логе один служебный note_add и один undo, правок 0", () => {
    const s0 = toggleNote(fresh(), OTHER_EMPTY, 6, 100);
    const s1 = fillCandidates(s0, 1000);
    expect(s1.undoStack).toHaveLength(s0.undoStack.length + 1);
    expect(s1.log).toHaveLength(s0.log.length + 1);
    expect(s1.log.at(-1)).toMatchObject({ kind: "note_add" });
    const s2 = undo(s1, 2000);
    expect(s2.notes).toEqual(s0.notes);
    expect(s2.undoStack).toEqual(s0.undoStack);
    expect(s2.log.at(-1)).toMatchObject({ kind: "undo" });
    expect(summary(s2.log).corrections).toBe(0);
  });

  it("после Fill автоочистка ведёт заметки дальше: цифра убирается у соседей, один undo откатывает ход, второй — Fill", () => {
    const s1 = fillCandidates(fresh(), 1000);
    const s2 = enterDigit(s1, EMPTY_CELL, 4, 2000, undefined, true);
    for (const i of peersOf(EMPTY_CELL)) expect(notesOf(s2.notes[i] ?? 0)).not.toContain(4);
    const u1 = undo(s2, 3000);
    expect(u1.notes).toEqual(s1.notes);
    expect(undo(u1, 4000).notes).toEqual(fresh().notes);
  });

  it("повторный Fill, ink, решённая партия и тупик без кандидатов — no-op без записи в лог", () => {
    const s1 = fillCandidates(fresh(), 1000);
    expect(fillCandidates(s1, 2000)).toBe(s1); // нечего заполнять: везде уже есть заметки
    const ink = setInkMode(fresh(), true);
    expect(fillCandidates(ink, 100)).toBe(ink);
    let solved = fresh();
    let t = 0;
    for (let i = 0; i < 81; i++) if (!solved.mission[i]) solved = enterDigit(solved, i, solved.solution[i]!, (t += 10));
    expect(solved.solved).toBe(true);
    expect(fillCandidates(solved, t + 10)).toBe(solved);
  });

  it("журнал/тепловая карта/таймлапс совместимы: Fill посреди партии не ломает расчёты движка", () => {
    let s = fillCandidates(fresh(), 500);
    let t = 1000;
    for (const i of empties(s)) s = enterDigit(s, i, s.solution[i]!, (t += 1000), undefined, true);
    expect(s.solved).toBe(true);
    expect(summary(s.log).clean).toBe(true);
    const ctx = { mission: s.mission.join(""), solution: s.solution.join("") };
    expect(timelapseFrames(s.log, ctx).frames.length).toBeGreaterThan(0);
    expect(heatmap(s.log, ctx)).toHaveLength(81);
  });
});
