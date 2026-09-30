import { describe, expect, it } from "vitest";
import request from "supertest";
import { Writable } from "node:stream";
import { buildTestApp } from "../test/fakes.js";
import { createLogger } from "../lib/logger.js";
import { createKey, defineRecoveryScenarios, newDevice, redeem, rotateKey, type HarnessOptions } from "../test/recovery-scenarios.js";

function memoryHarness(options: HarnessOptions = {}) {
  const { app } = buildTestApp({
    rateLimits: { daily: 1000, devices: 1000 },
    recovery: { hmacSecret: Buffer.from("test-only-hmac-secret-0123456789abcdef-0123456789", "utf8"), ...(options.limits ? { limits: options.limits } : {}) },
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.logger ? { logger: options.logger } : {}),
  });
  return { app };
}

defineRecoveryScenarios("memory repo", memoryHarness);

describe("recovery: логи не содержат ключей и токенов", () => {
  it("ни ключ (create/rotate/redeem, в т.ч. неверный), ни токен устройства не попадают в лог", async () => {
    const lines: string[] = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        lines.push(String(chunk));
        cb();
      },
    });
    const logger = createLogger("trace", sink);
    const { app } = memoryHarness({ logger });
    const a = await newDevice(app);
    const created = await createKey(app, a);
    const rotated = await rotateKey(app, a);
    const b = await newDevice(app);
    const wrong = "WRNG-KEY0-0000-1111-2222-3333-4444-5555";
    await redeem(app, b, wrong);
    const ok = await redeem(app, b, rotated.body.key);
    expect(ok.status).toBe(200);
    // Ключ и в теле запроса (req.body), и в ответах: пробуем дополнительно через прямой запрос с заголовком.
    await request(app).post("/api/recovery/redeem").set("Authorization", b.auth).send({ key: created.body.key });

    const log = lines.join("");
    expect(log.length).toBeGreaterThan(0);
    const raw = (k: string) => k.replace(/-/g, "");
    for (const secret of [created.body.key, rotated.body.key, wrong, a.token, b.token]) {
      expect(log).not.toContain(secret);
      expect(log).not.toContain(raw(secret));
    }
    expect(log).toContain("keyHmacPrefix");
  });
});
