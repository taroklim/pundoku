import { describe, expect, it, vi } from "vitest";
import { EngineGenerator } from "./generator.js";
import { SAMPLE } from "../test/fakes.js";

const toGrid = (s: string) => s.split("").map(Number);
const samplePuzzle = () => ({ givens: toGrid(SAMPLE.mission), solution: toGrid(SAMPLE.solution) });

describe("EngineGenerator", () => {
  it("вызывает engine.dailyPuzzle(date, difficulty) и превращает Grid в строки", async () => {
    const dailyPuzzle = vi.fn(samplePuzzle);
    const gen = new EngineGenerator(async () => ({ dailyPuzzle }));
    const result = await gen.generateDaily("2026-09-28", "hard");
    expect(dailyPuzzle).toHaveBeenCalledWith("2026-09-28", "hard");
    expect(result).toEqual({ mission: SAMPLE.mission, solution: SAMPLE.solution });
  });

  it("принимает async dailyPuzzle и Uint8Array-сетки", async () => {
    const gen = new EngineGenerator(async () => ({
      dailyPuzzle: async () => ({ givens: Uint8Array.from(toGrid(SAMPLE.mission)), solution: Uint8Array.from(toGrid(SAMPLE.solution)) }),
    }));
    expect(await gen.generateDaily("2026-09-28", "easy")).toEqual({ mission: SAMPLE.mission, solution: SAMPLE.solution });
  });

  it("грузит модуль один раз", async () => {
    const loader = vi.fn(async () => ({ dailyPuzzle: samplePuzzle }));
    const gen = new EngineGenerator(loader);
    await gen.generateDaily("2026-09-27", "hard");
    await gen.generateDaily("2026-09-28", "hard");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("движок без dailyPuzzle (старый dist) → понятная ошибка", async () => {
    const gen = new EngineGenerator(async () => ({}));
    await expect(gen.generateDaily("2026-09-28", "hard")).rejects.toThrow(/не экспортирует dailyPuzzle/);
  });

  it("сетка неверного формата от движка → ошибка", async () => {
    const gen = new EngineGenerator(async () => ({ dailyPuzzle: () => ({ givens: [1, 2, 3], solution: [1, 2, 3] }) }));
    await expect(gen.generateDaily("2026-09-28", "hard")).rejects.toThrow(/неверного формата/);
  });

  it("ошибка загрузки модуля не кэшируется", async () => {
    let attempt = 0;
    const gen = new EngineGenerator(async () => {
      if (attempt++ === 0) throw new Error("ENOENT");
      return { dailyPuzzle: samplePuzzle };
    });
    await expect(gen.generateDaily("2026-09-28", "hard")).rejects.toThrow(/не загрузился: ENOENT/);
    await expect(gen.generateDaily("2026-09-28", "hard")).resolves.toBeTruthy();
  });
});

/**
 * Единая seed-конвенция сетки дня (PD-8 j): серверный фолбэк ОБЯЗАН совпадать с тем, что офлайн-клиент
 * получит из `dailyPuzzle(date, difficulty)` движка. Тест идёт по реальному движку (алиас vitest на
 * исходники `packages/engine/src`, сборка не нужна) — ломается громко, а не молча пропускается.
 */
describe("EngineGenerator × реальный @pundoku/engine: сетка дня === dailyPuzzle(date, difficulty)", () => {
  const cases: Array<[string, "easy" | "medium" | "hard" | "expert" | "master"]> = [
    ["2026-09-28", "medium"], // дефолт фолбэка (DAILY_FALLBACK_DIFFICULTY)
    ["2026-09-29", "medium"],
    ["2026-09-29", "easy"],
    ["2026-09-29", "hard"],
    ["2026-09-29", "expert"],
    ["2026-09-29", "master"],
    ["2020-02-29", "medium"],
  ];
  for (const [date, difficulty] of cases) {
    it(`${date} / ${difficulty}`, async () => {
      const engine = await import("@pundoku/engine");
      const expected = engine.dailyPuzzle(date, difficulty);
      const actual = await new EngineGenerator().generateDaily(date, difficulty);
      expect(actual).toEqual({ mission: expected.mission, solution: expected.solution });
      // seed-конвенция: НЕ сырая дата.
      const rawSeed = engine.generate({ difficulty, seed: date });
      expect(actual.mission).not.toBe(rawSeed.mission);
      expect(expected.seed).toBe(engine.dailySeed(date, difficulty));
    });
  }

  it("сетка дня по дефолтному фолбэку — профиль 30 подсказок/singles (≈ Sudoku.com hard)", async () => {
    const engine = await import("@pundoku/engine");
    const { mission } = await new EngineGenerator().generateDaily("2026-09-29", "medium");
    expect(mission.split("").filter((c) => c !== "0")).toHaveLength(30);
    expect(engine.rateDifficulty(mission)).toBe("medium");
    expect(engine.techniquesUsed(mission).every((t) => t === "naked_single" || t === "hidden_single")).toBe(true);
  });

  it("невалидная дата → ошибка движка, а не молчаливая сетка", async () => {
    await expect(new EngineGenerator().generateDaily("2026-02-30", "hard")).rejects.toThrow(RangeError);
  });
});
