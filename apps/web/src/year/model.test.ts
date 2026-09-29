import { describe, expect, it } from "vitest";
import { NOW, progressOf } from "../sync/fixtures";
import { dayRecordFromProgress } from "../sync/schema";
import type { YearContext, YearEntry } from "./model";
import { availableYears, buildYear, daysInMonth, entryFromProgress, markOf, startDate, yearContext } from "./model";

const ctx: YearContext = { today: "2026-09-29", start: "2026-09-10", hasRecords: true };
const solved: YearEntry = { status: "solved", hadCorrections: false, assisted: false, late: false };

describe("метка дня: форма и цвет (решения владельца по Year)", () => {
  it("решён чисто — полный квадрат без исправлений и без помощи", () => {
    expect(markOf("2026-09-15", solved, ctx)).toMatchObject({ kind: "solved", corrections: false, assisted: false, late: false, hasRecord: true });
  });

  it("решён с исправлениями — solved + corrections (сургуч и скол — в CSS), это факт, а не число", () => {
    expect(markOf("2026-09-15", { ...solved, hadCorrections: true }, ctx)).toMatchObject({ kind: "solved", corrections: true });
  });

  it("assisted — solved с признаком помощи (мягкий тон), в сочетании с исправлениями тоже", () => {
    expect(markOf("2026-09-15", { ...solved, assisted: true }, ctx)).toMatchObject({ kind: "solved", assisted: true, corrections: false });
    expect(markOf("2026-09-15", { ...solved, assisted: true, hadCorrections: true }, ctx)).toMatchObject({ assisted: true, corrections: true });
  });

  it("начат и брошен — unfinished (нижняя половина), исправления сохраняются", () => {
    const m = markOf("2026-09-15", { status: "unfinished", hadCorrections: true, assisted: false, late: false }, ctx);
    expect(m).toMatchObject({ kind: "unfinished", corrections: true, hasRecord: true });
  });

  it("доигранный позже день остаётся пропуском (missed), но с записью и late = true", () => {
    const m = markOf("2026-09-15", { ...solved, late: true, hadCorrections: true }, ctx);
    expect(m).toMatchObject({ kind: "missed", late: true, hasRecord: true, corrections: false, assisted: false });
  });

  it("прошедший день без записи после начала пользования — пропуск; до начала — пусто", () => {
    expect(markOf("2026-09-10", undefined, ctx)).toMatchObject({ kind: "missed", hasRecord: false, late: false });
    expect(markOf("2026-09-28", undefined, ctx).kind).toBe("missed");
    expect(markOf("2026-09-09", undefined, ctx).kind).toBe("void");
    expect(markOf("2025-01-01", undefined, ctx).kind).toBe("void");
  });

  it("сегодня без записи — не пропуск (пусто), но с признаком today; будущее — пусто", () => {
    expect(markOf("2026-09-29", undefined, ctx)).toMatchObject({ kind: "void", today: true });
    expect(markOf("2026-09-30", undefined, ctx)).toMatchObject({ kind: "void", today: false });
  });

  it("сегодня с решением — solved + today (кольцо поверх формы)", () => {
    expect(markOf("2026-09-29", solved, ctx)).toMatchObject({ kind: "solved", today: true });
  });
});

