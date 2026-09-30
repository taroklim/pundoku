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

describe.each([
  ["PORT", "port", 3000, ["8080", "1", "65535", "03000"], ["", "abc", "-1", "0", "70000", "65536", "1.5", "1e3", "0x10", " ", " 80", "80 ", "8080abc", "NaN", "Infinity"]],
  ["LOG_LEVEL", "logLevel", "silent", ["trace", "debug", "info", "warn", "error", "fatal", "silent"], ["loud", "INFO", "verbose", "toString", "__proto__", " "]],
  ["SUDOKU_COM_TIMEOUT_MS", "sudokuComTimeoutMs", 5000, ["0", "250", "10000"], ["abc", "-1", "1.5", "1e3", " ", "0x10", "9".repeat(20)]],
  ["DAILY_UPSTREAM_RETRY_MS", "dailyUpstreamRetryMs", 60_000, ["0", "1000"], ["abc", "-5", "2.5", " "]],
] as const)("env.%s", (name, key, fallback, valid, invalid) => {
  const saved = process.env[name];
  const savedNodeEnv = process.env.NODE_ENV;
  afterEach(() => {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
    process.env.NODE_ENV = savedNodeEnv;
  });

  it("не задано → дефолт", async () => {
    process.env.NODE_ENV = "test"; // дефолт LOG_LEVEL зависит от NODE_ENV
    delete process.env[name];
    expect((await loadEnv())[key]).toBe(fallback);
  });

  // PORT= (пусто) — ошибка конфигурации (см. список invalid); у остальных пустое значение = дефолт.
  it.skipIf(name === "PORT")("пустая строка → дефолт", async () => {
    process.env.NODE_ENV = "test";
    process.env[name] = "";
    expect((await loadEnv())[key]).toBe(fallback);
  });

  it("допустимые значения принимаются", async () => {
    for (const v of valid) {
      process.env[name] = v;
      const got = (await loadEnv())[key];
      expect(got, v).toBe(name === "LOG_LEVEL" ? v : Number(v));
    }
  });

  it.each(invalid.map((v) => [v]))("недопустимое значение %j → ConfigError с именем переменной и значением", async (bad) => {
    process.env[name] = bad;
    const error = await loadEnv().then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as Error | null)?.name).toBe("ConfigError");
    expect((error as Error).message).toContain(name);
    expect((error as Error).message).toContain(`получено: ${bad}`);
  });
});

describe("env.port: диапазон в сообщении", () => {
  const saved = process.env.PORT;
  afterEach(() => {
    if (saved === undefined) delete process.env.PORT;
    else process.env.PORT = saved;
  });

  it("сообщение называет допустимый диапазон 1..65535", async () => {
    process.env.PORT = "abc";
    await expect(loadEnv()).rejects.toThrow(/PORT.*от 1 до 65535.*abc/);
  });
});

const apiDir = fileURLToPath(new URL("../..", import.meta.url));

/** Запуск tsx под нагрузкой (полный прогон монорепо, CI) занимает 6–8 с; дефолтные 5 с и прежние 30 с — впритык. */
const SPAWN_TIMEOUT_MS = 60_000;

function runEntry(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: apiDir,
    env: { ...process.env, DATABASE_URL: "postgres://x", NODE_ENV: "test", ...overrides },
    encoding: "utf8",
    timeout: SPAWN_TIMEOUT_MS - 5_000, // spawnSync убивает процесс раньше, чем сработает таймаут теста: сообщение об ошибке точнее
  });
}

// Каждый запуск — отдельный процесс с tsx (~1 с без нагрузки, 6–8 с при 3-кратной перегрузке CPU): дефолтные 5 с мало (PD-46).
describe("точка входа при неверной конфигурации", { timeout: SPAWN_TIMEOUT_MS }, () => {
  it.each([
    ["DAILY_FALLBACK_DIFFICULTY", "nightmare"],
    ["PORT", "abc"],
    ["PORT", "70000"],
    ["LOG_LEVEL", "loud"],
  ])("%s=%s: одно сообщение без стека, код 1", (name, value) => {
    const res = runEntry({ [name]: value });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(name);
    expect(res.stderr).toContain("Ошибка конфигурации");
    expect(res.stderr).not.toContain("ERR_SOCKET_BAD_PORT");
    expect(res.stderr).not.toMatch(/\n\s+at /);
    expect(res.stderr.trim().split("\n")).toHaveLength(1);
  });
});
