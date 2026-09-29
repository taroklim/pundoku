import { Router } from "express";
import type { DailyService } from "./service.js";
import type { DailyPuzzle, DailyPuzzleResponse } from "./types.js";
import { SOLUTION_RE } from "./types.js";
import { badRequest } from "../lib/errors.js";
import { isValidIsoDate } from "../lib/date.js";

export function toResponse(p: DailyPuzzle): DailyPuzzleResponse {
  return {
    date: p.date,
    mission: p.mission,
    difficulty: p.difficulty,
    ...(p.winRate === null ? {} : { winRate: p.winRate }),
    source: p.source,
  };
}

function parseDateParam(raw: unknown): string {
  if (typeof raw !== "string" || !isValidIsoDate(raw)) {
    throw badRequest("invalid_date", "Дата должна быть в формате YYYY-MM-DD и существовать в календаре");
  }
  return raw;
}

export function dailyRouter(service: DailyService): Router {
  const router = Router();

  router.get("/:date", async (req, res) => {
    const date = parseDateParam(req.params.date);
    const puzzle = await service.get(date);
    // Сетка Sudoku.com неизменна — кэшируем спокойно. Фолбэк-сетка временная (заменится настоящей
    // при следующем ответе Sudoku.com), поэтому её держим в кэше клиентов/CDN недолго.
    res.setHeader("Cache-Control", puzzle.source === "generator" ? "public, max-age=60" : "public, max-age=3600");
    res.json(toResponse(puzzle));
  });

  router.post("/:date/verify", async (req, res) => {
    const date = parseDateParam(req.params.date);
    const grid = (req.body as { grid?: unknown } | undefined)?.grid;
    if (typeof grid !== "string" || !SOLUTION_RE.test(grid)) {
      throw badRequest("invalid_grid", "grid должен быть строкой из 81 цифры 1-9");
    }
    const puzzle = await service.get(date);
    res.setHeader("Cache-Control", "no-store");
    res.json({ correct: grid === puzzle.solution });
  });

  return router;
}
