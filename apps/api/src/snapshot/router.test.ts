import { beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { buildTestApp } from "../test/fakes.js";

let app: Express;
let auth: string;

beforeEach(async () => {
  app = buildTestApp().app;
  const { body } = await request(app).post("/api/devices");
  auth = `Bearer ${body.deviceToken}`;
});

const put = (body: unknown) => request(app).put("/api/snapshot").set("Authorization", auth).send(body as object);
const get = () => request(app).get("/api/snapshot").set("Authorization", auth);

describe("PUT/GET /api/snapshot", () => {
  it("сохраняет и возвращает снапшот", async () => {
    const data = { grid: { cells: [1, 2, 3] }, year: { "2026-09-28": "clean" } };
    const res = await put({ version: 1, updatedAt: "2026-09-29T10:00:00.000Z", data });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ version: 1, updatedAt: "2026-09-29T10:00:00.000Z", sizeBytes: JSON.stringify(data).length });
    const got = await get();
    expect(got.status).toBe(200);
    expect(got.headers["cache-control"]).toBe("no-store");
    expect(got.body).toEqual({ version: 1, updatedAt: "2026-09-29T10:00:00.000Z", data });
  });

  it("version <= сохранённой → 409 snapshot_conflict с текущим снапшотом", async () => {
    await put({ version: 3, updatedAt: "2026-09-29T10:00:00Z", data: { a: 1 } });
    for (const version of [3, 2]) {
      const res = await put({ version, updatedAt: "2026-09-29T11:00:00Z", data: { a: 2 } });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("snapshot_conflict");
      expect(res.body.snapshot).toEqual({ version: 3, updatedAt: "2026-09-29T10:00:00.000Z", data: { a: 1 } });
    }
    expect((await put({ version: 4, updatedAt: "2026-09-29T11:00:00Z", data: { a: 2 } })).status).toBe(200);
    expect((await get()).body.data).toEqual({ a: 2 });
  });

  it("updatedAt: строгий ISO 8601 — с миллисекундами и со смещением тоже принимается", async () => {
    for (const [i, updatedAt] of ["2026-09-29T10:00:00.123Z", "2026-09-29T13:00:00+03:00", "2026-09-29T10:00:00Z"].entries()) {
      const res = await put({ version: 100 + i, updatedAt, data: {} });
      expect(res.status, updatedAt).toBe(200);
    }
  });

  it("невалидное тело → 400 с кодом поля", async () => {
    const base = { version: 1, updatedAt: "2026-09-29T10:00:00Z", data: {} };
    const cases: Array<[unknown, string]> = [
      [{ ...base, version: -1 }, "invalid_version"],
      [{ ...base, version: 1.5 }, "invalid_version"],
      [{ ...base, version: "1" }, "invalid_version"],
      [{ ...base, updatedAt: "yesterday" }, "invalid_updated_at"],
      [{ ...base, updatedAt: undefined }, "invalid_updated_at"],
      [{ ...base, updatedAt: "1" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "2026" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "March 7, 2026" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "2026-09-29" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "2026-09-29T10:00:00" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "2026-02-30T10:00:00Z" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "2026-09-29T25:00:00Z" }, "invalid_updated_at"],
      [{ ...base, updatedAt: 1759140000000 }, "invalid_updated_at"],
      // RFC 3339 допускает строчные t/z, но API строгий — задокументировано в README.
      [{ ...base, updatedAt: "2026-09-29t10:00:00Z" }, "invalid_updated_at"],
      [{ ...base, updatedAt: "2026-09-29T10:00:00z" }, "invalid_updated_at"],
      [{ ...base, data: [] }, "invalid_data"],
      [{ ...base, data: null }, "invalid_data"],
      [{ ...base, data: "str" }, "invalid_data"],
      [[], "invalid_body"],
    ];
    for (const [body, code] of cases) {
      const res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe(code);
    }
  });

  it("data > 1 МиБ → 413 snapshot_too_large; совсем большое тело → 413 payload_too_large", async () => {
    const big = await put({ version: 1, updatedAt: "2026-09-29T10:00:00Z", data: { blob: "x".repeat(1024 * 1024) } });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe("snapshot_too_large");
    const huge = await put({ version: 1, updatedAt: "2026-09-29T10:00:00Z", data: { blob: "x".repeat(1300 * 1024) } });
    expect(huge.status).toBe(413);
    expect(huge.body.error.code).toBe("payload_too_large");
    expect((await get()).status).toBe(404);
  });

  it("снапшоты разных устройств изолированы", async () => {
    await put({ version: 1, updatedAt: "2026-09-29T10:00:00Z", data: { mine: true } });
    const other = await request(app).post("/api/devices");
    const res = await request(app).get("/api/snapshot").set("Authorization", `Bearer ${other.body.deviceToken}`);
    expect(res.status).toBe(404);
  });
});
