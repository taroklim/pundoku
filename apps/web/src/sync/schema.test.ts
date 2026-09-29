import { heatmap, summary } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { NOW, progressOf, recordOf } from "./fixtures";
import type { DayRecord, SnapshotData } from "./schema";
import {
  applyMoveLogBudget,
  buildSnapshotData,
  dayRecordFromProgress,
  logFromHeat,
  migrateSnapshot,
  MIGRATIONS,
  MOVE_LOG_ALWAYS_LAST_DAYS,
  MOVE_LOG_MAX_CHARS,
  progressFromRecord,
  sanitizeDayRecord,
  SNAPSHOT_SCHEMA_VERSION,
} from "./schema";

describe("миграция схемы снапшота «старее → новее»", () => {
  it("схема 0 (данные до PD-14, без schemaVersion) → текущая, пустой прогресс", () => {
    const r = migrateSnapshot({ grid: {}, year: { "2026-09-28": "clean" } });
    expect(r).toEqual({ ok: true, data: { schemaVersion: SNAPSHOT_SCHEMA_VERSION, grid: null, days: {} } });
  });

  it("текущая схема проходит без изменений, мусорные дни и улёты отбрасываются", () => {
    const day = recordOf("2026-09-28");
    const input = {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      grid: { installSeed: "s", index: 2, cells: [{ cell: 4, date: "2026-09-01" }, { cell: 4, date: "2026-09-02" }, { cell: 99, date: "2026-09-03" }, { cell: 5, date: "bad" }] },
      days: { "2026-09-28": day, "nope": day, "2026-09-27": { status: "solved" }, "2026-09-26": null },
    };
    const r = migrateSnapshot(input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.data.days)).toEqual(["2026-09-28"]);
    expect(r.data.grid).toEqual({ installSeed: "s", index: 2, cells: [{ cell: 4, date: "2026-09-01" }] });
  });

  it("снапшот новее клиента → newer_schema (читать и перезаписывать нельзя)", () => {
    expect(migrateSnapshot({ schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1, days: {} })).toEqual({
      ok: false,
      reason: "newer_schema",
      schemaVersion: SNAPSHOT_SCHEMA_VERSION + 1,
    });
  });

  it("не объект / отрицательная версия → invalid", () => {
    for (const bad of [null, [], "x", 5, { schemaVersion: -1 }]) expect(migrateSnapshot(bad)).toEqual({ ok: false, reason: "invalid" });
  });

  it("цепочка шагов: 0 → 1 → 2 → 3 применяется по порядку (каркас под будущие схемы)", () => {
    const steps = {
      0: (d: Record<string, unknown>) => ({ ...d, schemaVersion: 1, trail: "0" }),
      1: (d: Record<string, unknown>) => ({ ...d, schemaVersion: 2, trail: `${String(d["trail"])}1` }),
      2: (d: Record<string, unknown>) => ({ ...d, schemaVersion: 3, trail: `${String(d["trail"])}2`, days: {} }),
    };
    let seen = "";
    const spy = { ...steps, 2: (d: Record<string, unknown>) => { seen = String(d["trail"]); return steps[2](d); } };
    const r = migrateSnapshot({ schemaVersion: 0 }, 3, spy);
    expect(seen).toBe("01");
    expect(r.ok && r.data.schemaVersion).toBe(3);
    // пропущенный шаг — не молчаливая потеря данных
    expect(migrateSnapshot({ schemaVersion: 1 }, 3, { 0: steps[0] })).toEqual({ ok: false, reason: "invalid" });
  });

  it("реальная таблица миграций доходит до текущей версии без дыр", () => {
    for (let v = 0; v < SNAPSHOT_SCHEMA_VERSION; v++) expect(MIGRATIONS[v], `шаг ${v}`).toBeTypeOf("function");
  });
});

