/**
 * Сценарии ключа восстановления (PD-27), общие для двух реализаций хранилища: in-memory (unit, всегда) и Postgres
 * (integration, если есть TEST_DATABASE_URL). Один набор проверок гарантирует, что Memory-зеркало не расходится
 * с настоящим SQL. Всё идёт через HTTP (supertest) — как это делает клиент.
 */
import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import type { RecoveryLimits } from "../recovery/router.js";
import type { Logger } from "../lib/logger.js";

export interface AppHarness {
  app: Express;
}
export interface HarnessOptions {
  limits?: RecoveryLimits;
  clock?: () => number;
  logger?: Logger;
}
export type HarnessFactory = (options?: HarnessOptions) => AppHarness;

export const KEY_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/;

export interface Device {
  id: string;
  token: string;
  auth: string;
}

export async function newDevice(app: Express): Promise<Device> {
  const res = await request(app).post("/api/devices");
  expect(res.status).toBe(201);
  return { id: res.body.deviceId, token: res.body.deviceToken, auth: `Bearer ${res.body.deviceToken}` };
}

export const putSnapshot = (app: Express, d: Device, version: number, data: Record<string, unknown>) =>
  request(app).put("/api/snapshot").set("Authorization", d.auth).send({ version, updatedAt: "2026-09-30T10:00:00Z", data });
export const getSnapshot = (app: Express, d: Device) => request(app).get("/api/snapshot").set("Authorization", d.auth);
export const createKey = (app: Express, d: Device) => request(app).post("/api/recovery/key").set("Authorization", d.auth);
export const rotateKey = (app: Express, d: Device) => request(app).post("/api/recovery/key/rotate").set("Authorization", d.auth);
export const redeem = (app: Express, d: Device, key: unknown) => request(app).post("/api/recovery/redeem").set("Authorization", d.auth).send({ key });
export const status = (app: Express, d: Device) => request(app).get("/api/recovery").set("Authorization", d.auth);
export const unlink = (app: Express, d: Device) => request(app).delete("/api/recovery/link").set("Authorization", d.auth);
export const deleteKey = (app: Express, d: Device) => request(app).delete("/api/recovery").set("Authorization", d.auth);

/** Устройство с ключом и снапшотом: типовая стартовая точка. */
async function seeded(app: Express, data: Record<string, unknown> = { days: { d1: "A" } }) {
  const a = await newDevice(app);
  expect((await putSnapshot(app, a, 1, data)).status).toBe(200);
  const created = await createKey(app, a);
  expect(created.status).toBe(201);
  return { a, key: created.body.key as string };
}

