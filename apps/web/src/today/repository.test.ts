import { describe, expect, it, vi } from "vitest";
import { dayRecordFromProgress, progressFromRecord } from "../sync/schema";
import { NOW, progressOf } from "../sync/fixtures";
import { enterDigit, setInkMode, toggleNote, undo } from "../play/logic";
import type { PlayState } from "../play/logic";
import type { DayProgress } from "./repository";
import { dayProgressProblem, isDayProgress, sanitizeDays } from "./repository";

/** Запись дня с подменой полей `play` (сырой вход из IndexedDB — тип не гарантирован). */
const withPlay = (p: DayProgress, patch: Record<string, unknown>): unknown => ({ ...p, play: { ...p.play, ...patch } });
const clone = <T,>(x: T): T => structuredClone(x);

/** Настоящие записи разных режимов — то, что реально лежит в IndexedDB (регрессия: валидатор не отбрасывает валидное). */
function realRecords(): Record<string, DayProgress> {
  const base = progressOf("2026-09-20", { withFix: true });
  // Партия с заметками и undo: в логе note_add/undo, в стеке undo — записи, у клеток — маски заметок.
  let noted: PlayState = progressOf("2026-09-21", { solved: false, moves: 3 }).play;
  const cell = noted.mission.findIndex((g, i) => g === 0 && noted.values[i] === 0);
  noted = toggleNote(noted, cell, 3, 90_000);
  noted = toggleNote(noted, cell, 5, 91_000);
  noted = enterDigit(noted, cell, noted.solution[cell]!, 92_000);
  noted = undo(noted, 93_000);
  // Ink: неверная цифра — клякса (blot), потом авто-замена.
  let ink: PlayState = setInkMode(progressOf("2026-09-22", { solved: false, moves: 0 }).play, true);
  const icell = ink.mission.findIndex((g) => g === 0);
  ink = enterDigit(ink, icell, (ink.solution[icell]! % 9) + 1, 1000);
  ink = enterDigit(ink, icell, ink.solution[icell]!, 2000);
  const inkDay = { ...progressOf("2026-09-22", { solved: false }), play: ink };
  const solvedForRecord = progressOf("2026-09-24", { withFix: true });
  const rec = dayRecordFromProgress(solvedForRecord, NOW)!;
  return {
    обычная: base,
    "в процессе, заметки и undo": { ...progressOf("2026-09-21", { solved: false }), play: noted, solved: false },
    ink: inkDay,
    late: progressOf("2026-09-23", { late: true, solvedAt: "2026-09-25T10:00:00.000Z" }),
    assisted: { ...progressOf("2026-09-26"), assisted: true },
    "архив (generator)": progressOf("2026-09-10", { source: "generator", late: true }),
    "архив (client)": progressOf("2026-09-11", { source: "client", solved: false, moves: 5 }),
    "пустая партия": progressOf("2026-09-27", { solved: false, moves: 0 }),
    "из снапшота (синтетический лог по heat)": progressFromRecord("2026-09-24", { ...rec, moveLog: undefined } as never)!,
    "из снапшота (moveLog)": progressFromRecord("2026-09-24", rec)!,
  };
}

