import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";

// .env ищем сначала рядом с пакетом (apps/api/.env), потом в корне репо — README велит
// `cp .env.example .env` в корне, а `pnpm --filter @pundoku/api ...` запускается из apps/api.
// Первое найденное значение переменной выигрывает, уже заданные в окружении не перезаписываются.
loadDotenv({
  path: [
    fileURLToPath(new URL("../../.env", import.meta.url)),
    fileURLToPath(new URL("../../../../.env", import.meta.url)),
  ],
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана (см. .env.example в корне репо)`);
  }
  return value;
}

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Переменная окружения ${name} должна быть целым неотрицательным числом, получено: ${raw}`);
  }
  return value;
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 3000),
  /** Читается лениво — /health и dev-запуск не должны падать без базы. */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  /** Источник ежедневной сетки (Sudoku.com). Только через прокси, никогда из браузера. */
  sudokuComBaseUrl: process.env.SUDOKU_COM_BASE_URL ?? "https://sudoku.com/api/v2",
  sudokuComTimeoutMs: integer("SUDOKU_COM_TIMEOUT_MS", 5000),
  /** Сложность для сгенерированной сетки дня, когда Sudoku.com недоступен (у Sudoku.com daily — hard). */
  dailyFallbackDifficulty: process.env.DAILY_FALLBACK_DIFFICULTY ?? "hard",
  /** Как часто (мс) перезапрашивать Sudoku.com за датой, у которой в кэше лежит фолбэк-сетка. */
  dailyUpstreamRetryMs: integer("DAILY_UPSTREAM_RETRY_MS", 60_000),
  /** Разрешённые origin'ы для CORS (через запятую). */
  webOrigins: list("WEB_ORIGIN", ["http://localhost:5173"]),
  /** pino: trace|debug|info|warn|error|silent. */
  logLevel: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  /** Express `trust proxy` — включать за reverse proxy, чтобы rate-limit видел реальный IP. */
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
} as const;
