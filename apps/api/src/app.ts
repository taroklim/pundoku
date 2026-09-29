import express from "express";
import cors from "cors";
import helmet from "helmet";
import type { DailyPuzzleRepo, DailyPuzzleSource, PuzzleGenerator } from "./daily/types.js";
import { DailyService } from "./daily/service.js";
import { dailyRouter } from "./daily/router.js";
import type { DeviceRepo } from "./devices/types.js";
import { devicesRouter } from "./devices/router.js";
import type { SnapshotRepo } from "./snapshot/types.js";
import { snapshotRouter } from "./snapshot/router.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { rateLimit } from "./middleware/rate-limit.js";
import { requestLog } from "./middleware/request-log.js";
import type { Logger } from "./lib/logger.js";

export interface AppDeps {
  repos: { dailyPuzzles: DailyPuzzleRepo; devices: DeviceRepo; snapshots: SnapshotRepo };
  dailySource: DailyPuzzleSource;
  generator: PuzzleGenerator;
  logger: Logger;
  webOrigins: string[];
  fallbackDifficulty?: string;
  /** Троттлинг перезапроса Sudoku.com за фолбэк-датой (мс), см. DailyServiceDeps.upstreamRetryMs. */
  upstreamRetryMs?: number;
  trustProxy?: boolean;
  now?: () => Date;
  rateLimits?: { daily?: number; devices?: number };
}

/**
 * Сборка Express-приложения отдельно от listen() — тесты (supertest) поднимают app без сети,
 * подставляя in-memory репозитории и фейковый источник. Реальные зависимости собирает index.ts.
 */
export function createApp(deps: AppDeps): express.Express {
  const app = express();
  app.disable("x-powered-by");
  if (deps.trustProxy) app.set("trust proxy", 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(
    cors({
      origin: deps.webOrigins,
      methods: ["GET", "POST", "PUT"],
      allowedHeaders: ["Authorization", "Content-Type"],
      maxAge: 600,
    }),
  );
  app.use(requestLog(deps.logger));
  // Чуть больше лимита снапшота (1 МиБ на data) — чтобы собственная проверка size_bytes давала
  // понятный 413, а не body-parser; совсем большие тела всё равно режет body-parser.
  app.use(express.json({ limit: "1200kb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "pundoku-api", time: new Date().toISOString() });
  });

  const dailyService = new DailyService({
    repo: deps.repos.dailyPuzzles,
    source: deps.dailySource,
    generator: deps.generator,
    fallbackDifficulty: deps.fallbackDifficulty ?? "hard",
    logger: deps.logger,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.upstreamRetryMs !== undefined ? { upstreamRetryMs: deps.upstreamRetryMs } : {}),
  });

  app.use("/api/daily", rateLimit({ windowMs: 60_000, max: deps.rateLimits?.daily ?? 60 }), dailyRouter(dailyService));
  app.use("/api/devices", rateLimit({ windowMs: 60_000, max: deps.rateLimits?.devices ?? 10 }), devicesRouter(deps.repos.devices));
  app.use("/api/snapshot", snapshotRouter(deps.repos.devices, deps.repos.snapshots));

  app.use(notFoundHandler);
  app.use(errorHandler(deps.logger));
  return app;
}
