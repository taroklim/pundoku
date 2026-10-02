/**
 * Ключ восстановления против реального Postgres. Нужен TEST_DATABASE_URL на СВЕЖЕЙ базе с применёнными миграциями
 * (`createdb pundoku_pd47 && DATABASE_URL=... pnpm --filter @pundoku/api migrate`); без него файл скипается.
 * Изоляция — уникальными данными (каждый сценарий заводит собственные устройства), массовых DELETE нет.
 * Те же сценарии, что и на in-memory репозитории (test/recovery-scenarios.ts), плюс гонки и проверки SQL.
 */
import { afterAll, describe, expect, it } from "vitest";
import pg from "pg";
import { createApp } from "../app.js";
import { PgDailyPuzzleRepo } from "../db/daily-puzzles-repo.js";
import { PgDeviceRepo } from "../db/devices-repo.js";
import { PgRecoveryRepo } from "../db/recovery-repo.js";
import { PgSnapshotRepo } from "../db/snapshots-repo.js";
import { FakeGenerator, FakeSource, TEST_HMAC_SECRET, silentLogger } from "../test/fakes.js";
import { cancelRotation, confirmRotation, createKey, defineRecoveryScenarios, deleteKey, getSnapshot, newDevice, putSnapshot, redeem, rotateKey, status, unlink, type HarnessOptions } from "../test/recovery-scenarios.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

async function probe(): Promise<string | null> {
  if (!databaseUrl) return "TEST_DATABASE_URL не задан";
  const client = new pg.Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.query("SELECT 1 FROM sync_groups LIMIT 1");
    return null;
  } catch (error) {
    return (error as Error).message;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const unavailable = await probe();
if (unavailable) console.warn(`[recovery integration] пропущено: ${unavailable}`);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 8 });
afterAll(() => pool.end());

