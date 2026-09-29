import { pinoHttp } from "pino-http";
import type { RequestHandler } from "express";
import type { Logger } from "../lib/logger.js";

/** Лог запросов через pino-http. Authorization маскируется redact-правилом логгера. */
export function requestLog(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
  }) as unknown as RequestHandler;
}
