import { Router } from "express";
import type { Snapshot, SnapshotRepo } from "./types.js";
import { SNAPSHOT_MAX_BYTES } from "./types.js";
import type { DeviceRepo } from "../devices/types.js";
import { deviceIdOf, requireDevice } from "../devices/auth.js";
import { HttpError, badRequest, notFound } from "../lib/errors.js";

interface SnapshotBody {
  version?: unknown;
  updatedAt?: unknown;
  data?: unknown;
}

export function toResponse(s: Snapshot): { version: number; updatedAt: string; data: Record<string, unknown> } {
  return { version: s.version, updatedAt: s.updatedAt.toISOString(), data: s.data };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseBody(body: unknown): { version: number; updatedAt: Date; data: Record<string, unknown> } {
  if (!isPlainObject(body)) throw badRequest("invalid_body", "Тело должно быть JSON-объектом {version, updatedAt, data}");
  const { version, updatedAt, data } = body as SnapshotBody;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0 || version > 2_147_483_647) {
    throw badRequest("invalid_version", "version должен быть целым числом >= 0");
  }
  const parsedUpdatedAt = typeof updatedAt === "string" ? new Date(updatedAt) : new Date(NaN);
  if (Number.isNaN(parsedUpdatedAt.getTime())) throw badRequest("invalid_updated_at", "updatedAt должен быть датой в ISO 8601");
  if (!isPlainObject(data)) throw badRequest("invalid_data", "data должен быть JSON-объектом");
  return { version, updatedAt: parsedUpdatedAt, data };
}

/** GET/PUT /api/snapshot — снапшот прогресса устройства (сервер — источник правды между устройствами). */
export function snapshotRouter(devices: DeviceRepo, snapshots: SnapshotRepo): Router {
  const router = Router();
  router.use(requireDevice(devices));

  router.get("/", async (_req, res) => {
    const snapshot = await snapshots.get(deviceIdOf(res));
    if (!snapshot) throw notFound("snapshot_not_found", "У устройства ещё нет снапшота");
    res.setHeader("Cache-Control", "no-store");
    res.json(toResponse(snapshot));
  });

  router.put("/", async (req, res) => {
    const { version, updatedAt, data } = parseBody(req.body);
    const sizeBytes = Buffer.byteLength(JSON.stringify(data), "utf8");
    if (sizeBytes > SNAPSHOT_MAX_BYTES) {
      throw new HttpError(413, "snapshot_too_large", `data больше лимита ${SNAPSHOT_MAX_BYTES} байт (${sizeBytes})`);
    }
    const result = await snapshots.upsertIfNewer({ deviceId: deviceIdOf(res), version, updatedAt, data, sizeBytes });
    res.setHeader("Cache-Control", "no-store");
    if (!result.stored) {
      throw new HttpError(
        409,
        "snapshot_conflict",
        `На сервере версия ${result.current.version} >= присланной ${version}; слей снапшоты на клиенте и пришли новую версию`,
        { snapshot: toResponse(result.current) },
      );
    }
    res.json({ version: result.snapshot.version, updatedAt: result.snapshot.updatedAt.toISOString(), sizeBytes });
  });

  return router;
}
