import { describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp } from "../test/fakes.js";
import { generateDeviceToken, hashDeviceToken, looksLikeDeviceToken } from "./tokens.js";

describe("tokens", () => {
  it("токен — 43 символа base64url, хеш — sha256 hex, в БД токен не хранится", () => {
    const token = generateDeviceToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(looksLikeDeviceToken(token)).toBe(true);
    expect(hashDeviceToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDeviceToken(token)).toBe(hashDeviceToken(token));
    expect(generateDeviceToken()).not.toBe(token);
  });
});

describe("POST /api/devices", () => {
  it("создаёт устройство и возвращает {deviceId, deviceToken}; в репо только хеш", async () => {
    const { app, repos } = buildTestApp();
    const res = await request(app).post("/api/devices");
    expect(res.status).toBe(201);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.deviceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(repos.devices.byHash.has(hashDeviceToken(res.body.deviceToken))).toBe(true);
    expect(repos.devices.byHash.has(res.body.deviceToken)).toBe(false);
  });
});

describe("requireDevice", () => {
  it("без заголовка / не Bearer / мусор / неизвестный токен → 401", async () => {
    const { app } = buildTestApp();
    expect((await request(app).get("/api/snapshot")).status).toBe(401);
    expect((await request(app).get("/api/snapshot").set("Authorization", "Basic abc")).status).toBe(401);
    expect((await request(app).get("/api/snapshot").set("Authorization", "Bearer short")).status).toBe(401);
    const unknown = await request(app).get("/api/snapshot").set("Authorization", `Bearer ${generateDeviceToken()}`);
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe("unauthorized");
  });

  it("валидный токен пропускает и обновляет last_seen_at", async () => {
    const { app, repos } = buildTestApp();
    const { body } = await request(app).post("/api/devices");
    const row = repos.devices.byHash.get(hashDeviceToken(body.deviceToken))!;
    const before = row.lastSeenAt;
    await new Promise((r) => setTimeout(r, 5));
    const res = await request(app).get("/api/snapshot").set("Authorization", `Bearer ${body.deviceToken}`);
    expect(res.status).toBe(404); // авторизован, но снапшота нет
    expect(res.body.error.code).toBe("snapshot_not_found");
    expect(row.lastSeenAt.getTime()).toBeGreaterThan(before.getTime());
  });
});
