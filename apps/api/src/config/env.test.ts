import { DIFFICULTIES } from "@pundoku/engine";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
    for (const d of DIFFICULTIES) {
      process.env.DAILY_FALLBACK_DIFFICULTY = d;
      expect((await loadEnv()).dailyFallbackDifficulty).toBe(d);
    }
  });

  it("неизвестное значение → ошибка при старте, а не при первом фолбэке", async () => {
    process.env.DAILY_FALLBACK_DIFFICULTY = "nightmare";
    await expect(loadEnv()).rejects.toThrow(/DAILY_FALLBACK_DIFFICULTY/);
  });

  it("допустимые значения = DIFFICULTIES движка; ошибка — ConfigError с их списком", async () => {
    process.env.DAILY_FALLBACK_DIFFICULTY = "nightmare";
    const error = await loadEnv().then(
      () => null,
      (e: unknown) => e,
    );
    // resetModules → класс в env.js другой экземпляр, поэтому проверяем по имени.
    expect((error as Error).name).toBe("ConfigError");
    expect((error as Error).message).toContain(DIFFICULTIES.join("|"));
    expect((error as Error).message).toContain("nightmare");
  });

  it("свойства прототипа — не сложность (constructor, toString, __proto__)", async () => {
    for (const bad of ["constructor", "toString", "__proto__"]) {
      process.env.DAILY_FALLBACK_DIFFICULTY = bad;
      await expect(loadEnv(), bad).rejects.toMatchObject({ name: "ConfigError" });
    }
  });
});

describe("точка входа при неверной конфигурации", () => {
  it("печатает одно сообщение без стека и выходит с кодом 1", () => {
    const apiDir = fileURLToPath(new URL("../..", import.meta.url));
    const res = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
      cwd: apiDir,
      env: { ...process.env, DAILY_FALLBACK_DIFFICULTY: "nightmare", DATABASE_URL: "postgres://x", NODE_ENV: "test" },
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("DAILY_FALLBACK_DIFFICULTY");
    expect(res.stderr).toContain("Ошибка конфигурации");
    expect(res.stderr).not.toMatch(/\n\s+at /);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
  });
});
