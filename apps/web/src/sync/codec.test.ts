import { heatmap, summary } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import { decodeHeat, decodeMoveLog, encodeHeat, encodeMoveLog } from "./codec";
import { playOf } from "./fixtures";

describe("codec: лог ходов", () => {
  it("настоящая партия с исправлением: encode → decode даёт тот же лог", () => {
    const play = playOf("2026-09-29", { withFix: true });
    const text = encodeMoveLog(play.log);
    expect(decodeMoveLog(text)).toEqual(play.log);
  });

  it("сводка и тепловая карта по декодированному логу совпадают с исходными", () => {
    const play = playOf("2026-09-28", { withFix: true, difficulty: "medium" });
    const back = decodeMoveLog(encodeMoveLog(play.log))!;
    expect(summary(back)).toEqual(summary(play.log));
    const puzzle = { mission: play.mission.join(""), solution: play.solution.join("") };
    expect(heatmap(back, puzzle)).toEqual(heatmap(play.log, puzzle));
  });

  it("кодирует все виды ходов и необязательные поля", () => {
    const log = [
      { t: 10, cell: 0, kind: "note_add", digit: 3 },
      { t: 15, cell: 0, kind: "note_remove", digit: 3 },
      { t: 900, cell: 80, kind: "place", digit: 9, correct: false },
      { t: 900, cell: 80, kind: "undo", digit: 9 },
      { t: 70_000, cell: 40, kind: "place", digit: 1, correct: true, technique: "naked_single" },
      { t: 70_001, cell: 40, kind: "erase" },
    ] as const;
    expect(decodeMoveLog(encodeMoveLog(log))).toEqual(log);
  });

  it("пустой лог и повреждённые строки", () => {
    expect(decodeMoveLog(encodeMoveLog([]))).toEqual([]);
    for (const bad of [null, 5, "", "0:p001", "1:zzz", "1:p0011", "1:pzz0-0-1", "1:p00x1-1", "1:p0010x-1"]) {
      expect(decodeMoveLog(bad), String(bad)).toBeNull();
    }
  });

  it("компактность: ход занимает не больше 14 символов (оценка бюджета снапшота)", () => {
    const play = playOf("2026-09-29");
    const perMove = encodeMoveLog(play.log).length / play.log.length;
    expect(perMove).toBeLessThan(14);
    expect(encodeMoveLog(play.log).length).toBeLessThan(JSON.stringify(play.log).length / 4);
  });
});

describe("codec: тепловая карта", () => {
  it("округляется до 1/1295, null сохраняется, 162 символа", () => {
    const heat = [0, 0.5, 1, null, ...new Array<number | null>(77).fill(0.123456)];
    const text = encodeHeat(heat);
    expect(text).toHaveLength(162);
    const back = decodeHeat(text)!;
    expect(back[3]).toBeNull();
    expect(back[0]).toBe(0);
    expect(back[2]).toBe(1);
    expect(back[4]).toBeCloseTo(0.123456, 3);
  });

  it("повреждённая строка → null", () => {
    expect(decodeHeat("abc")).toBeNull();
    expect(decodeHeat("!!".repeat(81))).toBeNull();
    expect(decodeHeat(undefined)).toBeNull();
  });
});
