import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, FakeGenerator, FakeSource, SAMPLE } from "../test/fakes.js";

// В тестах «сейчас» = 2026-09-29T12:00Z (см. buildTestApp).
describe("GET /api/daily/:date", () => {
  it("отдаёт сетку из Sudoku.com без solution и с Cache-Control", async () => {
    const { app, repos } = buildTestApp();
    const res = await request(app).get("/api/daily/2026-09-28");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.body).toEqual({ date: "2026-09-28", mission: SAMPLE.mission, difficulty: "hard", winRate: 52.1, source: "sudoku.com" });
    expect(JSON.stringify(res.body)).not.toContain(SAMPLE.solution);
    expect(repos.dailyPuzzles.rows.get("2026-09-28")?.sourceId).toBe(SAMPLE.id);
  });

  it("кэширует: второй запрос не идёт в источник", async () => {
    const { app, dailySource } = buildTestApp();
    await request(app).get("/api/daily/2026-09-28");
    await request(app).get("/api/daily/2026-09-28");
    expect(dailySource.calls).toEqual(["2026-09-28"]);
  });

  it("невалидная дата → 400 invalid_date", async () => {
    const { app } = buildTestApp();
    for (const bad of ["2026-02-30", "2026-13-01", "20260928", "abc", "2026-9-8"]) {
      const res = await request(app).get(`/api/daily/${bad}`);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe("invalid_date");
    }
  });

  it("завтра (UTC) допустимо, послезавтра → 400 future_date", async () => {
    const { app, dailySource } = buildTestApp();
    expect((await request(app).get("/api/daily/2026-09-30")).status).toBe(200);
    const res = await request(app).get("/api/daily/2026-10-01");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("future_date");
    expect(dailySource.calls).toEqual(["2026-09-30"]);
  });

  it("источник 403/ошибка → фолбэк на генератор (передаётся дата, seed собирает движок), сохраняется как generator", async () => {
    const { app, generator, repos } = buildTestApp({ dailySource: new FakeSource({ kind: "error", reason: "HTTP 403" }) });
    const res = await request(app).get("/api/daily/2026-09-28");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("generator");
    expect(res.body.winRate).toBeUndefined();
    expect(res.body.difficulty).toBe("hard");
    expect((generator as FakeGenerator).calls).toEqual([{ date: "2026-09-28", difficulty: "hard" }]);
    expect(repos.dailyPuzzles.rows.get("2026-09-28")?.source).toBe("generator");
  });

  it("источник 204 на сегодня → генератор; на завтра → 404 not_available_yet без кэша", async () => {
    const { app, generator, repos } = buildTestApp({ dailySource: new FakeSource({ kind: "not_available" }) });
    expect((await request(app).get("/api/daily/2026-09-29")).body.source).toBe("generator");
    const res = await request(app).get("/api/daily/2026-09-30");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_available_yet");
    expect(repos.dailyPuzzles.rows.has("2026-09-30")).toBe(false);
    expect((generator as FakeGenerator).calls.map((c) => c.date)).toEqual(["2026-09-29"]);
  });

  it("источник и генератор оба упали → 500 в JSON-формате", async () => {
    const { app } = buildTestApp({ dailySource: new FakeSource({ kind: "error", reason: "x" }), generator: new FakeGenerator(true) });
    const res = await request(app).get("/api/daily/2026-09-28");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: { code: "internal", message: expect.any(String) } });
  });

  it("rate-limit по IP: сверх лимита 429 с Retry-After", async () => {
    const { app } = buildTestApp({ rateLimits: { daily: 2 } });
    await request(app).get("/api/daily/2026-09-28");
    const second = await request(app).get("/api/daily/2026-09-28");
    expect(second.headers["ratelimit-remaining"]).toBe("0");
    const third = await request(app).get("/api/daily/2026-09-28");
    expect(third.status).toBe(429);
    expect(third.headers["retry-after"]).toBeDefined();
    expect(third.body.error.code).toBe("rate_limited");
  });
});

describe("POST /api/daily/:date/verify", () => {
  it("верное решение → correct: true, неверное → false", async () => {
    const { app } = buildTestApp();
    const ok = await request(app).post("/api/daily/2026-09-28/verify").send({ grid: SAMPLE.solution });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ correct: true });
    const wrong = SAMPLE.solution.slice(0, 80) + (SAMPLE.solution.endsWith("1") ? "2" : "1");
    expect((await request(app).post("/api/daily/2026-09-28/verify").send({ grid: wrong })).body).toEqual({ correct: false });
  });

  it("grid не 81 цифра 1-9 → 400 invalid_grid", async () => {
    const { app } = buildTestApp();
    for (const grid of [SAMPLE.mission, "123", 42, undefined]) {
      const res = await request(app).post("/api/daily/2026-09-28/verify").send({ grid });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("invalid_grid");
    }
  });

  it("невалидный JSON в теле → 400 invalid_json", async () => {
    const { app } = buildTestApp();
    const res = await request(app).post("/api/daily/2026-09-28/verify").set("content-type", "application/json").send("{oops");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("invalid_json");
  });
});

describe("общее", () => {
  it("неизвестный маршрут → 404 JSON", async () => {
    const { app } = buildTestApp();
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("CORS: разрешённый origin получает заголовок, чужой — нет", async () => {
    const { app } = buildTestApp();
    const ok = await request(app).get("/health").set("Origin", "http://localhost:5173");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    const other = await request(app).get("/health").set("Origin", "https://evil.example");
    expect(other.headers["access-control-allow-origin"]).toBeUndefined();
  });
});
