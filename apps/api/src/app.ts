import express from "express";

/**
 * Сборка Express-приложения отдельно от listen() — чтобы тесты (supertest и т.п.)
 * могли поднимать app без сети. Эндпоинты продукта (Today-прокси, прогресс) — PD-3.
 */
export function createApp(): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "pundoku-api", time: new Date().toISOString() });
  });

  return app;
}
