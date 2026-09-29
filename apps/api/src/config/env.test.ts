import { afterEach, describe, expect, it, vi } from "vitest";

async function loadEnv() {
  vi.resetModules();
  return (await import("./env.js")).env;
}

describe("env.dailyFallbackDifficulty", () => {
  const saved = process.env.DAILY_FALLBACK_DIFFICULTY;
  afterEach(() => {
    if (saved === undefined) delete process.env.DAILY_FALLBACK_DIFFICULTY;
    else process.env.DAILY_FALLBACK_DIFFICULTY = saved;
  });

  it("по умолчанию medium (профиль 30 подсказок/singles ≈ Sudoku.com hard)", async () => {
    delete process.env.DAILY_FALLBACK_DIFFICULTY;
    expect((await loadEnv()).dailyFallbackDifficulty).toBe("medium");
  });

  it("принимает классы движка, включая master", async () => {
    for (const d of ["easy", "medium", "hard", "expert", "master"]) {
      process.env.DAILY_FALLBACK_DIFFICULTY = d;
      expect((await loadEnv()).dailyFallbackDifficulty).toBe(d);
    }
  });

  it("неизвестное значение → ошибка при старте, а не при первом фолбэке", async () => {
    process.env.DAILY_FALLBACK_DIFFICULTY = "nightmare";
    await expect(loadEnv()).rejects.toThrow(/DAILY_FALLBACK_DIFFICULTY/);
  });
});
