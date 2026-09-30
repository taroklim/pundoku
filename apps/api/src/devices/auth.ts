import type { RequestHandler, Response } from "express";
import type { DeviceRepo } from "./types.js";
import type { RecoveryRepo } from "../recovery/types.js";
import { hashDeviceToken, looksLikeDeviceToken } from "./tokens.js";
import { unauthorized } from "../lib/errors.js";

/**
 * `Authorization: Bearer <deviceToken>` → ищем устройство по sha256-хешу, обновляем last_seen_at,
 * кладём id в res.locals.deviceId. Любая проблема с токеном — 401 без деталей.
 * Заодно резолвим `snapshotOwnerId` (PD-27): чей снапшот читает/пишет устройство — владельца группы синхронизации,
 * если устройство присоединено по ключу восстановления, иначе само устройство. Токен устройства не подменяется.
 */
export function requireDevice(devices: DeviceRepo, recovery: RecoveryRepo): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!token || !looksLikeDeviceToken(token)) throw unauthorized();
    const device = await devices.touchByTokenHash(hashDeviceToken(token));
    if (!device) throw unauthorized("Неизвестный токен устройства");
    res.locals.deviceId = device.id;
    res.locals.snapshotOwnerId = await recovery.snapshotOwnerOf(device.id);
    next();
  };
}

export function deviceIdOf(res: Response): string {
  const id = res.locals.deviceId as unknown;
  if (typeof id !== "string") throw new Error("deviceIdOf: маршрут не обёрнут в requireDevice");
  return id;
}

export function snapshotOwnerIdOf(res: Response): string {
  const id = res.locals.snapshotOwnerId as unknown;
  if (typeof id !== "string") throw new Error("snapshotOwnerIdOf: маршрут не обёрнут в requireDevice");
  return id;
}