export function defineRecoveryScenarios(label: string, harness: HarnessFactory): void {
  describe(`recovery: ${label}`, () => {
    it("создание ключа: 201 {key, devices:1}, формат 8×4 Crockford, no-store; статус; повтор → 409 key_exists", async () => {
      const { app } = harness();
      const a = await newDevice(app);
      expect((await status(app, a)).body).toEqual({ hasKey: false });
      const res = await createKey(app, a);
      expect(res.status).toBe(201);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.body.key).toMatch(KEY_RE);
      expect(res.body.devices).toBe(1);
      const st = await status(app, a);
      expect(st.body).toMatchObject({ hasKey: true, devices: 1 });
      expect(new Date(st.body.keyCreatedAt).toString()).not.toBe("Invalid Date");
      const again = await createKey(app, a);
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("key_exists");
      expect(again.body.key).toBeUndefined();
    });

    it("без токена / с чужим токеном все эндпоинты — 401", async () => {
      const { app } = harness();
      for (const [method, url] of [["post", "/api/recovery/key"], ["post", "/api/recovery/key/rotate"], ["post", "/api/recovery/redeem"], ["get", "/api/recovery"], ["delete", "/api/recovery/link"], ["delete", "/api/recovery"]] as const) {
        const res = await request(app)[method](url).send({ key: "x" });
        expect(res.status, `${method} ${url}`).toBe(401);
      }
    });

    it("снапшот устройства-создателя становится снапшотом группы; второе устройство после redeem читает его и пишет туда же; 409 между устройствами", async () => {
      const { app } = harness();
      const { a, key } = await seeded(app, { days: { d1: "A" } });
      const b = await newDevice(app);
      expect((await getSnapshot(app, b)).status).toBe(404); // до присоединения у B своего снапшота нет

      const joined = await redeem(app, b, key);
      expect(joined.status).toBe(200);
      expect(joined.body).toEqual({ linked: true, devices: 2 });
      expect((await getSnapshot(app, b)).body).toEqual({ version: 1, updatedAt: "2026-09-30T10:00:00.000Z", data: { days: { d1: "A" } } });

      // B пишет — A видит.
      expect((await putSnapshot(app, b, 2, { days: { d1: "A", d2: "B" } })).status).toBe(200);
      expect((await getSnapshot(app, a)).body.data).toEqual({ days: { d1: "A", d2: "B" } });
      // Оба шлют version 3 — второй получает 409 с текущим снапшотом группы (логика upsertIfNewer без изменений).
      expect((await putSnapshot(app, a, 3, { from: "a" })).status).toBe(200);
      const conflict = await putSnapshot(app, b, 3, { from: "b" });
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe("snapshot_conflict");
      expect(conflict.body.snapshot.data).toEqual({ from: "a" });
      expect(await status(app, b).then((r) => r.body)).toMatchObject({ hasKey: true, devices: 2 });
    });

    it("redeem: нормализация ввода (регистр, пробелы, дефисы, O→0, I/L→1) и идемпотентность", async () => {
      const { app } = harness();
      const { key } = await seeded(app);
      const b = await newDevice(app);
      const messy = key.toLowerCase().replace(/-/g, " ").replace(/0/g, "o").replace(/1/g, "l");
      const res = await redeem(app, b, `  ${messy}  `);
      expect(res.status).toBe(200);
      expect(res.body.devices).toBe(2);
      const again = await redeem(app, b, key); // уже в группе — идемпотентный успех
      expect(again.status).toBe(200);
      expect(again.body.devices).toBe(2);
      expect((await redeem(app, b, key.replace(/-/g, ""))).body.devices).toBe(2);
    });

    it("неверный ключ: один и тот же 400 invalid_key для любой причины (формат, чужой, перевыпущенный, удалённый, не строка)", async () => {
      const { app } = harness({ limits: { redeemFailuresPerDevice: 1000, redeemFailuresPerIp: 1000 } });
      const { a, key } = await seeded(app);
      const b = await newDevice(app);
      const other = (await createKey(app, await newDevice(app))).body.key as string;
      await rotateKey(app, a); // key устарел
      const dead = (await createKey(app, await newDevice(app))).body.key as string;
      const gone = await newDevice(app);
      const goneKey = (await createKey(app, gone)).body.key as string;
      await deleteKey(app, gone);

      const bodies: unknown[] = [];
      for (const bad of [goneKey, "", "abc", "0".repeat(32), "ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ", "x".repeat(500), key, 123, null, { a: 1 }, ["x"], undefined]) {
        const res = await redeem(app, b, bad);
        expect(res.status, JSON.stringify(bad)).toBe(400);
        expect(res.body.error.code).toBe("invalid_key");
        bodies.push(res.body);
      }
      // Ключ, которого не выдавали, и «раньше существовавший» (перевыпущенный) неотличимы — ответ побайтно одинаков.
      expect(new Set(bodies.map((x) => JSON.stringify(x))).size).toBe(1);
      expect((await status(app, b)).body).toEqual({ hasKey: false }); // ничего не привязалось
      // sanity: рабочие ключи работают, чтобы тест выше не был вакуумным.
      expect(other).toMatch(KEY_RE);
      expect(dead).toMatch(KEY_RE);
    });

    it("перевыпуск: старый ключ перестаёт работать, новый работает, состав группы не меняется; без группы — 404 no_key", async () => {
      const { app } = harness();
      const b = await newDevice(app);
      const none = await rotateKey(app, b);
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe("no_key");

      const { a, key } = await seeded(app);
      const c = await newDevice(app);
      expect((await redeem(app, c, key)).status).toBe(200);
      const rotated = await rotateKey(app, c); // перевыпустить может любое устройство группы
      expect(rotated.status).toBe(200);
      expect(rotated.headers["cache-control"]).toBe("no-store");
      expect(rotated.body.key).toMatch(KEY_RE);
      expect(rotated.body.key).not.toBe(key);
      expect((await redeem(app, b, key)).status).toBe(400);
      expect((await redeem(app, b, rotated.body.key)).status).toBe(200);
      expect((await status(app, a)).body).toMatchObject({ hasKey: true, devices: 3 });
    });

    it("устройство из другой группы при redeem сначала выходит из неё; старая группа с оставшимся устройством живёт", async () => {
      const { app } = harness();
      const g1 = await seeded(app, { g: 1 });
      const g2 = await seeded(app, { g: 2 });
      const m = await newDevice(app);
      expect((await redeem(app, m, g2.key)).body.devices).toBe(2);
      expect((await redeem(app, m, g1.key)).body.devices).toBe(2); // m ушёл из g2 в g1
      expect((await getSnapshot(app, m)).body.data).toEqual({ g: 1 });
      expect((await status(app, g2.a)).body).toMatchObject({ hasKey: true, devices: 1 });
      expect((await getSnapshot(app, g2.a)).body.data).toEqual({ g: 2 });
    });

    it("отвязка НЕ владельца: он получает копию снапшота группы как собственный, группа продолжает жить", async () => {
      const { app } = harness();
      const { a, key } = await seeded(app, { days: { d1: "A" } });
      const b = await newDevice(app);
      await redeem(app, b, key);
      await putSnapshot(app, b, 2, { days: { d1: "A", d2: "B" } });

      const res = await unlink(app, b);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ linked: false });
      expect((await status(app, b)).body).toEqual({ hasKey: false });
      expect((await status(app, a)).body).toMatchObject({ hasKey: true, devices: 1 });
      const copy = await getSnapshot(app, b);
      expect(copy.body).toMatchObject({ version: 2, data: { days: { d1: "A", d2: "B" } } });
      // Копии независимы: запись B больше не попадает в группу.
      expect((await putSnapshot(app, b, 3, { only: "b" })).status).toBe(200);
      expect((await getSnapshot(app, a)).body.data).toEqual({ days: { d1: "A", d2: "B" } });
      expect((await unlink(app, b)).status).toBe(200); // идемпотентно
    });

    it("отвязка ВЛАДЕЛЬЦА при наличии других: снапшот группы переезжает, ключ жив, у ушедшего остаётся копия", async () => {
      const { app } = harness();
      const { a, key } = await seeded(app, { days: { d1: "A" } });
      const b = await newDevice(app);
      await redeem(app, b, key);

      expect((await unlink(app, a)).status).toBe(200);
      expect((await status(app, b)).body).toMatchObject({ hasKey: true, devices: 1 });
      expect((await getSnapshot(app, b)).body.data).toEqual({ days: { d1: "A" } }); // группа не потеряла снапшот
      expect((await getSnapshot(app, a)).body.data).toEqual({ days: { d1: "A" } }); // и у ушедшего своя копия
      // Новый владелец пишет — у ушедшего копия не меняется.
      await putSnapshot(app, b, 2, { days: { d1: "A", d2: "B" } });
      expect((await getSnapshot(app, a)).body.data).toEqual({ days: { d1: "A" } });
      // Ключ по-прежнему присоединяет устройства.
      const c = await newDevice(app);
      expect((await redeem(app, c, key)).body.devices).toBe(2);
      expect((await getSnapshot(app, c)).body.data).toEqual({ days: { d1: "A", d2: "B" } });
    });

    it("отвязка последнего устройства гасит группу и ключ, снапшот остаётся у устройства", async () => {
      const { app } = harness();
      const { a, key } = await seeded(app, { days: { d1: "A" } });
      expect((await unlink(app, a)).status).toBe(200);
      expect((await status(app, a)).body).toEqual({ hasKey: false });
      expect((await getSnapshot(app, a)).body.data).toEqual({ days: { d1: "A" } });
      const b = await newDevice(app);
      expect((await redeem(app, b, key)).status).toBe(400);
      // Можно завести новую группу с нуля.
      expect((await createKey(app, a)).status).toBe(201);
    });

    it("«удалить ключ»: группа и связи удалены, ключ мёртв, снапшот группы достаётся инициатору, остальные — к своим", async () => {
      const { app } = harness();
      const { a, key } = await seeded(app, { days: { d1: "A" } });
      const b = await newDevice(app);
      await redeem(app, b, key);
      await putSnapshot(app, b, 2, { days: { d1: "A", d2: "B" } });

      const res = await deleteKey(app, b); // инициатор — НЕ владелец
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ hasKey: false });
      expect((await status(app, a)).body).toEqual({ hasKey: false });
      expect((await status(app, b)).body).toEqual({ hasKey: false });
      expect((await getSnapshot(app, b)).body).toMatchObject({ version: 2, data: { days: { d1: "A", d2: "B" } } });
      expect((await getSnapshot(app, a)).status).toBe(404); // строка переехала к инициатору; A выгрузит локальные данные сам
      expect((await putSnapshot(app, a, 1, { days: { d1: "A" } })).status).toBe(200);
      expect((await redeem(app, await newDevice(app), key)).status).toBe(400);
      expect((await deleteKey(app, b)).status).toBe(200); // идемпотентно
    });

    it("«удалить ключ» владельцем: снапшот остаётся у него", async () => {
      const { app } = harness();
      const { a, key } = await seeded(app, { days: { d1: "A" } });
      const b = await newDevice(app);
      await redeem(app, b, key);
      await deleteKey(app, a);
      expect((await getSnapshot(app, a)).body.data).toEqual({ days: { d1: "A" } });
      expect((await status(app, b)).body).toEqual({ hasKey: false });
    });

    it("создание ключа устройством с собственным снапшотом, присоединённым позже: сироту redeem не удаляет, но читается снапшот группы", async () => {
      const { app } = harness();
      const { key } = await seeded(app, { group: true });
      const b = await newDevice(app);
      expect((await putSnapshot(app, b, 7, { own: "b" })).status).toBe(200);
      await redeem(app, b, key);
      expect((await getSnapshot(app, b)).body.data).toEqual({ group: true });
    });

    describe("лимиты", () => {
      it("redeem: по устройству — после N неудач 429 (даже с верным ключом), успехи не считаются, окно истекает", async () => {
        let t = 1_000_000;
        const { app } = harness({ limits: { redeemFailuresPerDevice: 3, redeemFailuresPerIp: 1000 }, clock: () => t });
        const { key } = await seeded(app);
        const b = await newDevice(app);
        for (let i = 0; i < 5; i++) expect((await redeem(app, b, key)).status).toBe(200); // успехи не считаются
        const c = await newDevice(app);
        for (let i = 0; i < 3; i++) expect((await redeem(app, c, "nope")).status).toBe(400);
        const blocked = await redeem(app, c, key);
        expect(blocked.status).toBe(429);
        expect(blocked.body.error.code).toBe("rate_limited");
        expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
        expect((await status(app, c)).body).toEqual({ hasKey: false }); // 429 не привязал
        t += 60 * 60_000 + 1;
        expect((await redeem(app, c, key)).status).toBe(200);
      });

      it("redeem: по IP — неудачи разных устройств суммируются", async () => {
        const { app } = harness({ limits: { redeemFailuresPerIp: 4, redeemFailuresPerDevice: 1000 } });
        const [d1, d2, d3] = [await newDevice(app), await newDevice(app), await newDevice(app)] as [Device, Device, Device];
        for (const d of [d1, d1, d2, d2]) expect((await redeem(app, d, "nope")).status).toBe(400);
        expect((await redeem(app, d3, "nope")).status).toBe(429); // d3 чист, но IP исчерпан
      });

      it("создание+перевыпуск ключа: общий лимит на устройство, остальные устройства не затронуты", async () => {
        const { app } = harness({ limits: { issuePerDevice: 3 } });
        const a = await newDevice(app);
        expect((await createKey(app, a)).status).toBe(201);
        expect((await rotateKey(app, a)).status).toBe(200);
        expect((await rotateKey(app, a)).status).toBe(200);
        const over = await rotateKey(app, a);
        expect(over.status).toBe(429);
        expect(over.body.error.code).toBe("rate_limited");
        expect((await createKey(app, await newDevice(app))).status).toBe(201);
      });
    });
  });
}