function pgHarness(options: HarnessOptions = {}) {
  const app = createApp({
    repos: { dailyPuzzles: new PgDailyPuzzleRepo(pool), devices: new PgDeviceRepo(pool), snapshots: new PgSnapshotRepo(pool), recovery: new PgRecoveryRepo(pool) },
    recovery: { hmacSecret: TEST_HMAC_SECRET, ...(options.limits ? { limits: options.limits } : {}) },
    dailySource: new FakeSource(),
    generator: new FakeGenerator(),
    logger: options.logger ?? silentLogger,
    webOrigins: [],
    rateLimits: { daily: 1000, devices: 1000 },
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
  return { app };
}

describe.skipIf(unavailable !== null)("recovery integration (Postgres)", () => {
  defineRecoveryScenarios("postgres", pgHarness);

  describe("гонки и SQL-инварианты", () => {
    it("в БД лежит только HMAC (32 байта), а не сам ключ; замена кладёт новый ключ в pending_*, рабочий меняется только при confirm", async () => {
      const { app } = pgHarness();
      const a = await newDevice(app);
      const key = (await createKey(app, a)).body.key as string;
      const row = async () =>
        (
          await pool.query<{ key_hmac: Buffer; pending_key_hmac: Buffer | null; pending_id: string | null; pending_expires_at: Date | null }>(
            `SELECT g.key_hmac, g.pending_key_hmac, g.pending_id, g.pending_expires_at FROM sync_groups g JOIN device_links l ON l.group_id = g.id WHERE l.device_id = $1`,
            [a.id],
          )
        ).rows[0]!;
      const first = await row();
      expect(first.key_hmac).toHaveLength(32);
      expect(first.key_hmac.toString("utf8")).not.toContain(key.replace(/-/g, ""));
      expect([first.pending_key_hmac, first.pending_id, first.pending_expires_at]).toEqual([null, null, null]);

      const rotated = await rotateKey(app, a);
      const started = await row();
      expect(started.key_hmac.equals(first.key_hmac)).toBe(true); // рабочий ключ не тронут
      expect(started.pending_key_hmac).toHaveLength(32);
      expect(started.pending_key_hmac!.equals(first.key_hmac)).toBe(false);
      expect(started.pending_key_hmac!.toString("utf8")).not.toContain(String(rotated.body.key).replace(/-/g, ""));
      expect(started.pending_id).toBe(rotated.body.pendingId);

      expect((await confirmRotation(app, a, rotated.body.pendingId)).status).toBe(200);
      const done = await row();
      expect(done.key_hmac.equals(started.pending_key_hmac!)).toBe(true);
      expect([done.pending_key_hmac, done.pending_id, done.pending_expires_at]).toEqual([null, null, null]);
    });

    it("CHECK-инвариант: pending_* заполняются/сбрасываются только вместе; HMAC ровно 32 байта", async () => {
      const { app } = pgHarness();
      const a = await newDevice(app);
      await createKey(app, a);
      const upd = (sql: string) => pool.query(`UPDATE sync_groups g SET ${sql} FROM device_links l WHERE l.group_id = g.id AND l.device_id = $1`, [a.id]);
      await expect(upd(`pending_id = gen_random_uuid()`)).rejects.toThrow(/sync_groups_pending_all_or_none/);
      await expect(upd(`pending_key_hmac = '\\x00'::bytea, pending_id = gen_random_uuid(), pending_expires_at = now()`)).rejects.toThrow(/pending_key_hmac_check/);
    });

    it("одновременный redeem одного ключа с разных устройств: оба присоединены, в группе ровно N", async () => {
      const { app } = pgHarness();
      const a = await newDevice(app);
      await putSnapshot(app, a, 1, { g: 1 });
      const key = (await createKey(app, a)).body.key as string;
      const others = await Promise.all(Array.from({ length: 6 }, () => newDevice(app)));
      const results = await Promise.all(others.map((d) => redeem(app, d, key)));
      expect(results.map((r) => r.status)).toEqual(Array(6).fill(200));
      expect((await status(app, a)).body.devices).toBe(7);
      for (const d of others) expect((await getSnapshot(app, d)).body.data).toEqual({ g: 1 });
    });

    it("параллельные redeem одного устройства (двойной клик): одна связь, все ответы успешны", async () => {
      const { app } = pgHarness();
      const a = await newDevice(app);
      const key = (await createKey(app, a)).body.key as string;
      const b = await newDevice(app);
      const results = await Promise.all(Array.from({ length: 5 }, () => redeem(app, b, key)));
      expect(results.map((r) => r.status)).toEqual(Array(5).fill(200));
      const { rows } = await pool.query(`SELECT 1 FROM device_links WHERE device_id = $1`, [b.id]);
      expect(rows).toHaveLength(1);
      expect((await status(app, a)).body.devices).toBe(2);
    });

    it("redeem старым ключом против confirm: пока confirm не прошёл — старый ключ работает, после — нет; итог согласован", async () => {
      for (let i = 0; i < 5; i++) {
        const { app } = pgHarness();
        const a = await newDevice(app);
        const key = (await createKey(app, a)).body.key as string;
        const rotated = (await rotateKey(app, a)).body;
        const b = await newDevice(app);
        const [joined, confirmed] = await Promise.all([redeem(app, b, key), confirmRotation(app, a, rotated.pendingId)]);
        expect(confirmed.status).toBe(200);
        expect([200, 400]).toContain(joined.status);
        // Если redeem выиграл — b в группе; проигравший получил 400 и не привязан. Никаких промежуточных состояний.
        expect((await status(app, b)).body.hasKey as boolean).toBe(joined.status === 200);
        // После confirm старый ключ мёртв в любом случае, новый жив.
        const c = await newDevice(app);
        expect((await redeem(app, c, key)).status).toBe(400);
        expect((await redeem(app, c, rotated.key)).status).toBe(200);
      }
    });

    it("redeem НОВЫМ (ожидающим) ключом против confirm: до confirm — 400, после — 200; не бывает «оба ключа мёртвы»", async () => {
      for (let i = 0; i < 5; i++) {
        const { app } = pgHarness();
        const a = await newDevice(app);
        const key = (await createKey(app, a)).body.key as string;
        const rotated = (await rotateKey(app, a)).body;
        const b = await newDevice(app);
        const [joined, confirmed] = await Promise.all([redeem(app, b, rotated.key), confirmRotation(app, a, rotated.pendingId)]);
        expect(confirmed.status).toBe(200);
        expect([200, 400]).toContain(joined.status);
        expect((await redeem(app, await newDevice(app), rotated.key)).status).toBe(200);
        expect((await redeem(app, await newDevice(app), key)).status).toBe(400);
      }
    });

    it("параллельные confirm одной замены (двойной тап, две вкладки): ровно один 200, остальные 409 no_pending; ключ один", async () => {
      for (let i = 0; i < 3; i++) {
        const { app } = pgHarness();
        const a = await newDevice(app);
        await createKey(app, a);
        const rotated = (await rotateKey(app, a)).body;
        const results = await Promise.all(Array.from({ length: 5 }, () => confirmRotation(app, a, rotated.pendingId)));
        expect(results.filter((r) => r.status === 200)).toHaveLength(1);
        for (const r of results.filter((x) => x.status !== 200)) expect([r.status, r.body.error.code]).toEqual([409, "no_pending"]);
        expect((await redeem(app, await newDevice(app), rotated.key)).status).toBe(200);
      }
    });

    it("confirm против новой замены (другое устройство группы): побеждает ровно один исход, подтвердить можно только свежую метку", async () => {
      for (let i = 0; i < 5; i++) {
        const { app } = pgHarness();
        const a = await newDevice(app);
        const key = (await createKey(app, a)).body.key as string;
        const b = await newDevice(app);
        await redeem(app, b, key);
        const first = (await rotateKey(app, a)).body;
        const [confirmed, second] = await Promise.all([confirmRotation(app, a, first.pendingId), rotateKey(app, b)]);
        expect(second.status).toBe(200);
        expect([200, 409]).toContain(confirmed.status);
        if (confirmed.status === 200) {
          // confirm выиграл: first.key рабочий, а вторая замена ждёт подтверждения поверх него.
          expect((await redeem(app, await newDevice(app), first.key)).status).toBe(200);
          expect((await confirmRotation(app, b, second.body.pendingId)).status).toBe(200);
          expect((await redeem(app, await newDevice(app), second.body.key)).status).toBe(200);
          expect((await redeem(app, await newDevice(app), first.key)).status).toBe(400);
        } else {
          // замена перезаписана раньше confirm: first не подтвердить, рабочий — исходный ключ.
          expect(confirmed.body.error.code).toBe("pending_replaced");
          expect((await redeem(app, await newDevice(app), key)).status).toBe(200);
          expect((await confirmRotation(app, b, second.body.pendingId)).status).toBe(200);
        }
      }
    });

    it("confirm против отмены и против удаления ключа: нет 500, состояние согласовано", async () => {
      const { app } = pgHarness();
      for (const op of [cancelRotation, deleteKey]) {
        const a = await newDevice(app);
        const key = (await createKey(app, a)).body.key as string;
        const rotated = (await rotateKey(app, a)).body;
        const [confirmed, done] = await Promise.all([confirmRotation(app, a, rotated.pendingId), op(app, a)]);
        expect(done.status).toBe(200);
        expect([200, 404, 409]).toContain(confirmed.status);
        const c = await newDevice(app);
        if (op === deleteKey) {
          expect((await redeem(app, c, key)).status).toBe(400);
          expect((await redeem(app, c, rotated.key)).status).toBe(400);
        } else {
          // Либо confirm успел (новый ключ рабочий), либо отмена (старый рабочий) — ровно один ключ жив.
          const oldOk = (await redeem(app, c, key)).status === 200;
          const newOk = (await redeem(app, await newDevice(app), rotated.key)).status === 200;
          expect(oldOk).toBe(confirmed.status !== 200);
          expect(newOk).toBe(confirmed.status === 200);
        }
      }
    });

    it("redeem против удаления ключа и против отвязки: нет 500, состояние согласовано", async () => {
      const { app } = pgHarness();
      for (const op of [deleteKey, unlink]) {
        const a = await newDevice(app);
        await putSnapshot(app, a, 1, { a: 1 });
        const key = (await createKey(app, a)).body.key as string;
        const b = await newDevice(app);
        const [joined, done] = await Promise.all([redeem(app, b, key), op(app, a)]);
        expect(done.status).toBe(200);
        expect([200, 400]).toContain(joined.status);
        const st = (await status(app, b)).body;
        expect(st.hasKey).toBe(joined.status === 200 && op === unlink);
        // Ни у кого не осталось «зависших» связей на несуществующую группу (FK и так не даст) и снапшот читается.
        expect([200, 404]).toContain((await getSnapshot(app, b)).status);
      }
    });

    it("одновременная отвязка всех устройств: группа исчезает целиком, ни у кого не потерян снапшот", async () => {
      const { app } = pgHarness();
      const a = await newDevice(app);
      await putSnapshot(app, a, 1, { keep: "me" });
      const key = (await createKey(app, a)).body.key as string;
      const rest = await Promise.all(Array.from({ length: 3 }, () => newDevice(app)));
      for (const d of rest) await redeem(app, d, key);
      const all = [a, ...rest];
      const results = await Promise.all(all.map((d) => unlink(app, d)));
      expect(results.map((r) => r.status)).toEqual(Array(4).fill(200));
      const { rows } = await pool.query(`SELECT 1 FROM device_links WHERE device_id = ANY($1::uuid[])`, [all.map((d) => d.id)]);
      expect(rows).toHaveLength(0);
      expect((await redeem(app, await newDevice(app), key)).status).toBe(400);
      for (const d of all) expect((await getSnapshot(app, d)).body.data).toEqual({ keep: "me" });
    });

    it("удаление устройства каскадно убирает его связь; PUT в группе очищает orphaned_at", async () => {
      const { app } = pgHarness();
      const a = await newDevice(app);
      const key = (await createKey(app, a)).body.key as string;
      const b = await newDevice(app);
      await putSnapshot(app, b, 5, { own: true });
      await redeem(app, b, key);
      const orphan = await pool.query<{ orphaned_at: Date | null }>(`SELECT orphaned_at FROM snapshots WHERE device_id = $1`, [b.id]);
      expect(orphan.rows[0]!.orphaned_at).not.toBeNull(); // собственный снапшот b помечен сиротой, не удалён
      await pool.query(`DELETE FROM devices WHERE id = $1`, [b.id]);
      expect((await status(app, a)).body.devices).toBe(1);
      await putSnapshot(app, a, 1, { x: 1 });
      const live = await pool.query<{ orphaned_at: Date | null }>(`SELECT orphaned_at FROM snapshots WHERE device_id = $1`, [a.id]);
      expect(live.rows[0]!.orphaned_at).toBeNull();
    });

    describe("удаление ключа (deleteGroup) снимает orphaned_at", () => {
      const orphanedAt = async (id: string) => (await pool.query<{ orphaned_at: Date | null }>(`SELECT orphaned_at FROM snapshots WHERE device_id = $1`, [id])).rows[0]?.orphaned_at;

      it("инициатор — владелец снапшота группы: собственные снапшоты остальных устройств снова «живые», данные целы", async () => {
        const { app } = pgHarness();
        const a = await newDevice(app);
        await putSnapshot(app, a, 1, { owner: "a" });
        const key = (await createKey(app, a)).body.key as string;
        const others = await Promise.all([newDevice(app), newDevice(app)]);
        for (const [i, d] of others.entries()) {
          await putSnapshot(app, d, 3, { own: i });
          expect((await redeem(app, d, key)).status).toBe(200);
          expect(await orphanedAt(d.id)).toBeTruthy(); // при вступлении собственный снапшот стал сиротой
        }

        expect((await deleteKey(app, a)).status).toBe(200);

        for (const d of others) expect(await orphanedAt(d.id)).toBeNull();
        for (const [i, d] of others.entries()) expect((await getSnapshot(app, d)).body.data).toEqual({ own: i });
      });

      it("инициатор — не владелец: снапшот группы переезжает к нему живым, у остальных сирота снят", async () => {
        const { app } = pgHarness();
        const a = await newDevice(app);
        await putSnapshot(app, a, 1, { owner: "a" });
        const key = (await createKey(app, a)).body.key as string;
        const b = await newDevice(app);
        const c = await newDevice(app);
        await putSnapshot(app, b, 3, { own: "b" });
        await putSnapshot(app, c, 3, { own: "c" });
        await redeem(app, b, key);
        await redeem(app, c, key);
        expect(await orphanedAt(c.id)).toBeTruthy();

        expect((await deleteKey(app, b)).status).toBe(200);

        expect(await orphanedAt(c.id)).toBeNull();
        expect(await orphanedAt(b.id)).toBeNull();
        expect((await getSnapshot(app, b)).body.data).toEqual({ owner: "a" });
        expect((await getSnapshot(app, c)).body.data).toEqual({ own: "c" });
      });
    });
  });
});
