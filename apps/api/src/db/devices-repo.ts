import type { Queryable } from "./pool.js";
import type { DeviceRepo } from "../devices/types.js";

export class PgDeviceRepo implements DeviceRepo {
  constructor(private readonly db: Queryable) {}

  async create(tokenHash: string): Promise<{ id: string; createdAt: Date }> {
    const { rows } = await this.db.query<{ id: string; created_at: Date }>(
      `INSERT INTO devices (token_hash) VALUES ($1) RETURNING id, created_at`,
      [tokenHash],
    );
    const row = rows[0];
    if (!row) throw new Error("devices: INSERT не вернул строку");
    return { id: row.id, createdAt: row.created_at };
  }

  async touchByTokenHash(tokenHash: string): Promise<{ id: string } | null> {
    const { rows } = await this.db.query<{ id: string }>(
      `UPDATE devices SET last_seen_at = now() WHERE token_hash = $1 RETURNING id`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }
}
