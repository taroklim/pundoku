/**
 * Интеграционные тесты против реального Postgres: DATABASE_URL (или TEST_DATABASE_URL) из env/.env.
 * Если база недоступна — весь файл скипается с предупреждением, а не падает.
 * Тесты создают собственные строки (даты 1999-xx-xx, свои устройства) и убирают их за собой.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import pg from "pg";
import "./config/env.js";
import { runMigrations } from "./db/migrate.js";
import { PgDailyPuzzleRepo } from "./db/daily-puzzles-repo.js";
import { PgDeviceRepo } from "./db/devices-repo.js";
import { PgSnapshotRepo } from "./db/snapshots-repo.js";
import { createApp } from "./app.js";
import { FakeGenerator, FakeSource, SAMPLE, silentLogger } from "./test/fakes.js";
import { hashDeviceToken } from "./devices/tokens.js";

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

async function probe(): Promise<string | null> {
  if (!databaseUrl) return "DATABASE_URL не задан";
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return null;
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const unavailable = await probe();
if (unavailable) {
  console.warn(`[integration] Postgres недоступен (${unavailable}) — интеграционные тесты пропущены. Задай DATABASE_URL, чтобы запустить.`);
}

describe.skipIf(unavailable !== null)("integration (Postgres)", () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const dates = ["1999-01-01", "1999-01-02", "1999-01-03"];
  const createdDevices: string[] = [];
  const source = new FakeSource();
  const generator = new FakeGenerator();
  const app = createApp({
    repos: { dailyPuzzles: new PgDailyPuzzleRepo(pool), devices: new PgDeviceRepo(pool), snapshots: new PgSnapshotRepo(pool) },
    dailySource: source,
    generator,
    logger: silentLogger,
    webOrigins: [],
    rateLimits: { daily: 1000, devices: 1000 },
  });
  const cleanup = async () => {
    await pool.query("DELETE FROM daily_puzzles WHERE date = ANY($1::date[])", [dates]);
    if (createdDevices.length) await pool.query("DELETE FROM devices WHERE id = ANY($1::uuid[])", [createdDevices]);
  };

  beforeAll(async () => {
    await runMigrations(databaseUrl!);
    await cleanup();
  });
  afterAll(async () => {
    await cleanup();
    await pool.end();
  });

  it("миграции применены: таблицы и учёт на месте", async () => {
    const { rows } = await pool.query<{ name: string }>("SELECT name FROM schema_migrations ORDER BY name");
    expect(rows.map((r) => r.name)).toEqual(expect.arrayContaining(["0002_daily_puzzles.sql", "0003_devices_snapshots.sql"]));
  });

  it("daily: сохраняет в daily_puzzles один раз, CHECK-ограничения работают", async () => {
    const res = await request(app).get(`/api/daily/${dates[0]}`);
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("sudoku.com");
    await request(app).get(`/api/daily/${dates[0]}`);
    expect(source.calls.filter((d) => d === dates[0])).toHaveLength(1);
    const { rows } = await pool.query("SELECT mission, solution, win_rate, source, source_id FROM daily_puzzles WHERE date = $1", [dates[0]]);
    expect(rows[0]).toMatchObject({ mission: SAMPLE.mission, solution: SAMPLE.solution, win_rate: "52.10", source: "sudoku.com", source_id: SAMPLE.id });
    await expect(pool.query("INSERT INTO daily_puzzles (date, mission, solution, difficulty, source) VALUES ($1, 'x', 'y', 'hard', 'sudoku.com')", [dates[1]])).rejects.toThrow(/check/i);
  });

  it("daily: фолбэк на генератор сохраняется как generator без win_rate; verify сверяет с БД", async () => {
    source.result = { kind: "error", reason: "HTTP 503" };
    const res = await request(app).get(`/api/daily/${dates[2]}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ date: dates[2], source: "generator", difficulty: "hard" });
    expect(res.body.winRate).toBeUndefined();
    source.result = new FakeSource().result;
    const verify = await request(app).post(`/api/daily/${dates[2]}/verify`).send({ grid: SAMPLE.solution });
    expect(verify.body).toEqual({ correct: true });
  });

  it("daily: гонка двух первых запросов не ломает PK и даёт одну сетку", async () => {
    const [a, b] = await Promise.all([request(app).get(`/api/daily/${dates[1]}`), request(app).get(`/api/daily/${dates[1]}`)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body).toEqual(b.body);
    const { rowCount } = await pool.query("SELECT 1 FROM daily_puzzles WHERE date = $1", [dates[1]]);
    expect(rowCount).toBe(1);
  });

  it("devices + snapshot: токен только хешем, last_seen_at обновляется, 409 атомарно в SQL", async () => {
    const created = await request(app).post("/api/devices");
    expect(created.status).toBe(201);
    createdDevices.push(created.body.deviceId);
    const auth = `Bearer ${created.body.deviceToken}`;

    const dev = await pool.query("SELECT token_hash, last_seen_at FROM devices WHERE id = $1", [created.body.deviceId]);
    expect(dev.rows[0].token_hash).toBe(hashDeviceToken(created.body.deviceToken));

    expect((await request(app).get("/api/snapshot").set("Authorization", auth)).status).toBe(404);
    const put1 = await request(app).put("/api/snapshot").set("Authorization", auth).send({ version: 1, updatedAt: "2026-09-29T10:00:00Z", data: { a: 1, nested: { b: [1, 2] } } });
    expect(put1.status).toBe(200);
    const stale = await request(app).put("/api/snapshot").set("Authorization", auth).send({ version: 1, updatedAt: "2026-09-29T11:00:00Z", data: { a: 2 } });
    expect(stale.status).toBe(409);
    expect(stale.body.snapshot).toEqual({ version: 1, updatedAt: "2026-09-29T10:00:00.000Z", data: { a: 1, nested: { b: [1, 2] } } });
    const put2 = await request(app).put("/api/snapshot").set("Authorization", auth).send({ version: 2, updatedAt: "2026-09-29T11:00:00Z", data: { a: 2 } });
    expect(put2.status).toBe(200);
    const got = await request(app).get("/api/snapshot").set("Authorization", auth);
    expect(got.body).toEqual({ version: 2, updatedAt: "2026-09-29T11:00:00.000Z", data: { a: 2 } });

    const dev2 = await pool.query("SELECT last_seen_at FROM devices WHERE id = $1", [created.body.deviceId]);
    expect(new Date(dev2.rows[0].last_seen_at).getTime()).toBeGreaterThanOrEqual(new Date(dev.rows[0].last_seen_at).getTime());

    // ON DELETE CASCADE: удаление устройства убирает снапшот.
    await pool.query("DELETE FROM devices WHERE id = $1", [created.body.deviceId]);
    const snap = await pool.query("SELECT 1 FROM snapshots WHERE device_id = $1", [created.body.deviceId]);
    expect(snap.rowCount).toBe(0);
    createdDevices.length = 0;
  });
});