describe("isDayProgress (PD-146/148): настоящие записи не отбрасываются", () => {
  const records = realRecords();
  it.each(Object.entries(records))("%s", (_name, p) => {
    expect(dayProgressProblem(p)).toBeNull();
    expect(isDayProgress(p)).toBe(true);
    // через IndexedDB запись проходит structured clone — после него тоже годна
    expect(dayProgressProblem(clone(p))).toBeNull();
  });

  it("образцы действительно разные: есть blot, note_add, undo, синтетический лог, ink", () => {
    const kinds = new Set(Object.values(records).flatMap((p) => p.play.log.map((m) => m.kind)));
    expect([...kinds]).toEqual(expect.arrayContaining(["place", "erase", "note_add", "undo"]));
    expect(Object.values(records).some((p) => p.play.log.some((m) => m.blot === true))).toBe(true);
    expect(Object.values(records).some((p) => p.play.ink === true)).toBe(true);
    expect(Object.values(records).some((p) => p.play.logSynthetic === true)).toBe(true);
    expect(Object.values(records).some((p) => p.play.notes.some((n) => n !== 0))).toBe(true);
    expect(Object.values(records).some((p) => p.play.undoStack.length > 0)).toBe(true);
  });

  it("sanitizeDays возвращает тот же массив, если всё годно, и молчит", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const list = Object.values(records);
    expect(sanitizeDays(list)).toBe(list);
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("isDayProgress (PD-148): порченые записи отбрасываются", () => {
  const good = progressOf("2026-09-20", { withFix: true });
  const move = good.play.log[0]!;
  const bad: [string, unknown][] = [
    ["log: [null]", withPlay(good, { log: [null] })],
    ["log: [undefined]", withPlay(good, { log: [undefined] })],
    ["log: [число]", withPlay(good, { log: [5] })],
    ["log: [{}]", withPlay(good, { log: [{}] })],
    ["log: ход с клеткой 81", withPlay(good, { log: [{ ...move, cell: 81 }] })],
    ["log: ход с дробной клеткой", withPlay(good, { log: [{ ...move, cell: 1.5 }] })],
    ["log: неизвестный kind", withPlay(good, { log: [{ ...move, kind: "boom" }] })],
    ["log: t строкой", withPlay(good, { log: [{ ...move, t: "5" }] })],
    ["log: t отрицательный", withPlay(good, { log: [{ ...move, t: -1 }] })],
    ["log: t NaN", withPlay(good, { log: [{ ...move, t: NaN }] })],
    ["log: digit 0", withPlay(good, { log: [{ ...move, digit: 0 }] })],
    ["log: digit 10", withPlay(good, { log: [{ ...move, digit: 10 }] })],
    ["log: correct строкой", withPlay(good, { log: [{ ...move, correct: "yes" }] })],
    ["log: blot числом", withPlay(good, { log: [{ ...move, blot: 1 }] })],
    ["log: неизвестная technique", withPlay(good, { log: [{ ...move, technique: "x_wing" }] })],
    ["log: валидный ход, потом null", withPlay(good, { log: [move, null] })],
    ["log: не массив", withPlay(good, { log: {} })],
    ["notes: null", withPlay(good, { notes: null })],
    ["notes: 80 элементов", withPlay(good, { notes: new Array(80).fill(0) })],
    ["notes: маска вне 9 бит", withPlay(good, { notes: new Array(81).fill(0).map((_, i) => (i === 3 ? 1024 : 0)) })],
    ["notes: бит 0", withPlay(good, { notes: new Array(81).fill(0).map((_, i) => (i === 3 ? 1 : 0)) })],
    ["notes: отрицательное", withPlay(good, { notes: new Array(81).fill(0).map((_, i) => (i === 3 ? -2 : 0)) })],
    ["notes: null внутри", withPlay(good, { notes: new Array(81).fill(0).map((_, i) => (i === 3 ? null : 0)) })],
    ["values: 82 элемента", withPlay(good, { values: new Array(82).fill(0) })],
    ["values: цифра 10", withPlay(good, { values: new Array(81).fill(0).map((_, i) => (i === 0 ? 10 : 0)) })],
    ["values: дробное", withPlay(good, { values: new Array(81).fill(0).map((_, i) => (i === 0 ? 1.5 : 0)) })],
    ["values: строка", withPlay(good, { values: "0".repeat(81) })],
    ["mission: короткий массив", withPlay(good, { mission: [1, 2, 3] })],
    ["solution: не массив", withPlay(good, { solution: undefined })],
    ["undoStack: [null]", withPlay(good, { undoStack: [null] })],
    ["undoStack: не массив", withPlay(good, { undoStack: undefined })],
    ["undoStack: запись без prevNotes", withPlay(good, { undoStack: [{ cell: 0, prevValue: 0 }] })],
    ["undoStack: also — не массив", withPlay(good, { undoStack: [{ cell: 0, prevValue: 0, prevNotes: 0, also: 5 }] })],
    ["undoStack: also — клетка вне поля", withPlay(good, { undoStack: [{ cell: 0, prevValue: 0, prevNotes: 0, also: [[81, 2]] }] })],
    ["undoStack: also — маска заметок с битом 0", withPlay(good, { undoStack: [{ cell: 0, prevValue: 0, prevNotes: 0, also: [[1, 3]] }] })],
    ["undoStack: fill — не true", withPlay(good, { undoStack: [{ cell: 0, prevValue: 0, prevNotes: 0, fill: false }] })],
    ["solved не boolean", withPlay(good, { solved: "yes" })],
    ["ink не boolean", withPlay(good, { ink: "yes" })],
    ["play: null", { ...good, play: null }],
    ["elapsedMs: NaN", { ...good, elapsedMs: NaN }],
    ["elapsedMs: строка", { ...good, elapsedMs: "5" }],
    ["solved: не boolean", { ...good, solved: 1 }],
    ["late: undefined", { ...good, late: undefined }],
    ["assisted: undefined", { ...good, assisted: undefined }],
    ["verification: чужая", { ...good, verification: "x" }],
    ["source: чужой", { ...good, source: "x" }],
    ["difficulty: чужая", { ...good, difficulty: "insane" }],
    ["solvedAt: число", { ...good, solvedAt: 5 }],
    ["date: не дата", { ...good, date: "yesterday" }],
    ["mission: не строка", { ...good, mission: 5 }],
    ["undefined", undefined],
    ["null", null],
    ["{}", {}],
  ];
  it.each(bad)("%s", (_name, rec) => {
    expect(dayProgressProblem(rec)).not.toBeNull();
    expect(isDayProgress(rec)).toBe(false);
  });

  it("PD-119: запись undo с also (автоочистка/заполнение) и fill — валидна; старые записи без них — тоже", () => {
    const ok = withPlay(good, {
      undoStack: [
        { cell: 0, prevValue: 0, prevNotes: 0 },
        { cell: 1, prevValue: 0, prevNotes: 4, digit: 2, also: [[5, 6], [80, 1022]] },
        { cell: 2, prevValue: 0, prevNotes: 0, digit: 1, fill: true, also: [] },
      ],
    });
    expect(dayProgressProblem(ok)).toBeNull();
  });

  it("sanitizeDays: порченая запись отброшена с причиной в console.error, соседние годные остаются", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const neighbour = progressOf("2026-09-21");
    const out = sanitizeDays([good, withPlay(progressOf("2026-09-22"), { log: [null] }), neighbour], "test");
    expect(out.map((d) => d.date)).toEqual(["2026-09-20", "2026-09-21"]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toContain("2026-09-22: play.log[]");
    err.mockRestore();
  });
});