describe("запись дня (поля под Year)", () => {
  it("решённый чисто: solved, solvedAt, timeMs по логу, техника, hadCorrections=false, assisted=false, late=false", () => {
    const p = progressOf("2026-09-29");
    const rec = dayRecordFromProgress(p, NOW)!;
    const sum = summary(p.play.log);
    expect(rec).toMatchObject({
      status: "solved",
      solvedAt: "2026-09-29T10:00:00.000Z",
      timeMs: sum.durationMs,
      technique: sum.maxTechnique,
      hadCorrections: false,
      assisted: false,
      late: false,
      source: "sudoku.com",
      difficulty: "easy",
      winRate: 61.4,
    });
    expect(rec.heat).toHaveLength(162);
    expect(rec.moveLog).toMatch(/^1:/);
  });

  it("hadCorrections — из MoveLog: ошибка/стирание даёт true (булево, не число)", () => {
    const rec = dayRecordFromProgress(progressOf("2026-09-29", { withFix: true }), NOW)!;
    expect(rec.hadCorrections).toBe(true);
    expect(rec.corrections).toBeGreaterThan(0);
  });

  it("late берётся из прогресса; источник «client» → «device»", () => {
    const rec = dayRecordFromProgress(progressOf("2026-09-20", { late: true, source: "client" }), NOW)!;
    expect(rec.late).toBe(true);
    expect(rec.source).toBe("device");
    expect(progressFromRecord("2026-09-20", rec)!.source).toBe("client");
  });

  it("начатый день → unfinished без solvedAt/heat/moveLog; день без ходов в снапшот не идёт", () => {
    const rec = dayRecordFromProgress(progressOf("2026-09-29", { solved: false, moves: 10 }), NOW)!;
    expect(rec.status).toBe("unfinished");
    expect(rec.solvedAt).toBeUndefined();
    expect(rec.heat).toBeUndefined();
    expect(rec.moveLog).toBeUndefined();
    expect(rec.timeMs).toBeGreaterThan(0);
    expect(dayRecordFromProgress(progressOf("2026-09-29", { solved: false, moves: 0 }), NOW)).toBeNull();
    expect(progressFromRecord("2026-09-29", rec)).toBeNull(); // не решён — локально не материализуется
  });

  it("sanitizeDayRecord отбрасывает негодное: нет mission, плохой solvedAt, чужой source", () => {
    const good = recordOf("2026-09-29");
    expect(sanitizeDayRecord(good)).toEqual(good);
    expect(sanitizeDayRecord({ ...good, mission: "123" })).toBeNull();
    expect(sanitizeDayRecord({ ...good, solvedAt: "yesterday" })).toBeNull();
    expect(sanitizeDayRecord({ ...good, source: "x" })).toBeNull();
    expect(sanitizeDayRecord({ ...good, status: "won" })).toBeNull();
    expect(sanitizeDayRecord({ ...good, moveLog: "garbage" })?.moveLog).toBeUndefined();
    expect(sanitizeDayRecord({ ...good, heat: "short" })?.heat).toBeUndefined();
  });
});

