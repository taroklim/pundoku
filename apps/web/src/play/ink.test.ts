/**
 * Чернильный режим (PD-71): правила на уровне логики партии (без UI). Ключевые правила покрыты так, чтобы
 * «сломанное» правило роняло тест (мутационная проверка — docs/pd-71-ink-rules.md § «Проверка мутациями»).
 */
import { INK_RULES, blotsOf, inkViolations, solvingStyle, summary } from "@pundoku/engine";
import type { InkRules } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import {
  blotsIn,
  cellsLeft,
  createPlay,
  enterDigit,
  eraseCell,
  isBlotCell,
  isInk,
  remaining,
  setInkMode,
  toggleNote,
  undo,
} from "./logic";
import type { PlayState } from "./logic";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const EMPTIES = [...MISSION].map((g, i) => (g === "0" ? i : -1)).filter((i) => i >= 0);
const wrongFor = (s: PlayState, cell: number): number => ((s.solution[cell] as number) % 9) + 1;

const fresh = () => createPlay({ mission: MISSION, solution: SOLUTION });
const ink = () => setInkMode(fresh(), true);
const KEEP: InkRules = { ...INK_RULES, autoReplaceBlot: false };
const [A, B, C] = EMPTIES as [number, number, number];

describe("вход в режим: только до первой цифры", () => {
  it("включается и выключается на пустом логе; по умолчанию режим выключен", () => {
    expect(isInk(fresh())).toBe(false);
    const on = ink();
    expect(isInk(on)).toBe(true);
    expect(isInk(setInkMode(on, false))).toBe(false);
    expect("ink" in setInkMode(on, false)).toBe(false); // обычная партия = как до PD-71
    expect(setInkMode(on, true)).toBe(on);
  });

  it("после первого хода режим не переключается ни в одну сторону", () => {
    const moved = enterDigit(fresh(), A, SOLUTION.charCodeAt(A) - 48, 100);
    expect(setInkMode(moved, true)).toBe(moved);
    expect(isInk(setInkMode(moved, true))).toBe(false);
    const inkMoved = enterDigit(ink(), A, SOLUTION.charCodeAt(A) - 48, 100);
    expect(isInk(setInkMode(inkMoved, false))).toBe(true);
  });

  it("PD-121 (C3): заметка не ход для выбора чернил — после неё режим ещё можно включить; цифра (даже снятая undo) закрывает выбор", () => {
    const noted = toggleNote(fresh(), A, 1, 50);
    expect(noted.log).toHaveLength(1);
    const on = setInkMode(noted, true);
    expect(isInk(on)).toBe(true);
    expect(on.log).toBe(noted.log); // заметка осталась в логе, партия та же
    expect(isInk(setInkMode(on, false))).toBe(false);
    const placed = enterDigit(noted, B, SOLUTION.charCodeAt(B) - 48, 90);
    expect(setInkMode(placed, true)).toBe(placed);
    const undone = undo(placed, 95);
    expect(undone.log.some((m) => m.kind === "place")).toBe(true);
    expect(setInkMode(undone, true)).toBe(undone);
  });

  it("решённую партию не переключить", () => {
    let s = fresh();
    for (const i of EMPTIES) s = enterDigit(s, i, s.solution[i]!, 10);
    expect(s.solved).toBe(true);
    expect(setInkMode(s, true)).toBe(s);
  });
});

