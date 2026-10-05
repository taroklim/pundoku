/**
 * PD-194: флаг режима Глифы в записи дня (по прецеденту `ink`): только `true`, у обычного дня поля нет (старые записи равны
 * побайтно), переживает санитайзер снапшота, восстановление в партию и слияние (запись атомарна).
 */
import { describe, expect, it } from "vitest";
import { NOW, progressOf, recordOf } from "./fixtures";
import { mergeDays } from "./merge";
import { dayRecordFromProgress, migrateSnapshot, progressFromRecord, sanitizeDayRecord, SNAPSHOT_SCHEMA_VERSION } from "./schema";

const DATE = "2026-10-05";

function glyphProgress(solved = true) {
  const p = progressOf(DATE, solved ? {} : { solved: false, moves: 12 });
  return { ...p, play: { ...p.play, glyphs: true as const } };
}

describe("DayRecord.glyphs", () => {
  it("партия с флагом → запись с `glyphs: true`; обычная — без поля (побайтно как раньше)", () => {
    const rec = dayRecordFromProgress(glyphProgress(), NOW)!;
    expect(rec.glyphs).toBe(true);
    const plain = recordOf(DATE);
    expect("glyphs" in plain).toBe(false);
    const unfinished = dayRecordFromProgress(glyphProgress(false), NOW)!;
    expect(unfinished.status).toBe("unfinished");
    expect(unfinished.glyphs).toBe(true);
  });

  it("санитайзер: `true` проходит, всё прочее отбрасывается без потери записи", () => {
    const rec = dayRecordFromProgress(glyphProgress(), NOW)!;
    expect(sanitizeDayRecord(JSON.parse(JSON.stringify(rec)))?.glyphs).toBe(true);
    for (const junk of [false, 1, "true", null]) {
      const r = sanitizeDayRecord({ ...rec, glyphs: junk });
      expect(r).not.toBeNull();
      expect(r && "glyphs" in r).toBe(false);
    }
  });

  it("снапшот: круг «сервер → санитайзер» переносит флаг; восстановленная партия снова в Глифах", () => {
    const rec = dayRecordFromProgress(glyphProgress(), NOW)!;
    const parsed = migrateSnapshot({ schemaVersion: SNAPSHOT_SCHEMA_VERSION, grid: null, days: { [DATE]: rec } });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.days[DATE]?.glyphs).toBe(true);
    const back = progressFromRecord(DATE, parsed.data.days[DATE]!)!;
    expect(back.play.glyphs).toBe(true);
    const plainBack = progressFromRecord(DATE, recordOf(DATE))!;
    expect(plainBack.play.glyphs).toBeUndefined();
  });

  it("слияние: запись победителя целиком (флаг не смешивается с проигравшим)", () => {
    const g = dayRecordFromProgress(glyphProgress(), NOW)!;
    const earlier = { ...recordOf(DATE), solvedAt: `${DATE}T09:00:00.000Z` }; // раньше решён — побеждает, флага нет
    const merged = mergeDays({ [DATE]: g }, { [DATE]: earlier });
    expect(merged[DATE]).toEqual(earlier);
    expect("glyphs" in merged[DATE]!).toBe(false);
    const later = { ...g, solvedAt: `${DATE}T08:00:00.000Z` };
    expect(mergeDays({ [DATE]: earlier }, { [DATE]: later })[DATE]?.glyphs).toBe(true);
  });
});
