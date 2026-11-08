/**
 * PD-305: наш ежедневный «Эксперт без X-Wing» в снапшоте. `DaySource` «pundoku» пишется как `source: "generator"` + `own: true`:
 * значение `source` остаётся из старого набора (старый клиент не отбросит запись дня), схема снапшота не версионируется.
 */
import { describe, expect, it } from "vitest";
import { NOW, progressOf, recordOf } from "./fixtures";
import { mergeDays } from "./merge";
import type { DayRecord } from "./schema";
import { SNAPSHOT_SCHEMA_VERSION, dayRecordFromProgress, migrateSnapshot, progressFromRecord, sanitizeDayRecord } from "./schema";

const DATE = "2026-11-08";

/** Значения `source`, которые принимает санитайзер клиента до PD-305 (остальные он отбрасывает вместе с записью дня). */
const OLD_SOURCES = ["sudoku.com", "generator", "device"];

describe("PD-305: запись дня нашего источника в снапшоте", () => {
  it("pundoku → source generator + own: true; обратно — pundoku", () => {
    const rec = recordOf(DATE, { source: "pundoku" });
    expect(rec.source).toBe("generator");
    expect(rec.own).toBe(true);
    expect(OLD_SOURCES).toContain(rec.source); // старый клиент запись не отбросит
    expect(progressFromRecord(DATE, rec)!.source).toBe("pundoku");
  });

  it("у остальных источников поля own нет — старые записи равны побайтно", () => {
    for (const source of ["sudoku.com", "generator", "client"] as const) {
      const rec = recordOf(DATE, { source });
      expect("own" in rec, source).toBe(false);
    }
    expect(progressFromRecord(DATE, recordOf(DATE, { source: "generator" }))!.source).toBe("generator");
  });

  it("санитайзер: own сохраняется только как true и только у generator; мусор — без own", () => {
    const base = recordOf(DATE, { source: "pundoku" });
    expect(sanitizeDayRecord(base)!.own).toBe(true);
    expect(sanitizeDayRecord({ ...base, own: "yes" })!.own).toBeUndefined();
    expect(sanitizeDayRecord({ ...base, source: "sudoku.com" })!.own).toBeUndefined();
    expect(sanitizeDayRecord({ ...base, source: "device" })!.own).toBeUndefined();
  });

  it("миграция: снапшот до PD-305 читается как раньше; со своим днём — тот же schemaVersion, день цел", () => {
    const oldDay = recordOf("2026-11-01");
    const ownDay = recordOf(DATE, { source: "pundoku" });
    const r = migrateSnapshot({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, grid: null, days: { "2026-11-01": oldDay, [DATE]: ownDay } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(r.data.days["2026-11-01"]).toEqual(oldDay);
    expect(r.data.days[DATE]).toEqual(ownDay);
  });

  it("старый клиент потерял own при пересохранении — день цел и читается как generator (данные не теряются)", () => {
    const { own: _own, ...stripped } = recordOf(DATE, { source: "pundoku" });
    void _own;
    const p = progressFromRecord(DATE, sanitizeDayRecord(stripped)!);
    expect(p!.source).toBe("generator");
    expect(p!.solved).toBe(true);
  });

  it("слияние: наш день — серверный ранг (не device-фолбэк); решённый побеждает незаконченный при любом источнике", () => {
    const own = recordOf(DATE, { source: "pundoku" });
    const sudokuUnfinished = dayRecordFromProgress(progressOf(DATE, { solved: false, moves: 3 }), NOW) as DayRecord;
    expect(mergeDays({ [DATE]: own }, { [DATE]: sudokuUnfinished })[DATE]).toEqual(own);
    expect(mergeDays({ [DATE]: sudokuUnfinished }, { [DATE]: own })[DATE]).toEqual(own);
    const device = recordOf(DATE, { source: "client", solvedAt: `${DATE}T08:00:00.000Z` });
    expect(mergeDays({ [DATE]: own }, { [DATE]: device })[DATE]).toEqual(own);
  });
});
