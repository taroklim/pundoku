import { DIFFICULTIES } from "@pundoku/engine";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { ConfigError } from "./errors.js";

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
    throw new ConfigError(`Переменная окружения ${name} не задана (см. .env.example в корне репо)`);
  }
  return value;
}

/** Только десятичные цифры: `Number()` пропустил бы пробелы (" " → 0), `1e3`, `0x10`, `1.0`. */
const DIGITS = /^\d+$/;

function integer(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!DIGITS.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new ConfigError(`Переменная окружения ${name} должна быть целым неотрицательным числом, получено: ${raw}`);
  }
  return Number(raw);
}

/**
 * TCP-порт для `listen`: целое 1..65535. Порт 0 («случайный») отвергаем сознательно — для сервера,
 * за которым стоит прокси/compose с фиксированным адресом, он бессмыслен (реальный порт неизвестен
 * оператору), а тесты api поднимают app через supertest без listen. Не задан → дефолт; заданный, но
 * пустой (`PORT=`) → ошибка: это опечатка в конфиге, а не «возьми дефолт». Иначе `PORT=abc` дошло бы
 * до `listen` сырым ERR_SOCKET_BAD_PORT со стеком.
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!DIGITS.test(raw) || value < 1 || value > 65535) {
    throw new ConfigError(`Переменная окружения ${name} должна быть целым числом от 1 до 65535, получено: ${raw}`);
  }
  return value;
}

/** Уровни pino. Неизвестный уровень pino бросает сырую ошибку со стеком при создании логгера в main.ts. */
export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"] as const;

function logLevel(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!(LOG_LEVELS as readonly string[]).includes(raw)) {
    throw new ConfigError(`Переменная окружения ${name} должна быть одной из ${LOG_LEVELS.join("|")}, получено: ${raw}`);
  }
  return raw;
}

/** Классы движка берутся из `DIFFICULTIES` (@pundoku/engine) — свой список тут разошёлся бы с движком. Проверка — при старте, а не при первом фолбэке. */
function difficulty(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!(DIFFICULTIES as readonly string[]).includes(raw)) {
    throw new ConfigError(`Переменная окружения ${name} должна быть одной из ${DIFFICULTIES.join("|")}, получено: ${raw}`);
  }
  return raw;
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
  port: port("PORT", 3000),
  /** Читается лениво — /health и dev-запуск не должны падать без базы. */
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  /** Источник ежедневной сетки (Sudoku.com). Только через прокси, никогда из браузера. */
  sudokuComBaseUrl: process.env.SUDOKU_COM_BASE_URL ?? "https://sudoku.com/api/v2",
  sudokuComTimeoutMs: integer("SUDOKU_COM_TIMEOUT_MS", 5000),
  /**
   * Сложность сгенерированной сетки дня, когда Sudoku.com недоступен. По умолчанию `medium` —
   * профиль движка 30 подсказок/singles (v2, PD-9), близкий к Sudoku.com «hard» (их daily решается
   * одними singles при 30 подсказках); движковый `hard` — уже 26 подсказок + locked candidates.
   */
  dailyFallbackDifficulty: difficulty("DAILY_FALLBACK_DIFFICULTY", "medium"),
  /** Как часто (мс) перезапрашивать Sudoku.com за датой, у которой в кэше лежит фолбэк-сетка. */
  dailyUpstreamRetryMs: integer("DAILY_UPSTREAM_RETRY_MS", 60_000),
  /** Разрешённые origin'ы для CORS (через запятую). */
  webOrigins: list("WEB_ORIGIN", ["http://localhost:5173"]),
  /** pino: trace|debug|info|warn|error|silent. */
  logLevel: logLevel("LOG_LEVEL", process.env.NODE_ENV === "test" ? "silent" : "info"),
  /** Express `trust proxy` — включать за reverse proxy, чтобы rate-limit видел реальный IP. */
  trustProxy: process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true",
} as const;
