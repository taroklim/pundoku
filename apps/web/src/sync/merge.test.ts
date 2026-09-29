import { describe, expect, it } from "vitest";
import { recordOf } from "./fixtures";
import { mergeDays, mergeGrid, mergeSnapshots, pickDayRecord, sameSnapshotData } from "./merge";
import type { DayRecord, SnapshotData } from "./schema";
import { emptySnapshotData } from "./schema";
import type { PermanentGridState } from "../today/permanent";

const solved = (date: string, solvedAt: string, extra: Partial<DayRecord> = {}): DayRecord => ({
  ...recordOf(date, { solvedAt }),
  ...extra,
});
const unfinished = (date: string, timeMs: number): DayRecord => ({
  ...recordOf(date, { solved: false, moves: 5 }),
  timeMs,
});
const grid = (installSeed: string, index: number, ...cells: [number, string][]): PermanentGridState => ({
  installSeed,
  index,
  cells: cells.map(([cell, date]) => ({ cell, date })),
});
const snap = (days: Record<string, DayRecord>, g: PermanentGridState | null = null): SnapshotData => ({ ...emptySnapshotData(), grid: g, days });

describe("политика 409: дни", () => {
  it("объединение по датам: дни только с одной стороны сохраняются", () => {
    const a = { "2026-09-01": solved("2026-09-01", "2026-09-01T08:00:00.000Z") };
    const b = { "2026-09-02": solved("2026-09-02", "2026-09-02T08:00:00.000Z") };
    expect(Object.keys(mergeDays(a, b)).sort()).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("конфликт по дню: «решено» над «не решено», в любую сторону", () => {
    const s = solved("2026-09-03", "2026-09-03T08:00:00.000Z");
    const u = unfinished("2026-09-03", 999_999);
    expect(pickDayRecord(s, u)).toBe(s);
    expect(pickDayRecord(u, s)).toBe(s);
  });

  it("оба решены: побеждает более ранний solvedAt", () => {
    const early = solved("2026-09-03", "2026-09-03T08:00:00.000Z");
    const late = solved("2026-09-03", "2026-09-03T21:00:00.000Z", { late: true });
    expect(pickDayRecord(early, late)).toBe(early);
    expect(pickDayRecord(late, early)).toBe(early);
  });

  it("источник: sudoku.com побеждает device независимо от solvedAt (в обе стороны)", () => {
    const real = solved("2026-09-03", "2026-09-03T21:00:00.000Z", { source: "sudoku.com", late: true });
    const fallback = solved("2026-09-03", "2026-09-03T08:00:00.000Z", { source: "device" });
    expect(pickDayRecord(real, fallback)).toBe(real);
    expect(pickDayRecord(fallback, real)).toBe(real);
  });

  it("источник: серверный generator тоже побеждает device, даже при более позднем solvedAt", () => {
    const gen = solved("2026-09-03", "2026-09-03T21:00:00.000Z", { source: "generator" });
    const fallback = solved("2026-09-03", "2026-09-03T08:00:00.000Z", { source: "device" });
    expect(pickDayRecord(gen, fallback)).toBe(gen);
    expect(pickDayRecord(fallback, gen)).toBe(gen);
  });

  it("равные источники: побеждает более ранний solvedAt (sudoku.com/sudoku.com, device/device)", () => {
    for (const source of ["sudoku.com", "generator", "device"] as const) {
      const early = solved("2026-09-03", "2026-09-03T08:00:00.000Z", { source });
      const late = solved("2026-09-03", "2026-09-03T21:00:00.000Z", { source });
      expect(pickDayRecord(early, late)).toBe(early);
      expect(pickDayRecord(late, early)).toBe(early);
    }
  });

  it("«решено» по-прежнему сильнее «не решено» независимо от источника", () => {
    const deviceSolved = solved("2026-09-03", "2026-09-03T08:00:00.000Z", { source: "device" });
    const realUnfinished = { ...unfinished("2026-09-03", 5000), source: "sudoku.com" as const };
    expect(pickDayRecord(deviceSolved, realUnfinished)).toBe(deviceSolved);
    expect(pickDayRecord(realUnfinished, deviceSolved)).toBe(deviceSolved);
  });

  it("равный solvedAt: запись с moveLog над записью без; иначе детерминированно", () => {
    const full = solved("2026-09-03", "2026-09-03T08:00:00.000Z");
    const lean = { ...full };
    delete lean.moveLog;
    expect(pickDayRecord(lean, full)).toBe(full);
    expect(pickDayRecord(full, lean)).toBe(full);
    const x = { ...full, timeMs: 1 };
    const y = { ...full, timeMs: 2 };
    expect(JSON.stringify(pickDayRecord(x, y))).toBe(JSON.stringify(pickDayRecord(y, x)));
  });

  it("оба не решены: больше timeMs", () => {
    const a = unfinished("2026-09-03", 1000);
    const b = unfinished("2026-09-03", 5000);
    expect(pickDayRecord(a, b)).toBe(b);
    expect(pickDayRecord(b, a)).toBe(b);
  });

  it("свойства: коммутативно, идемпотентно, ассоциативно на наборе записей", () => {
    const pool: Record<string, DayRecord>[] = [
      { d1: solved("2026-09-01", "2026-09-01T08:00:00.000Z"), d2: unfinished("2026-09-02", 100) },
      { d1: solved("2026-09-01", "2026-09-01T07:00:00.000Z"), d3: unfinished("2026-09-03", 50) },
      { d2: solved("2026-09-02", "2026-09-02T09:00:00.000Z"), d3: unfinished("2026-09-03", 70) },
      { d1: solved("2026-09-01", "2026-09-01T06:00:00.000Z", { source: "device" }), d2: solved("2026-09-02", "2026-09-02T05:00:00.000Z", { source: "generator" }) },
      { d1: solved("2026-09-01", "2026-09-01T09:30:00.000Z", { source: "generator" }), d3: { ...unfinished("2026-09-03", 90), source: "device" } },
    ];
    const eq = (x: Record<string, DayRecord>, y: Record<string, DayRecord>) => sameSnapshotData(snap(x), snap(y));
    for (const a of pool) {
      expect(eq(mergeDays(a, a), a)).toBe(true);
      for (const b of pool) {
        expect(eq(mergeDays(a, b), mergeDays(b, a))).toBe(true);
        for (const c of pool) expect(eq(mergeDays(mergeDays(a, b), c), mergeDays(a, mergeDays(b, c)))).toBe(true);
      }
    }
  });
});

describe("сравнение записей не зависит от порядка ключей", () => {
  it("та же запись с другим порядком ключей (после круга через сервер) — не изменение", () => {
    const rec = solved("2026-09-03", "2026-09-03T08:00:00.000Z");
    const shuffled = Object.fromEntries(Object.entries(rec).reverse()) as DayRecord;
    expect(sameSnapshotData(snap({ d: rec }), snap({ d: shuffled }))).toBe(true);
    expect(sameSnapshotData(snap({ d: pickDayRecord(rec, shuffled) }), snap({ d: pickDayRecord(shuffled, rec) }))).toBe(true);
  });
});

describe("политика 409: Grid ∞", () => {
  it("сервер новее по version → installSeed и index серверные; клиентские улёты добираются по датам", () => {
    const local = grid("client-seed", 0, [10, "2026-09-05"], [11, "2026-09-06"]);
    const server = grid("server-seed", 0, [10, "2026-09-05"], [20, "2026-09-04"]);
    const merged = mergeGrid(local, server, true)!;
    expect(merged.installSeed).toBe("server-seed");
    expect(merged.index).toBe(0);
    expect(merged.cells).toEqual([
      { cell: 10, date: "2026-09-05" },
      { cell: 20, date: "2026-09-04" },
      { cell: 11, date: "2026-09-06" },
    ]);
  });

  it("сервер не новее → installSeed клиентский", () => {
    const local = grid("client-seed", 1);
    const server = grid("server-seed", 3, [1, "2026-09-01"]);
    const merged = mergeGrid(local, server, false)!;
    expect(merged.installSeed).toBe("client-seed");
    expect(merged.index).toBe(1);
    expect(merged.cells).toEqual([{ cell: 1, date: "2026-09-01" }]); // улёт с сервера не теряется
  });

  it("одна дата — один улёт, повторное слияние ничего не меняет (счётчики из набора дат)", () => {
    const a = grid("s", 0, [3, "2026-09-01"], [4, "2026-09-02"]);
    const b = grid("s", 0, [4, "2026-09-02"], [9, "2026-09-03"]);
    const once = mergeGrid(a, b, true)!;
    expect(once.cells.map((c) => c.date).sort()).toEqual(["2026-09-01", "2026-09-02", "2026-09-03"]);
    const twice = mergeGrid(once, b, true)!;
    expect(twice.cells.length).toBe(3);
    expect(mergeGrid(once, once, true)).toEqual(once);
  });

  it("клетка занята другой датой → ближайшая свободная (детерминированно, в порядке дат)", () => {
    const local = grid("s", 0, [40, "2026-09-02"]);
    const server = grid("s", 0, [40, "2026-09-01"]);
    const merged = mergeGrid(local, server, true)!;
    expect(merged.cells).toHaveLength(2);
    expect(new Set(merged.cells.map((c) => c.cell)).size).toBe(2);
    expect(merged.cells[0]).toEqual({ cell: 40, date: "2026-09-01" });
    expect(merged.cells[1]!.cell).toBe(31); // ближайшая свободная к 40 с меньшим индексом
  });

  it("тот же installSeed, разный index: побеждает больший index целиком (меньшая сетка уже дорешана)", () => {
    const local = grid("s", 0, [1, "2026-09-01"]);
    const server = grid("s", 2, [7, "2026-09-09"]);
    expect(mergeGrid(local, server, false)).toEqual(server);
    expect(mergeGrid(server, local, true)).toEqual(server);
  });

  it("одна из сторон пуста", () => {
    const g = grid("s", 0, [1, "2026-09-01"]);
    expect(mergeGrid(null, g, true)).toEqual(g);
    expect(mergeGrid(g, null, false)).toEqual(g);
    expect(mergeGrid(null, null, true)).toBeNull();
  });

  it("коммутативность при согласованном флаге: (local, server, true) = (server, local, false)", () => {
    const a = grid("A", 0, [5, "2026-09-01"], [6, "2026-09-03"]);
    const b = grid("B", 0, [5, "2026-09-02"], [8, "2026-09-03"]);
    const x = mergeGrid(a, b, true)!;
    const y = mergeGrid(b, a, false)!;
    expect(x.installSeed).toBe("B");
    expect(sameSnapshotData(snap({}, x), snap({}, y))).toBe(true);
  });
});

describe("mergeSnapshots", () => {
  it("объединяет дни и Grid ∞ одновременно; слияние с самим собой — тождество", () => {
    const local = snap({ "2026-09-01": solved("2026-09-01", "2026-09-01T08:00:00.000Z") }, grid("s", 0, [1, "2026-09-01"]));
    const server = snap({ "2026-09-02": solved("2026-09-02", "2026-09-02T08:00:00.000Z") }, grid("s", 0, [2, "2026-09-02"]));
    const merged = mergeSnapshots(local, server, { serverNewer: true });
    expect(Object.keys(merged.days).sort()).toEqual(["2026-09-01", "2026-09-02"]);
    expect(merged.grid!.cells).toHaveLength(2);
    expect(sameSnapshotData(mergeSnapshots(merged, merged, { serverNewer: true }), merged)).toBe(true);
    expect(sameSnapshotData(mergeSnapshots(merged, server, { serverNewer: true }), merged)).toBe(true);
    expect(sameSnapshotData(mergeSnapshots(merged, local, { serverNewer: false }), merged)).toBe(true);
  });
});
