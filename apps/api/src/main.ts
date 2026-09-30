import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { createPool } from "./db/pool.js";
import { PgDailyPuzzleRepo } from "./db/daily-puzzles-repo.js";
import { PgDeviceRepo } from "./db/devices-repo.js";
import { PgSnapshotRepo } from "./db/snapshots-repo.js";
import { PgRecoveryRepo } from "./db/recovery-repo.js";
import { SudokuComSource } from "./daily/sudoku-com-source.js";
import { EngineGenerator } from "./daily/generator.js";
import { createLogger } from "./lib/logger.js";

const logger = createLogger();
// Проверка секрета ключа восстановления — при старте (ConfigError без стека ловит index.ts).
const recovery = env.recovery;
if (recovery.hmacSecretIsDevDefault) logger.warn("RECOVERY_KEY_HMAC_SECRET не задан: используется dev-секрет (допустимо только в development)");
const pool = createPool(env.databaseUrl);
pool.on("error", (err) => logger.error({ err }, "pg pool error"));

const app = createApp({
  repos: {
    dailyPuzzles: new PgDailyPuzzleRepo(pool),
    devices: new PgDeviceRepo(pool),
    snapshots: new PgSnapshotRepo(pool),
    recovery: new PgRecoveryRepo(pool),
  },
  recovery: { hmacSecret: recovery.hmacSecret },
  dailySource: new SudokuComSource({ baseUrl: env.sudokuComBaseUrl, timeoutMs: env.sudokuComTimeoutMs }),
  generator: new EngineGenerator(),
  logger,
  webOrigins: env.webOrigins,
  fallbackDifficulty: env.dailyFallbackDifficulty,
  upstreamRetryMs: env.dailyUpstreamRetryMs,
  trustProxy: env.trustProxy,
});

const server = app.listen(env.port, () => {
  logger.info(`[pundoku-api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  });
}
