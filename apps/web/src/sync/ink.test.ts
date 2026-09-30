/**
 * Чернильный режим (PD-71): данные — DayRecord.ink/blots, кодек лога с blot, sanitize/migrate, восстановление
 * записи в прогресс, слияние 409, влияние на Year. См. docs/pd-71-ink-rules.md.
 */
import { blotsOf, dailyPuzzle, heatmap, inkViolations, summary } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { createPlay, enterDigit, setInkMode } from "../play/logic";
import type { PlayState } from "../play/logic";
import { entryFromProgress } from "../year/model";
import type { DayProgress } from "../today/repository";
import { decodeMoveLog, encodeMoveLog } from "./codec";
import { NOW, progressOf, recordOf } from "./fixtures";
import { mergeDays, mergeSnapshots, pickDayRecord } from "./merge";
import {
  SNAPSHOT_SCHEMA_VERSION,
  dayRecordFromProgress,
  emptySnapshotData,
  logFromHeat,
  migrateSnapshot,
  progressFromRecord,
  sanitizeDayRecord,
} from "./schema";
import type { DayRecord } from "./schema";

const DATE = "2026-09-20";

/** Настоящая ink-партия дня: `blotsAt` — индексы пустых клеток, куда ставится неверная цифра. */
function inkPlay(date: string, blotsAt: number[], opts: { solvedAll?: boolean } = {}): PlayState {
  let play = setInkMode(createPlay(dailyPuzzle(date, "easy")), true);
  const empty = play.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  let t = 1000;
  (opts.solvedAll === false ? empty.slice(0, 20) : empty).forEach((cell, idx) => {
    const digit = blotsAt.includes(idx) ? ((play.solution[cell]! % 9) + 1) : play.solution[cell]!;
    play = enterDigit(play, cell, digit, (t += 800));
  });
  return play;
}

function inkProgress(date: string, blotsAt: number[], over: Partial<DayProgress> = {}, solvedAll = true): DayProgress {
  const play = inkPlay(date, blotsAt, { solvedAll });
  return {
    ...progressOf(date, { solved: solvedAll }),
    play,
    mission: play.mission.join(""),
    solved: play.solved,
    solvedAt: play.solved ? `${date}T10:00:00.000Z` : null,
    elapsedMs: play.log.at(-1)?.t ?? 0,
    ...over,
  };
}

describe("кодек лога: blot", () => {
  it("ink-лог с кляксами переживает encode → decode без потерь", () => {
    const { log } = inkPlay(DATE, [2, 9, 15]);
    expect(blotsOf(log)).toHaveLength(3);
    const back = decodeMoveLog(encodeMoveLog(log));
    expect(back).toEqual(log);
    expect(inkViolations(back!)).toEqual([]);
    expect(summary(back!)).toEqual(summary(log));
  });

  it("обычный лог кодируется байт-в-байт как раньше (префикс 1:, без новых символов)", () => {
    const { log } = progressOf(DATE, { withFix: true }).play;
    const text = encodeMoveLog(log);
    expect(text.startsWith("1:")).toBe(true);
    expect(decodeMoveLog(text)).toEqual(log);
    // у хода без blot пятая позиция остаётся из набора -01
    for (const part of text.slice(2).split(",")) expect("-01").toContain(part[4]);
  });

  it("лог с кляксой пишется с префиксом 2:, без кляксы (даже в ink-партии) — 1:", () => {
    expect(encodeMoveLog(inkPlay(DATE, [2]).log).startsWith("2:")).toBe(true);
    expect(encodeMoveLog(inkPlay(DATE, []).log).startsWith("1:")).toBe(true);
  });

  it("символы blot под префиксом 1: — повреждённая строка; префикс 2: читается и без blot-ходов", () => {
    expect(decodeMoveLog("1:p0054-0a")).toBeNull();
    expect(decodeMoveLog("2:p0054-0a")).not.toBeNull();
    expect(decodeMoveLog("2:p0051-0a")).not.toBeNull();
    expect(decodeMoveLog("3:p0051-0a")).toBeNull();
  });

  it("blot без correct кодируется и читается", () => {
    const log = [{ t: 5, cell: 3, kind: "place" as const, digit: 4 as const, blot: true }];
    expect(decodeMoveLog(encodeMoveLog(log))).toEqual(log);
  });

  it("неизвестный символ correct — повреждённая строка", () => {
    expect(decodeMoveLog("1:p0050-0a")).not.toBeNull();
    expect(decodeMoveLog("1:p00559-0a")).toBeNull();
  });
});

