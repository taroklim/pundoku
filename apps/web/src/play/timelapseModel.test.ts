import { blotsOf, dailyPuzzle, timelapseFingerprint } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { progressOf } from "../sync/fixtures";
import { createPlay, enterDigit, setInkMode } from "./logic";
import type { PlayState } from "./logic";
import { timelapseOf } from "./timelapse";
import {
  BLOT_HOLD_MS,
  BUDGET_MS,
  PAUSE_CAP,
  blotCount,
  contactStages,
  dwellScales,
  firstBlotFrames,
  frameAt,
  hasBlots,
  isBlotReplacement,
  playbackSchedule,
  rhythmScale,
} from "./timelapseModel";

function inkPlay(date: string, blotsAt: number[], thinkAt: Record<number, number> = {}): PlayState {
  let play = setInkMode(createPlay(dailyPuzzle(date, "easy")), true);
  const empty = play.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  let t = 1000;
  empty.forEach((cell, idx) => {
    const digit = blotsAt.includes(idx) ? (play.solution[cell]! % 9) + 1 : play.solution[cell]!;
    play = enterDigit(play, cell, digit, (t += thinkAt[idx] ?? 800));
  });
  return play;
}

const real = (p: PlayState) => timelapseOf({ solved: true, mission: p.mission.join(""), play: p }, { maxGapMs: Infinity })!;

describe("playbackSchedule", () => {
  const tl = timelapseOf(progressOf("2026-09-29", { withFix: true }), { maxGapMs: Infinity })!;

  for (const speed of ["slow", "normal", "fast"] as const) {
    it(`${speed}: партия укладывается в бюджет, ни одна пауза не длиннее 6 %`, () => {
      const budget = BUDGET_MS[speed];
      const s = playbackSchedule(tl.frames, budget);
      expect(s.offsets).toHaveLength(tl.frames.length);
      expect(s.offsets[0]).toBe(0);
      expect(s.totalMs).toBeCloseTo(budget, 0);
      for (let j = 1; j < s.offsets.length; j++) {
        const gap = s.offsets[j]! - s.offsets[j - 1]!;
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThanOrEqual(PAUSE_CAP * budget + 1e-6);
      }
    });
  }

  it("самая долгая реальная пауза остаётся самой долгой на экране", () => {
    const play = inkPlay("2026-09-20", [], { 10: 60000 });
    const f = real(play).frames;
    const s = playbackSchedule(f, 30000);
    const gaps = s.offsets.slice(1).map((o, i) => o - s.offsets[i]!);
    expect(gaps.indexOf(Math.max(...gaps))).toBe(10);
    expect(Math.max(...gaps)).toBeCloseTo(PAUSE_CAP * 30000, 3);
  });

  it("клякса и её замена (тот же t) не сливаются: между ними не меньше BLOT_HOLD_MS", () => {
    const f = real(inkPlay("2026-09-20", [2, 9])).frames;
    const s = playbackSchedule(f, 30000);
    const pairs = f.map((_, j) => j).filter((j) => isBlotReplacement(f, j));
    expect(pairs).toHaveLength(2);
    for (const j of pairs) expect(s.offsets[j]! - s.offsets[j - 1]!).toBeGreaterThanOrEqual(BLOT_HOLD_MS - 1e-6);
  });

  it("партия в одно мгновение раскладывается равномерно; пустой лог — один кадр", () => {
    const f = tl.frames.map((fr) => ({ ...fr, t: 0 }));
    const s = playbackSchedule(f, 15000);
    const gaps = s.offsets.slice(1).map((o, i) => o - s.offsets[i]!);
    expect(new Set(gaps.map((g) => Math.round(g))).size).toBe(1);
    expect(playbackSchedule([f[0]!], 15000)).toEqual({ offsets: [0], totalMs: 0 });
  });

  it("frameAt: последний кадр, чей момент уже наступил", () => {
    const o = [0, 100, 250, 400];
    expect(frameAt(o, 0)).toBe(0);
    expect(frameAt(o, 99)).toBe(0);
    expect(frameAt(o, 100)).toBe(1);
    expect(frameAt(o, 399)).toBe(2);
    expect(frameAt(o, 99999)).toBe(3);
  });
});

describe("contactStages", () => {
  it("девять этапов round(N·s/9), последний — финал", () => {
    expect(contactStages(51)).toEqual([6, 11, 17, 23, 28, 34, 40, 45, 51]);
  });
  it("короткая партия: без повторов и нулевого кадра", () => {
    expect(contactStages(4)).toEqual([1, 2, 3, 4]);
    expect(contactStages(0)).toEqual([]);
  });
});

describe("кляксы в кадрах", () => {
  it("клетки-кляксы: первый кадр клякса и счёт", () => {
    const f = real(inkPlay("2026-09-20", [2, 9, 15])).frames;
    expect(hasBlots(f)).toBe(true);
    expect(blotCount(f)).toBe(3);
    const m = firstBlotFrames(f);
    for (const [cell, j] of m) {
      expect(f[j]!.cell).toBe(cell);
      expect(f[j]!.wrong).toContain(cell);
    }
    expect(hasBlots(real(inkPlay("2026-09-20", [])).frames)).toBe(false);
  });
});

describe("dwellScales / rhythmScale", () => {
  it("дольше думал — больше шкала; подсказки — null; диапазон 0..1", () => {
    const play = inkPlay("2026-09-20", [], { 10: 60000, 20: 30000 });
    const fp = timelapseFingerprint(play.log, { mission: play.mission.join(""), solution: play.solution.join("") }, { maxGapMs: Infinity });
    const d = dwellScales(fp);
    const at = (order: number) => d[fp.cells.findIndex((c) => c?.order === order)]!;
    expect(at(10)).toBe(1); // ≥ опорной паузы — потолок шкалы
    expect(at(20)).toBe(1);
    expect(at(5)).toBeLessThan(at(10));
    expect(at(0)).toBeCloseTo(at(5), 5); // первая клетка получает типичную паузу
    d.forEach((v, i) => {
      if (fp.cells[i] === null) expect(v).toBeNull();
      else {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
  });
  it("одинаковый темп — все квадраты одного размера; rhythmScale 1.0..0.45", () => {
    const play = inkPlay("2026-09-20", []);
    const fp = timelapseFingerprint(play.log, { mission: play.mission.join(""), solution: play.solution.join("") }, { maxGapMs: Infinity });
    const vals = dwellScales(fp).filter((v): v is number => v !== null);
    expect(new Set(vals.map((v) => v.toFixed(6))).size).toBe(1);
    expect(vals[0]!).toBeLessThan(1);
    expect(rhythmScale(0)).toBe(1);
    expect(rhythmScale(1)).toBeCloseTo(0.45, 10);
    expect(rhythmScale(7)).toBeCloseTo(0.45, 10);
  });
  it("blotsOf импортируется для проверки ink-лога", () => {
    expect(blotsOf(inkPlay("2026-09-20", [3]).log)).toHaveLength(1);
  });
});
