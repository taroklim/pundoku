import { Router } from "express";
import type { RecoveryRepo } from "./types.js";
import { generateRecoveryKey, hmacRecoveryKey, keyHmacPrefix, normalizeRecoveryKey } from "./key.js";
import type { DeviceRepo } from "../devices/types.js";
import { deviceIdOf, requireDevice } from "../devices/auth.js";
import { HttpError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { FailureCounter, failureGuard, rateLimit } from "../middleware/rate-limit.js";

const HOUR_MS = 60 * 60_000;

export interface RecoveryLimits {
  /** Неудачных redeem с одного IP в час. */
  redeemFailuresPerIp?: number;
  /** Неудачных redeem с одного устройства в час. */
  redeemFailuresPerDevice?: number;
  /** Создание + перевыпуск ключа на устройство в час (общий счётчик). */
  issuePerDevice?: number;
}

export interface RecoveryRouterDeps {
  devices: DeviceRepo;
  recovery: RecoveryRepo;
  logger: Logger;
  /** Серверный секрет HMAC (≥32 байт). Не логируется. */
  hmacSecret: Buffer;
  now: () => Date;
  limits?: RecoveryLimits;
  /** Часы для окон лимитов (мс); в тестах — управляемые. */
  clock?: () => number;
}

/** Единый ответ на любую неудачу redeem: неверный формат, неверный, перевыпущенный или удалённый ключ. */
const invalidKey = (): HttpError => new HttpError(400, "invalid_key", "Ключ неверный или больше не действует");

/**
 * /api/recovery — ключ восстановления и группа синхронизации устройств (PD-27). Все маршруты под `requireDevice`.
 * Ключ показывается один раз (ответ create/rotate) и в логи не попадает: только `groupId` и `keyHmacPrefix`.
 */
export function recoveryRouter(deps: RecoveryRouterDeps): Router {
  const { recovery, logger, hmacSecret, now } = deps;
  const clock = deps.clock ?? Date.now;
  const router = Router();
  const auth = requireDevice(deps.devices, recovery);
  const byDevice = (_req: unknown, res: { locals: Record<string, unknown> }): string => String(res.locals.deviceId);

  const ipFailures = new FailureCounter(HOUR_MS, deps.limits?.redeemFailuresPerIp ?? 20, clock);
  const deviceFailures = new FailureCounter(HOUR_MS, deps.limits?.redeemFailuresPerDevice ?? 10, clock);
  // Один счётчик на create и rotate: «создание/перевыпуск — 5/час на устройство».
  const issueLimit = rateLimit({ windowMs: HOUR_MS, max: deps.limits?.issuePerDevice ?? 5, now: clock, key: byDevice });

  router.post("/key", auth, issueLimit, async (_req, res) => {
    const key = generateRecoveryKey();
    const hmac = hmacRecoveryKey(hmacSecret, normalizeRecoveryKey(key)!);
    const created = await recovery.createGroup(deviceIdOf(res), hmac, now());
    res.setHeader("Cache-Control", "no-store");
    if (!created) throw new HttpError(409, "key_exists", "У этого устройства уже есть ключ восстановления; перевыпусти его (rotate) или удали");
    logger.info({ groupId: created.groupId, keyHmacPrefix: keyHmacPrefix(hmac) }, "recovery: key created");
    res.status(201).json({ key, devices: 1 });
  });

  router.post("/key/rotate", auth, issueLimit, async (_req, res) => {
    const key = generateRecoveryKey();
    const hmac = hmacRecoveryKey(hmacSecret, normalizeRecoveryKey(key)!);
    const rotated = await recovery.rotateKey(deviceIdOf(res), hmac, now());
    res.setHeader("Cache-Control", "no-store");
    if (!rotated) throw new HttpError(404, "no_key", "У этого устройства нет ключа восстановления");
    logger.info({ groupId: rotated.groupId, keyHmacPrefix: keyHmacPrefix(hmac) }, "recovery: key rotated");
    res.json({ key });
  });

  // Порядок: IP-guard до auth (дёшево режет перебор), device-guard после auth (нужен deviceId).
  router.post("/redeem", failureGuard(ipFailures, (req) => req.ip ?? "unknown"), auth, failureGuard(deviceFailures, byDevice), async (req, res) => {
    const deviceId = deviceIdOf(res);
    const normalized = normalizeRecoveryKey((req.body as { key?: unknown } | undefined)?.key);
    // Не строка / гигантская — тот же ответ. Иное (в т.ч. неверный формат) идёт в HMAC и поиск без раннего выхода.
    const hmac = hmacRecoveryKey(hmacSecret, normalized ?? "");
    const result = normalized === null ? ({ ok: false } as const) : await recovery.redeem(deviceId, hmac, now());
    res.setHeader("Cache-Control", "no-store");
    if (!result.ok) {
      ipFailures.fail(req.ip ?? "unknown");
      deviceFailures.fail(deviceId);
      logger.warn({ keyHmacPrefix: keyHmacPrefix(hmac) }, "recovery: redeem failed");
      throw invalidKey();
    }
    logger.info({ groupId: result.groupId, alreadyLinked: result.alreadyLinked }, "recovery: device joined");
    res.json({ linked: true, devices: result.devices });
  });

  router.get("/", auth, async (_req, res) => {
    const group = await recovery.find(deviceIdOf(res));
    res.setHeader("Cache-Control", "no-store");
    res.json(group ? { hasKey: true, devices: group.devices, keyCreatedAt: group.keyCreatedAt.toISOString() } : { hasKey: false });
  });

  router.delete("/link", auth, async (_req, res) => {
    await recovery.unlink(deviceIdOf(res));
    res.setHeader("Cache-Control", "no-store");
    res.json({ linked: false });
  });

  router.delete("/", auth, async (_req, res) => {
    await recovery.deleteGroup(deviceIdOf(res));
    res.setHeader("Cache-Control", "no-store");
    res.json({ hasKey: false });
  });

  return router;
}