describe("сборка года", () => {
  const entries = new Map<string, YearEntry>([
    ["2026-09-10", solved],
    ["2026-09-11", { ...solved, hadCorrections: true }],
    ["2026-09-12", { ...solved, assisted: true }],
    ["2026-09-13", { status: "unfinished", hadCorrections: false, assisted: false, late: false }],
    ["2026-09-14", { ...solved, late: true }],
  ]);
  const view = buildYear(2026, entries, ctx);

  it("12 месяцев с правильным числом дней (в том числе високосный год)", () => {
    expect(view.months).toHaveLength(12);
    expect(view.months.map((m) => m.days.length)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(buildYear(2028, new Map(), ctx).months[1]!.days).toHaveLength(29);
    expect(daysInMonth(2100, 1)).toBe(28);
  });

  it("итоги месяца: решённые, с исправлениями, брошенные; доигранный позже не в счёт", () => {
    expect(view.months[8]!.summary).toEqual({ solved: 3, corrections: 1, unfinished: 1 });
    expect(view.months[7]!.summary).toEqual({ solved: 0, corrections: 0, unfinished: 0 });
  });

  it("итоги года: сыграно, чисто, с исправлениями — нейтральные числа без серий и процентов", () => {
    expect(view.totals).toEqual({ played: 3, clean: 2, withCorrections: 1 });
    expect(Object.keys(view.totals).sort()).toEqual(["clean", "played", "withCorrections"]);
  });

  it("другой год не подхватывает чужие записи", () => {
    const v = buildYear(2025, entries, ctx);
    expect(v.totals.played).toBe(0);
    expect(v.months.flatMap((m) => m.days).every((d) => d.kind === "void")).toBe(true);
  });

  it("пустой год: ни одного пропуска до начала пользования", () => {
    const v = buildYear(2026, new Map(), { today: "2026-09-29", start: "2026-09-29", hasRecords: false });
    expect(v.months.flatMap((m) => m.days).filter((d) => d.kind !== "void")).toEqual([]);
  });
});

describe("нулевые записи: пропусков нет, даже если первый запуск в прошлом", () => {
  const empty: YearContext = { today: "2026-09-29", start: "2026-09-20", hasRecords: false };
  it("markOf: прошедший день после firstUse без записей — void, сегодня — void с кольцом", () => {
    expect(markOf("2026-09-25", undefined, empty).kind).toBe("void");
    expect(markOf("2026-09-29", undefined, empty)).toMatchObject({ kind: "void", today: true });
  });
  it("buildYear: ни одной метки кроме void; как только появилась запись — пропуски возвращаются", () => {
    const v = buildYear(2026, new Map(), empty);
    expect(v.months.flatMap((m) => m.days).filter((d) => d.kind !== "void")).toEqual([]);
    const withRecord = buildYear(2026, new Map([["2026-09-27", solved]]), { ...empty, hasRecords: true });
    expect(withRecord.months[8]!.days.filter((d) => d.kind === "missed").map((d) => d.date)).toContain("2026-09-25");
  });
  it("yearContext: hasRecords по числу записей, start как в startDate", () => {
    expect(yearContext("2026-09-20", new Map(), "2026-09-29")).toEqual(empty);
    expect(yearContext("2026-09-20", new Map([["2026-09-27", solved]]), "2026-09-29")).toEqual({ ...empty, hasRecords: true });
  });
});

describe("годы и начало пользования", () => {
  it("startDate: меньшее из первого запуска и самой ранней записи; нет ничего — сегодня", () => {
    const e = new Map<string, YearEntry>([["2026-08-01", solved]]);
    expect(startDate("2026-09-01", e, "2026-09-29")).toBe("2026-08-01");
    expect(startDate("2026-07-01", e, "2026-09-29")).toBe("2026-07-01");
    expect(startDate(null, new Map(), "2026-09-29")).toBe("2026-09-29");
    expect(startDate(null, e, "2026-09-29")).toBe("2026-08-01");
  });

  it("availableYears: от начала до сегодня, запись из будущего расширяет диапазон", () => {
    expect(availableYears(new Map(), { today: "2026-09-29", start: "2026-09-29", hasRecords: false })).toEqual([2026]);
    expect(availableYears(new Map(), { today: "2026-01-02", start: "2025-12-31", hasRecords: false })).toEqual([2025, 2026]);
    expect(availableYears(new Map([["2024-05-05", solved]]), ctx)).toEqual([2024, 2025, 2026]);
    expect(availableYears(new Map([["2028-05-05", solved]]), ctx)).toEqual([2026, 2027, 2028]);
  });
});

describe("запись из прогресса — тот же смысл, что у записи снапшота", () => {
  const cases = [
    ["решён чисто", progressOf("2026-09-20")],
    ["решён с исправлением", progressOf("2026-09-21", { withFix: true })],
    ["решён поздно", progressOf("2026-09-22", { late: true })],
    ["с помощью", { ...progressOf("2026-09-23"), assisted: true }],
    ["брошен", progressOf("2026-09-24", { solved: false, moves: 12 })],
    ["брошен с исправлением", progressOf("2026-09-25", { solved: false, moves: 12, withFix: true })],
  ] as const;

  for (const [name, p] of cases) {
    it(`${name}: status/hadCorrections/assisted/late совпадают с dayRecordFromProgress`, () => {
      const rec = dayRecordFromProgress(p, NOW)!;
      const e = entryFromProgress(p)!;
      expect(e.status).toBe(rec.status);
      expect(e.hadCorrections).toBe(rec.hadCorrections);
      expect(e.assisted).toBe(rec.assisted);
      expect(e.late).toBe(rec.late);
    });
  }

  it("день без ходов в Year не попадает", () => {
    const p = progressOf("2026-09-26", { solved: false, moves: 0 });
    expect(entryFromProgress(p)).toBeNull();
    expect(dayRecordFromProgress(p, NOW)).toBeNull();
  });
});
