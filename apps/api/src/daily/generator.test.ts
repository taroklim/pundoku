import { describe, expect, it, vi } from "vitest";
import { EngineGenerator } from "./generator.js";
import { SAMPLE } from "../test/fakes.js";

const toGrid = (s: string) => s.split("").map(Number);

describe("EngineGenerator", () => {
  it("вызывает engine.generate({difficulty, seed}) и превращает Grid в строки", async () => {
    const generate = vi.fn(() => ({ givens: toGrid(SAMPLE.mission), solution: toGrid(SAMPLE.solution) }));
    const gen = new EngineGenerator(async () => ({ generate }));
    const result = await gen.generate("2026-09-28", "hard");
    expect(generate).toHaveBeenCalledWith({ difficulty: "hard", seed: "2026-09-28" });
    expect(result).toEqual({ mission: SAMPLE.mission, solution: SAMPLE.solution });
  });

  it("принимает async generate и Uint8Array-сетки", async () => {
    const gen = new EngineGenerator(async () => ({
      generate: async () => ({ givens: Uint8Array.from(toGrid(SAMPLE.mission)), solution: Uint8Array.from(toGrid(SAMPLE.solution)) }),
    }));
    expect(await gen.generate("2026-09-28", "easy")).toEqual({ mission: SAMPLE.mission, solution: SAMPLE.solution });
  });

  it("грузит модуль один раз", async () => {
    const loader = vi.fn(async () => ({ generate: () => ({ givens: toGrid(SAMPLE.mission), solution: toGrid(SAMPLE.solution) }) }));
    const gen = new EngineGenerator(loader);
    await gen.generate("2026-09-27", "hard");
    await gen.generate("2026-09-28", "hard");
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("движок без generate (заглушка PD-0) → понятная ошибка", async () => {
    const gen = new EngineGenerator(async () => ({}));
    await expect(gen.generate("2026-09-28", "hard")).rejects.toThrow(/не экспортирует generate/);
  });

  it("сетка неверного формата от движка → ошибка", async () => {
    const gen = new EngineGenerator(async () => ({ generate: () => ({ givens: [1, 2, 3], solution: [1, 2, 3] }) }));
    await expect(gen.generate("2026-09-28", "hard")).rejects.toThrow(/неверного формата/);
  });

  it("ошибка загрузки модуля не кэшируется", async () => {
    let attempt = 0;
    const gen = new EngineGenerator(async () => {
      if (attempt++ === 0) throw new Error("ENOENT");
      return { generate: () => ({ givens: toGrid(SAMPLE.mission), solution: toGrid(SAMPLE.solution) }) };
    });
    await expect(gen.generate("2026-09-28", "hard")).rejects.toThrow(/не загрузился: ENOENT/);
    await expect(gen.generate("2026-09-28", "hard")).resolves.toBeTruthy();
  });

  it("реальный @pundoku/engine из workspace: пока заглушка → ошибка «generate появится с PD-2»", async () => {
    // Живой дымовой тест точки подключения. Если PD-2 уже смержен и движок собран — тест
    // проходит по другой ветке (вернётся валидная сетка); если dist не собран — модуль не грузится.
    const gen = new EngineGenerator();
    const result = await gen.generate("2026-09-28", "hard").then(
      (p) => ({ ok: true as const, p }),
      (e: Error) => ({ ok: false as const, message: e.message }),
    );
    if (result.ok) {
      expect(result.p.mission).toMatch(/^[0-9]{81}$/);
      expect(result.p.solution).toMatch(/^[1-9]{81}$/);
    } else {
      expect(result.message).toMatch(/PD-2|не загрузился/);
    }
  });
});