describe("DayRecord: ink/blots", () => {
  it("ink-день: ink=true, blots, corrections = blots, hadCorrections", () => {
    const rec = dayRecordFromProgress(inkProgress(DATE, [1, 7, 30]), NOW)!;
    expect(rec).toMatchObject({ status: "solved", ink: true, blots: 3, corrections: 3, hadCorrections: true });
    expect(decodeMoveLog(rec.moveLog)).not.toBeNull();
  });

  it("ink-день без ошибок: чистый — blots 0, hadCorrections false", () => {
    const rec = dayRecordFromProgress(inkProgress(DATE, []), NOW)!;
    expect(rec).toMatchObject({ ink: true, blots: 0, corrections: 0, hadCorrections: false });
  });

  it("обычный день: полей ink/blots нет вовсе (запись идентична до-PD-71)", () => {
    const rec = recordOf(DATE, { withFix: true });
    expect("ink" in rec).toBe(false);
    expect("blots" in rec).toBe(false);
  });

  it("начатый, но не решённый ink-день записывается с ink", () => {
    const rec = dayRecordFromProgress(inkProgress(DATE, [1], {}, false), NOW)!;
    expect(rec).toMatchObject({ status: "unfinished", ink: true, blots: 1, hadCorrections: true });
  });
});

describe("sanitize / migrate", () => {
  const base = (over: Record<string, unknown> = {}) => ({ ...recordOf(DATE), ...over });

  it("ink=true сохраняется вместе с blots; ink отличное от true отбрасывается", () => {
    expect(sanitizeDayRecord(base({ ink: true, blots: 2 }))).toMatchObject({ ink: true, blots: 2 });
    for (const bad of [false, "true", 1, null]) expect("ink" in sanitizeDayRecord(base({ ink: bad, blots: 2 }))!).toBe(false);
  });

  it("blots без ink не принимается; мусорные blots отбрасываются", () => {
    expect("blots" in sanitizeDayRecord(base({ blots: 2 }))!).toBe(false);
    for (const bad of [-1, 1.5, "3", 82, null]) {
      expect("blots" in sanitizeDayRecord(base({ ink: true, blots: bad }))!).toBe(false);
    }
  });

  it("старая запись без ink читается как обычная", () => {
    const r = sanitizeDayRecord(recordOf(DATE))!;
    expect(r.ink).toBeUndefined();
  });

  it("migrate v1 → v1: ink проходит сквозь снапшот, схема не менялась", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    const rec = dayRecordFromProgress(inkProgress(DATE, [4]), NOW)!;
    const parsed = migrateSnapshot({ schemaVersion: 1, grid: null, days: { [DATE]: JSON.parse(JSON.stringify(rec)) } });
    expect(parsed.ok && parsed.data.days[DATE]).toMatchObject({ ink: true, blots: 1 });
  });
});

describe("восстановление записи в прогресс", () => {
  it("с moveLog: play.ink сохранён, лог с кляксами тот же", () => {
    const p = inkProgress(DATE, [3, 8]);
    const rec = dayRecordFromProgress(p, NOW)!;
    const back = progressFromRecord(DATE, rec)!;
    expect(back.play.ink).toBe(true);
    expect(blotsOf(back.play.log)).toHaveLength(2);
    expect(summary(back.play.log)).toEqual(summary(p.play.log));
  });

  it("без moveLog (бюджет): синтетический лог даёт те же corrections/mistakes и blots", () => {
    const p = inkProgress(DATE, [3, 8, 12]);
    const rec = { ...dayRecordFromProgress(p, NOW)! };
    delete rec.moveLog;
    const back = progressFromRecord(DATE, rec)!;
    expect(back.play.ink).toBe(true);
    const s = summary(back.play.log);
    expect([s.corrections, s.mistakes, s.clean]).toEqual([3, 3, false]);
    expect(blotsOf(back.play.log)).toHaveLength(3);
    // тепловая карта не теряет клетки-кляксы: все клетки решения заполнены верно
    expect(heatmap(back.play.log, { mission: rec.mission, solution: back.play.solution.join("") }).filter((h, i) => h !== null && back.play.mission[i] === 0)).toHaveLength(
      back.play.mission.filter((g) => g === 0).length,
    );
  });

  it("обычная запись восстанавливается без ink", () => {
    const back = progressFromRecord(DATE, recordOf(DATE))!;
    expect("ink" in back.play).toBe(false);
  });

  it("logFromHeat у ink-записи без blots не добавляет «поставил/стёр»", () => {
    const rec = dayRecordFromProgress(inkProgress(DATE, []), NOW)!;
    const log = logFromHeat(rec, dailyPuzzle(DATE, "easy").solution.split("").map(Number));
    expect(log.some((m) => m.kind === "erase")).toBe(false);
  });
});