describe("ink: undo и стирание цифр отвергаются самой логикой", () => {
  it("undo — no-op: состояние и лог те же, стек undo пуст", () => {
    let s = enterDigit(ink(), A, s0(A), 100);
    expect(s.undoStack).toHaveLength(0);
    const before = s;
    s = undo(s, 200);
    expect(s).toBe(before);
    expect(s.values[A]).toBe(s0(A));
  });

  it("второй рубеж: даже при непустом стеке undo (повреждённое/чужое состояние) ink-партия не откатывается", () => {
    const placed = enterDigit(ink(), A, s0(A), 100);
    const tampered: PlayState = { ...placed, undoStack: [{ cell: A, prevValue: 0, prevNotes: 0 }] };
    expect(undo(tampered, 200)).toBe(tampered);
  });

  it("стереть цифру нельзя (ни eraseCell, ни повторное нажатие той же цифры)", () => {
    const placed = enterDigit(ink(), A, s0(A), 100);
    expect(eraseCell(placed, A, 200)).toBe(placed);
    expect(enterDigit(placed, A, s0(A), 300)).toBe(placed); // в обычной партии это стирание
    expect(placed.values[A]).toBe(s0(A));
    expect(placed.log).toHaveLength(1);
  });

  it("в обычной партии то же самое работает как раньше (режим не протекает)", () => {
    let s = enterDigit(fresh(), A, s0(A), 100);
    const erased = eraseCell(s, A, 200);
    expect(erased.values[A]).toBe(0);
    s = undo(erased, 300);
    expect(s.values[A]).toBe(s0(A));
  });

  it("перезаписать верную цифру другой нельзя (перезапись = скрытое стирание)", () => {
    const placed = enterDigit(ink(), A, s0(A), 100);
    expect(enterDigit(placed, A, wrongFor(placed, A), 200)).toBe(placed);
  });

  it("заданная клетка (given) по-прежнему недоступна", () => {
    const s = ink();
    expect(enterDigit(s, 0, 9, 10)).toBe(s);
  });
});

describe("ink: заметки разрешены, стирание заметок пустой клетки тоже", () => {
  it("note_add / note_remove работают и попадают в лог", () => {
    let s = toggleNote(ink(), A, 1, 10);
    s = toggleNote(s, A, 1, 20);
    expect(s.log.map((m) => m.kind)).toEqual(["note_add", "note_remove"]);
    expect(s.undoStack).toHaveLength(0); // undo нет и для заметок
    expect(inkViolations(s.log)).toEqual([]);
  });

  it("erase пустой клетки с заметками очищает заметки; цифры не касается", () => {
    let s = toggleNote(ink(), A, 1, 10);
    s = toggleNote(s, A, 2, 20);
    s = eraseCell(s, A, 30);
    expect(s.notes[A]).toBe(0);
    expect(s.log.at(-1)?.kind).toBe("erase");
    expect(inkViolations(s.log)).toEqual([]);
  });

  it("заметки гаснут при постановке цифры и в заполненной клетке не ставятся", () => {
    let s = toggleNote(ink(), A, 1, 10);
    s = enterDigit(s, A, s0(A), 20);
    expect(s.notes[A]).toBe(0);
    expect(toggleNote(s, A, 3, 30)).toBe(s);
  });

  it("правило allowNotes = false отвергает заметки", () => {
    const noNotes: InkRules = { ...INK_RULES, allowNotes: false };
    const s = ink();
    expect(toggleNote(s, A, 1, 10, noNotes)).toBe(s);
  });
});

