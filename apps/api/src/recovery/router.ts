import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { RecoveryRepo } from "./types.js";
import { generateRecoveryKey, hmacRecoveryKey, keyHmacPrefix, normalizeRecoveryKey } from "./key.js";
import type { DeviceRepo } from "../devices/types.js";
import { deviceIdOf, requireDevice } from "../devices/auth.js";
import { HttpError } from "../lib/errors.js";
import type { Logger } from "../lib/logger.js";
import { FailureCounter, failureGuard, rateLimit } from "../middleware/rate-limit.js";

const HOUR_MS = 60 * 60_000;
/** Срок жизни ожидающей (неподтверждённой) замены ключа (PD-126). */
export const PENDING_ROTATION_TTL_MS = 24 * HOUR_MS;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecoveryLimits {
  /** Неудачных redeem с одного IP в час. */
  redeemFailuresPerIp?: number;
  /** Неудачных redeem с одного устройства в час. */
  redeemFailuresPerDevice?: number;
  /** Создание + перевыпуск ключа на устройство в час (общий счётчик). */
  issuePerDevice?: number;
  /** Подтверждений и отмен замены ключа на устройство в час (общий счётчик). */
  confirmPerDevice?: number;
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
 * Замена ключа отложенная (PD-126): rotate выдаёт новый ключ как ожидающий, старый работает до `rotate/confirm`.
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

  const confirmLimit = rateLimit({ windowMs: HOUR_MS, max: deps.limits?.confirmPerDevice ?? 30, now: clock, key: byDevice });

  router.post("/key", auth, issueLimit, async (_req, res) => {
    const key = generateRecoveryKey();
    const hmac = hmacRecoveryKey(hmacSecret, normalizeRecoveryKey(key)!);
    const created = await recovery.createGroup(deviceIdOf(res), hmac, now());
    res.setHeader("Cache-Control", "no-store");
    if (!created) throw new HttpError(409, "key_exists", "У этого устройства уже есть ключ восстановления; перевыпусти его (rotate) или удали");
    logger.info({ groupId: created.groupId, keyHmacPrefix: keyHmacPrefix(hmac) }, "recovery: key created");
    res.status(201).json({ key, devices: 1 });
  });

  // Начать замену: новый ключ — ОЖИДАЮЩИЙ, рабочий ключ группы не меняется (старый принимается в redeem, пока не придёт
  // confirm). Ключ — один раз, как и при создании; повторный вызов затирает прежнюю ожидающую замену.
  router.post("/key/rotate", auth, issueLimit, async (_req, res) => {
    const key = generateRecoveryKey();
    const hmac = hmacRecoveryKey(hmacSecret, normalizeRecoveryKey(key)!);
    const pendingId = randomUUID();
    const expiresAt = new Date(now().getTime() + PENDING_ROTATION_TTL_MS);
    const started = await recovery.startRotation(deviceIdOf(res), { id: pendingId, keyHmac: hmac, expiresAt });
    res.setHeader("Cache-Control", "no-store");
    if (!started) throw new HttpError(404, "no_key", "У этого устройства нет ключа восстановления");
    logger.info({ groupId: started.groupId, keyHmacPrefix: keyHmacPrefix(hmac), expiresAt: expiresAt.toISOString() }, "recovery: key rotation started (pending)");
    res.json({ key, pendingId, expiresAt: expiresAt.toISOString() });
  });

  // «Ключ сохранён»: атомарно делает ожидающий ключ рабочим. Метка `pendingId` из ответа rotate обязательна — без неё
  // устройство подтвердило бы замену, начатую на другом устройстве группы (ключ которой ему не показывали).
  router.post("/key/rotate/confirm", auth, confirmLimit, async (req, res) => {
    const pendingId = (req.body as { pendingId?: unknown } | undefined)?.pendingId;
    res.setHeader("Cache-Control", "no-store");
    if (typeof pendingId !== "string" || !UUID_RE.test(pendingId)) throw new HttpError(400, "invalid_pending", "Нужен pendingId из ответа rotate");
    const done = await recovery.confirmRotation(deviceIdOf(res), pendingId.toLowerCase(), now());
    if (!done.ok) {
      switch (done.reason) {
        case "no_key":
          throw new HttpError(404, "no_key", "У этого устройства нет ключа восстановления");
        case "no_pending":
          throw new HttpError(409, "no_pending", "Нет ожидающей замены ключа");
        case "replaced":
          throw new HttpError(409, "pending_replaced", "Замена ключа была начата заново; этот ключ больше не подтвердить");
        case "expired":
          throw new HttpError(409, "pending_expired", "Срок ожидающего ключа вышел; начни замену заново");
      }
    }
    logger.info({ groupId: done.groupId, keyHmacPrefix: keyHmacPrefix(done.keyHmac) }, "recovery: key rotation confirmed");
    res.json({ confirmed: true });
  });

  // «Отменить замену»: ожидающий ключ отброшен, рабочий не тронут (идемпотентно).
  router.delete("/key/rotate", auth, confirmLimit, async (_req, res) => {
    await recovery.cancelRotation(deviceIdOf(res));
    res.setHeader("Cache-Control", "no-store");
    res.json({ pending: false });
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
    if (!group) {
      res.json({ hasKey: false });
      return;
    }
    // Протухшая ожидающая замена — это «замены нет» (строка остаётся до следующей замены/отмены и не принимается нигде).
    const live = group.pendingExpiresAt && group.pendingExpiresAt.getTime() > now().getTime() ? group.pendingExpiresAt : null;
    res.json({
      hasKey: true,
      devices: group.devices,
      keyCreatedAt: group.keyCreatedAt.toISOString(),
      pendingRotation: live ? { expiresAt: live.toISOString() } : null,
    });
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
