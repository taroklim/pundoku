import { Router } from "express";
import type { DeviceRepo } from "./types.js";
import { generateDeviceToken, hashDeviceToken } from "./tokens.js";

/** POST /api/devices — анонимный аккаунт устройства. Токен возвращается один раз, в БД только хеш. */
export function devicesRouter(devices: DeviceRepo): Router {
  const router = Router();

  router.post("/", async (_req, res) => {
    const deviceToken = generateDeviceToken();
    const device = await devices.create(hashDeviceToken(deviceToken));
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ deviceId: device.id, deviceToken });
  });

  return router;
}