describe("DayRecord → локальный прогресс (восстановление)", () => {
  it("с moveLog: лог, сводка и тепловая карта совпадают с исходными", () => {
    const p = progressOf("2026-09-28", { withFix: true });
    const rec = dayRecordFromProgress(p, NOW)!;
    const back = progressFromRecord("2026-09-28", rec)!;
    expect(back).toMatchObject({ solved: true, date: "2026-09-28", mission: p.mission, solvedAt: rec.solvedAt, verification: "local" });
    expect(back.play.solved).toBe(true);
    expect(summary(back.play.log)).toEqual(summary(p.play.log));
    const puzzle = { mission: p.mission, solution: p.play.solution.join("") };
    expect(heatmap(back.play.log, puzzle)).toEqual(heatmap(p.play.log, puzzle));
    expect(back.play.values.every((v, i) => v === (p.play.mission[i] ? 0 : p.play.solution[i]))).toBe(true);
  });

  it("без moveLog (не влез в бюджет): синтетический лог из heat даёт ту же карточку дня", () => {
    const p = progressOf("2026-09-27", { withFix: true });
    const full = dayRecordFromProgress(p, NOW)!;
    const { moveLog: _drop, ...lean } = full;
    void _drop;
    const back = progressFromRecord("2026-09-27", lean)!;
    const orig = summary(p.play.log);
    const synth = summary(back.play.log);
    expect(synth.durationMs).toBe(orig.durationMs);
    expect(synth.clean).toBe(orig.clean);
    expect(synth.corrections).toBe(orig.corrections);
    expect(synth.maxTechnique).toBe(orig.maxTechnique);
    const puzzle = { mission: p.mission, solution: p.play.solution.join("") };
    const a = heatmap(p.play.log, puzzle);
    const b = heatmap(back.play.log, puzzle);
    a.forEach((v, i) => (v === null ? expect(b[i]).toBeNull() : expect(b[i]!).toBeCloseTo(v, 2)));
  });

  it("logFromHeat без heat не падает: лог пуст/короткий, день остаётся решённым", () => {
    const full = recordOf("2026-09-26");
    const { heat: _h, moveLog: _m, ...bare } = full;
    void _h;
    void _m;
    const p = progressFromRecord("2026-09-26", bare)!;
    expect(p.solved).toBe(true);
    expect(logFromHeat(bare, p.play.solution).length).toBeLessThan(3);
  });

  it("сетка без решения → null", () => {
    const rec = { ...recordOf("2026-09-25"), mission: "1".repeat(81) };
    expect(progressFromRecord("2026-09-25", rec)).toBeNull();
  });
});

describe("бюджет moveLog", () => {
  const day = (i: number, len: number): [string, DayRecord] => {
    const date = `2026-01-${String(i).padStart(2, "0")}`;
    return [date, { ...recordOf("2026-09-29"), moveLog: "1:" + "x".repeat(len - 2) }];
  };

  it("новые дни первыми; всё, что не влезло, теряет moveLog, но сохраняет heat и сводку", () => {
    const days = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => day(i, 1000)));
    const out = applyMoveLogBudget(days, 3500, 0);
    const kept = Object.entries(out).filter(([, r]) => r.moveLog).map(([d]) => d);
    expect(kept).toEqual(["2026-01-08", "2026-01-09", "2026-01-10"]);
    expect(out["2026-01-01"]!.heat).toHaveLength(162);
    expect(out["2026-01-01"]!.status).toBe("solved");
  });

  it("последние N дней хранят moveLog всегда, даже сверх бюджета", () => {
    const days = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => day(i, 1000)));
    const out = applyMoveLogBudget(days, 0);
    expect(Object.values(out).filter((r) => r.moveLog)).toHaveLength(MOVE_LOG_ALWAYS_LAST_DAYS);
  });

  it("лог одной партии длиннее потолка в снапшот не идёт", () => {
    const days = Object.fromEntries([day(1, MOVE_LOG_MAX_CHARS + 10)]);
    expect(applyMoveLogBudget(days)["2026-01-01"]!.moveLog).toBeUndefined();
  });

  it("не мутирует вход; buildSnapshotData собирает schemaVersion + grid + days", () => {
    const days = Object.fromEntries([day(1, 100)]);
    const before = JSON.stringify(days);
    const data: SnapshotData = buildSnapshotData({ grid: null, days }, 0, 0);
    expect(JSON.stringify(days)).toBe(before);
    expect(data).toMatchObject({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, grid: null });
    expect(data.days["2026-01-01"]!.moveLog).toBeUndefined();
  });

  it("оценка размера: год настоящих партий укладывается в лимит сервера 1 МиБ с бюджетом по умолчанию", () => {
    const rec = recordOf("2026-09-29", { withFix: true });
    const days: Record<string, DayRecord> = {};
    for (let i = 0; i < 365; i++) days[`2025-${String(1 + Math.floor(i / 31)).padStart(2, "0")}-${String(1 + (i % 31)).padStart(2, "0")}`] = rec;
    const data = buildSnapshotData({ grid: null, days });
    const bytes = JSON.stringify(data).length;
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});