describe("слияние по дню (409/восстановление): запись атомарна, побеждает первое решение", () => {
  const inkRec = (solvedAt: string, extra: Partial<DayRecord> = {}): DayRecord => ({
    ...dayRecordFromProgress(inkProgress(DATE, [2, 5]), NOW)!,
    solvedAt,
    ...extra,
  });
  const plainRec = (solvedAt: string): DayRecord => ({ ...recordOf(DATE, { solvedAt }) });

  it("ink решён раньше обычного — побеждает ink; ink/blots/moveLog остаются единым целым", () => {
    const ink = inkRec("2026-09-20T08:00:00.000Z");
    const plain = plainRec("2026-09-20T21:00:00.000Z");
    for (const w of [pickDayRecord(ink, plain), pickDayRecord(plain, ink)]) {
      expect(w).toBe(ink);
      expect(w).toMatchObject({ ink: true, blots: 2 });
    }
  });

  it("обычный решён раньше ink — побеждает обычный (второе решение дня не считается), ink не «просачивается»", () => {
    const ink = inkRec("2026-09-20T21:00:00.000Z");
    const plain = plainRec("2026-09-20T08:00:00.000Z");
    const w = pickDayRecord(ink, plain);
    expect(w).toBe(plain);
    expect("ink" in w).toBe(false);
    expect(w.hadCorrections).toBe(plain.hadCorrections);
  });

  it("слияние снапшотов коммутативно, идемпотентно и не теряет ink победителя", () => {
    const ink = inkRec("2026-09-20T08:00:00.000Z");
    const a = { ...emptySnapshotData(), days: { [DATE]: ink } };
    const b = { ...emptySnapshotData(), days: { [DATE]: plainRec("2026-09-20T21:00:00.000Z") } };
    const ab = mergeSnapshots(a, b, { serverNewer: true });
    const ba = mergeSnapshots(b, a, { serverNewer: true });
    expect(ab.days[DATE]).toEqual(ba.days[DATE]);
    expect(ab.days[DATE]).toMatchObject({ ink: true, blots: 2 });
    expect(mergeSnapshots(ab, a, { serverNewer: true }).days[DATE]).toEqual(ab.days[DATE]);
    expect(mergeDays(ab.days, ab.days)[DATE]).toEqual(ab.days[DATE]);
  });

  it("оба не решены: больше прогресса (timeMs) — запись целиком, с её ink", () => {
    const inkU = dayRecordFromProgress(inkProgress(DATE, [1], {}, false), NOW)!;
    const plainU = { ...recordOf(DATE, { solved: false, moves: 5 }), timeMs: 10 };
    expect(pickDayRecord({ ...inkU, timeMs: 99_999 }, plainU)).toMatchObject({ ink: true });
    expect("ink" in pickDayRecord({ ...inkU, timeMs: 1 }, plainU)).toBe(false);
  });
});

describe("Year: кляксы = исправления, нового состояния нет", () => {
  it("ink с кляксой: hadCorrections=true; ink без ошибок: hadCorrections=false; форма записи та же", () => {
    const withBlot = entryFromProgress(inkProgress(DATE, [4]))!;
    const clean = entryFromProgress(inkProgress(DATE, []))!;
    expect(withBlot).toEqual({ status: "solved", hadCorrections: true, assisted: false, late: false });
    expect(clean).toEqual({ status: "solved", hadCorrections: false, assisted: false, late: false });
  });

  it("entryFromProgress и DayRecord.hadCorrections согласованы для ink", () => {
    const p = inkProgress(DATE, [4, 9]);
    expect(entryFromProgress(p)!.hadCorrections).toBe(dayRecordFromProgress(p, NOW)!.hadCorrections);
  });
});
