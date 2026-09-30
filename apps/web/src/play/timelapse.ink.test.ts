/**
 * Таймлапс Чернильной партии (PD-71 × PD-70) и устойчивость к повреждённому локальному логу (QA PD-72, Low).
 * Настоящая партия движка → кодек `2:` → hasTimelapse → кадры.
 */
import { blotsOf, dailyPuzzle, timelapseFingerprint } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { decodeMoveLog, encodeMoveLog } from "../sync/codec";
import { NOW, progressOf, recordOf } from "../sync/fixtures";
import { dayRecordFromProgress, progressFromRecord } from "../sync/schema";
import type { DayProgress } from "../today/repository";
import { createPlay, enterDigit, setInkMode } from "./logic";
import type { PlayState } from "./logic";
import { hasTimelapse, recordHasTimelapse, timelapseOf } from "./timelapse";

const DATE = "2026-09-20";

function inkPlay(date: string, blotsAt: number[]): PlayState {
  let play = setInkMode(createPlay(dailyPuzzle(date, "easy")), true);
  const empty = play.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  let t = 1000;
  empty.forEach((cell, idx) => {
    const digit = blotsAt.includes(idx) ? (play.solution[cell]! % 9) + 1 : play.solution[cell]!;
    play = enterDigit(play, cell, digit, (t += 800));
  });
  return play;
}

function inkProgress(date: string, blotsAt: number[]): DayProgress {
  const play = inkPlay(date, blotsAt);
  return {
    ...progressOf(date),
    play,
    mission: play.mission.join(""),
    solved: play.solved,
    elapsedMs: play.log.at(-1)?.t ?? 0,
  };
}