describe("ink: ошибка = клякса", () => {
  it("неверная цифра: лог wrong+blot → right+blot (один t), клетка закрыта верной цифрой", () => {
    const w = wrongFor(fresh(), A);
    const s = enterDigit(ink(), A, w, 1234);
    expect(s.log).toEqual([
      { t: 1234, cell: A, kind: "place", digit: w, correct: false, blot: true },
      { t: 1234, cell: A, kind: "place", digit: s0(A), correct: true, blot: true },
    ]);
    expect(s.values[A]).toBe(s0(A));
    expect(blotsIn(s)).toEqual([{ cell: A, digit: w, t: 1234 }]);
    expect(isBlotCell(s, A)).toBe(true);
    expect(isBlotCell(s, B)).toBe(false);
    expect(inkViolations(s.log)).toEqual([]);
  });

  it("каждая клякса — ровно 1 correction и 1 mistake, hadCorrections-признак (!clean) взведён", () => {
    let s = ink();
    s = enterDigit(s, A, wrongFor(s, A), 10);
    let sum = summary(s.log);
    expect([sum.corrections, sum.mistakes, sum.clean]).toEqual([1, 1, false]);
    s = enterDigit(s, B, wrongFor(s, B), 20);
    s = enterDigit(s, C, wrongFor(s, C), 30);
    sum = summary(s.log);
    expect([sum.corrections, sum.mistakes, sum.placements]).toEqual([3, 3, 3]);
    expect(blotsOf(s.log)).toHaveLength(3);
  });

  it("партия без ошибок в ink — чистая (corrections 0, clean)", () => {
    let s = ink();
    for (const i of EMPTIES) s = enterDigit(s, i, s.solution[i]!, 10);
    expect(s.solved).toBe(true);
    const sum = summary(s.log);
    expect([sum.corrections, sum.mistakes, sum.clean]).toEqual([0, 0, true]);
  });

  it("клетка-клякса заблокирована: правка, стирание, заметки, undo — no-op", () => {
    const s = enterDigit(ink(), A, wrongFor(fresh(), A), 10);
    expect(enterDigit(s, A, 1, 20)).toBe(s);
    expect(enterDigit(s, A, s0(A), 20)).toBe(s);
    expect(eraseCell(s, A, 20)).toBe(s);
    expect(toggleNote(s, A, 5, 20)).toBe(s);
    expect(undo(s, 20)).toBe(s);
  });

  it("клякса на последней клетке: партия решена, лог оканчивается парой blot", () => {
    let s = ink();
    for (const i of EMPTIES.slice(0, -1)) s = enterDigit(s, i, s.solution[i]!, 10);
    const last = EMPTIES.at(-1)!;
    expect(s.solved).toBe(false);
    s = enterDigit(s, last, wrongFor(s, last), 99);
    expect(s.solved).toBe(true);
    expect(cellsLeft(s)).toBe(0);
    expect(s.log.slice(-2).map((m) => [m.cell, m.correct, m.blot])).toEqual([
      [last, false, true],
      [last, true, true],
    ]);
  });

  it("полная партия с 3 ошибками решается до конца, лог чист по правилам, счётчики сходятся", () => {
    let s = ink();
    let t = 0;
    const wrongAt = new Set([EMPTIES[3], EMPTIES[20], EMPTIES[40]]);
    for (const i of EMPTIES) {
      t += 500;
      s = enterDigit(s, i, wrongAt.has(i) ? wrongFor(s, i) : s.solution[i]!, t);
    }
    expect(s.solved).toBe(true);
    expect(cellsLeft(s)).toBe(0);
    expect(remaining(s).slice(1).every((n) => n === 0)).toBe(true);
    expect(inkViolations(s.log)).toEqual([]);
    const sum = summary(s.log);
    expect([sum.corrections, sum.mistakes, sum.placements]).toEqual([3, 3, EMPTIES.length]);
    expect(blotsIn(s)).toHaveLength(3);
    expect(["scanner", "blocker", "snake", "sniper"]).toContain(solvingStyle(s.log));
  });
});

describe("флаг autoReplaceBlot = false: неверная цифра остаётся, клетка закрыта, партия завершаема", () => {
  it("клякса остаётся в клетке и блокируется", () => {
    const w = wrongFor(fresh(), A);
    const s = enterDigit(ink(), A, w, 10, KEEP);
    expect(s.values[A]).toBe(w);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]).toMatchObject({ correct: false, blot: true });
    expect(enterDigit(s, A, s0(A), 20, KEEP)).toBe(s);
    expect(summary(s.log).corrections).toBe(1);
    expect(inkViolations(s.log, KEEP)).toEqual([]);
  });

  it("с тремя кляксами партия решается (клетка-клякса считается закрытой)", () => {
    let s = ink();
    const wrongAt = new Set([EMPTIES[0], EMPTIES[10], EMPTIES.at(-1)]);
    for (const i of EMPTIES) s = enterDigit(s, i, wrongAt.has(i) ? wrongFor(s, i) : s.solution[i]!, 100, KEEP);
    expect(s.solved).toBe(true);
    expect(cellsLeft(s)).toBe(0);
    const sum = summary(s.log);
    expect([sum.corrections, sum.mistakes]).toEqual([3, 3]);
  });

  it("состояние, записанное при autoReplace=false, корректно и при текущем флаге true (смена решения безопасна)", () => {
    let s = ink();
    for (const i of EMPTIES.slice(0, -1)) s = enterDigit(s, i, s.solution[i]!, 10);
    const last = EMPTIES.at(-1)!;
    s = enterDigit(s, last, wrongFor(s, last), 20, KEEP);
    expect(s.solved).toBe(true);
    // Перезагрузка под другим флагом: читающие функции от флага не зависят.
    expect(cellsLeft(s)).toBe(0);
  });
});

/** Верная цифра клетки. */
function s0(cell: number): number {
  return SOLUTION.charCodeAt(cell) - 48;
}
