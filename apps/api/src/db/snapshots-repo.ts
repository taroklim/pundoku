import type { Queryable } from "./pool.js";
import type { Snapshot, SnapshotRepo, SnapshotWrite, UpsertResult } from "../snapshot/types.js";

interface Row {
  device_id: string;
  version: number;
  updated_at: Date;
  data: Record<string, unknown>;
  size_bytes: number;
}

const COLUMNS = `device_id, version, updated_at, data, size_bytes`;

const toSnapshot = (row: Row): Snapshot => ({
  deviceId: row.device_id,
  version: row.version,
  updatedAt: row.updated_at,
  data: row.data,
  sizeBytes: row.size_bytes,
});

export class PgSnapshotRepo implements SnapshotRepo {
  constructor(private readonly db: Queryable) {}

  async get(deviceId: string): Promise<Snapshot | null> {
    const { rows } = await this.db.query<Row>(`SELECT ${COLUMNS} FROM snapshots WHERE device_id = $1`, [deviceId]);
    return rows[0] ? toSnapshot(rows[0]) : null;
  }

  /** Атомарный upsert: обновляет только если присланная версия строго больше сохранённой. */
  async upsertIfNewer(w: SnapshotWrite): Promise<UpsertResult> {
    const { rows } = await this.db.query<Row>(
      `INSERT INTO snapshots (device_id, version, updated_at, data, size_bytes)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (device_id) DO UPDATE
         SET version = EXCLUDED.version, updated_at = EXCLUDED.updated_at,
             data = EXCLUDED.data, size_bytes = EXCLUDED.size_bytes, saved_at = now(), orphaned_at = NULL
         WHERE snapshots.version < EXCLUDED.version
       RETURNING ${COLUMNS}`,
      [w.deviceId, w.version, w.updatedAt, JSON.stringify(w.data), w.sizeBytes],
    );
    if (rows[0]) return { stored: true, snapshot: toSnapshot(rows[0]) };
    const current = await this.get(w.deviceId);
    if (!current) throw new Error(`snapshots: конфликт без текущей строки для ${w.deviceId}`);
    return { stored: false, current };
  }
}
