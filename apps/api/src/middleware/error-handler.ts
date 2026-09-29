import type { ErrorRequestHandler, RequestHandler } from "express";
import { HttpError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";

/** 404 для неизвестных маршрутов — тем же JSON-форматом, что и остальные ошибки. */
export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: { code: "not_found", message: `Маршрут ${req.method} ${req.path} не найден` } });
};

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err: unknown, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message }, ...err.extra });
      return;
    }
    const parserError = err as BodyParserError;
    if (parserError?.type === "entity.too.large") {
      res.status(413).json({ error: { code: "payload_too_large", message: "Тело запроса больше допустимого" } });
      return;
    }
    if (parserError?.type === "entity.parse.failed") {
      res.status(400).json({ error: { code: "invalid_json", message: "Тело запроса — невалидный JSON" } });
      return;
    }
    logger.error({ err }, "unhandled error");
    res.status(500).json({ error: { code: "internal", message: "Внутренняя ошибка сервера" } });
  };
}