describe("Таймлапс Чернильной партии", () => {
  it("3 клякса: кадры с кляксой и заменой, финал == решение, время монотонно", () => {
    const p = inkProgress(DATE, [2, 9, 15]);
    expect(p.solved).toBe(true);
    expect(blotsOf(p.play.log)).toHaveLength(3);
    expect(hasTimelapse(p)).toBe(true);
    const tl = timelapseOf(p)!;
    const solution = p.play.solution.join("");
    expect(tl.frames.at(-1)!.values.join("")).toBe(solution);
    expect(tl.frames.at(-1)!.wrong).toEqual([]);
    const wrongFrames = tl.frames.filter((f) => f.wrong.length > 0);
    expect(wrongFrames).toHaveLength(3);
    wrongFrames.forEach((f) => expect(f.blot).toBe(true));
    // замена — сразу следующий кадр, в тот же момент, верной цифрой
    tl.frames.forEach((f, i) => {
      if (f.wrong.length === 0) return;
      const next = tl.frames[i + 1]!;
      expect(next.t).toBe(f.t);
      expect(next.wrong).toEqual([]);
      expect(next.values[f.cell!]).toBe(p.play.solution[f.cell!]);
      expect(f.values[f.cell!]).not.toBe(p.play.solution[f.cell!]);
    });
    const ts = tl.frames.map((f) => f.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it("круг кодека: `2:` → decode → восстановленный день → hasTimelapse → кадры", () => {
    const p = inkProgress(DATE, [2, 9, 15]);
    const text = encodeMoveLog(p.play.log);
    expect(text.startsWith("2:")).toBe(true);
    expect(decodeMoveLog(text)).toEqual(p.play.log);

    const rec = dayRecordFromProgress(p, NOW)!;
    expect(rec.moveLog).toBe(text);
    expect(recordHasTimelapse(rec)).toBe(true);
    const restored = progressFromRecord(DATE, rec)!;
    expect(restored.play.logSynthetic).toBeUndefined();
    expect(hasTimelapse(restored)).toBe(true);
    const a = timelapseOf(p, { durationMs: 9000 })!;
    const b = timelapseOf(restored, { durationMs: 9000 })!;
    expect(b).toEqual(a);
    expect(b.frames.at(-1)!.values.join("")).toBe(restored.play.solution.join(""));
  });

  it("усечённый `2:`-лог (без последних ходов) — не таймлапс", () => {
    const rec = dayRecordFromProgress(inkProgress(DATE, [2, 9, 15]), NOW)!;
    const cut = rec.moveLog!.split(",").slice(0, -3).join(",");
    expect(recordHasTimelapse({ ...rec, moveLog: cut })).toBe(false);
  });

  it("лог оборван между кляксой и заменой — не таймлапс (последний кадр не решение)", () => {
    const p = inkProgress(DATE, [2]);
    const i = p.play.log.findIndex((m) => m.blot === true && m.correct === false);
    const broken = { ...p, play: { ...p.play, log: p.play.log.slice(0, i + 1) } };
    expect(hasTimelapse(broken)).toBe(false);
  });

  it("отпечаток ink-партии: клякса-клетки отмечены, цифр решения нет", () => {
    const p = inkProgress(DATE, [2, 9, 15]);
    const fp = timelapseFingerprint(p.play.log, { mission: p.mission, solution: p.play.solution.join("") });
    expect(fp.cells.filter((c) => c?.blot === true)).toHaveLength(3);
    expect(fp.placed).toBe(p.play.solution.filter((_, i) => p.play.mission[i] === 0).length);
    expect(fp.cells.every((c) => c === null || Object.keys(c).every((k) => ["order", "t", "attempts", "blot"].includes(k)))).toBe(true);
  });
});

describe("hasTimelapse / timelapseOf на повреждённом локальном логе (QA PD-72)", () => {
  const good = (): DayProgress => progressOf("2026-09-20", { withFix: true });
  const withLog = (p: DayProgress, log: unknown): DayProgress => ({ ...p, play: { ...p.play, log: log as never } });

  it("клетка 99, отрицательная, дробная — false/null, без исключения", () => {
    for (const cell of [99, -1, 81, 1.5, "a", null]) {
      const p = good();
      const bad = withLog(p, [...p.play.log, { t: 99999, cell, kind: "place", digit: 1 }]);
      expect(() => hasTimelapse(bad)).not.toThrow();
      expect(hasTimelapse(bad)).toBe(false);
      expect(timelapseOf(bad)).toBeNull();
    }
  });

  it("null/не-объект в логе и не-массив вместо лога — false/null", () => {
    const p = good();
    for (const log of [[...p.play.log, null], [undefined], null, "garbage", {}]) {
      const bad = withLog(p, log);
      expect(hasTimelapse(bad)).toBe(false);
      expect(timelapseOf(bad)).toBeNull();
    }
  });

  it("усечённый локальный лог (первые ходы) — не таймлапс", () => {
    const p = good();
    const half = withLog(p, p.play.log.slice(0, Math.floor(p.play.log.length / 2)));
    expect(hasTimelapse(half)).toBe(false);
    expect(timelapseOf(half)).toBeNull();
    expect(hasTimelapse(withLog(p, p.play.log.slice(0, -1)))).toBe(false); // без последнего хода
    expect(hasTimelapse(withLog(p, []))).toBe(false);
    expect(hasTimelapse(good())).toBe(true); // контроль: целый лог проходит
  });

  it("recordHasTimelapse: запись с битой клеткой в moveLog — false", () => {
    const rec = recordOf("2026-09-26");
    expect(recordHasTimelapse({ ...rec, moveLog: "1:p0050-0a" })).toBe(false);
  });

  it("note_add с нечисловой цифрой не ломает и не меняет итоговый кадр", () => {
    const p = good();
    const bad = withLog(p, [{ t: 1, cell: p.play.mission.findIndex((g) => g === 0), kind: "note_add", digit: "x" }, ...p.play.log]);
    expect(hasTimelapse(bad)).toBe(true);
    const tl = timelapseOf(bad, { notes: true })!;
    expect(tl.frames.every((f) => f.notes!.every((m) => (m & 1) === 0))).toBe(true);
  });
});
