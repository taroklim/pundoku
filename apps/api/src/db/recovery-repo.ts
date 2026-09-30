import type pg from "pg";
import type { GroupInfo, RecoveryRepo, RedeemResult } from "../recovery/types.js";
import { hmacEqual } from "../recovery/key.js";

type Tx = pg.PoolClient;

/** Postgres: deadlock_detected / serialization_failure — транзакцию безопасно повторить. */
const RETRYABLE = new Set(["40P01", "40001"]);
const MAX_ATTEMPTS = 3;

/**
 * Все изменяющие операции идут в транзакции и первым делом берут блокировку строки устройства
 * (`devices ... FOR UPDATE`): операции одного устройства (двойной клик, две вкладки) сериализуются, а на
 * гонки разных устройств за одну группу действует `FOR UPDATE` по строке группы.
 */
export class PgRecoveryRepo implements RecoveryRepo {
  constructor(private readonly pool: pg.Pool) {}

  async snapshotOwnerOf(deviceId: string): Promise<string> {
    const { rows } = await this.pool.query<{ snapshot_device_id: string }>(
      `SELECT g.snapshot_device_id
         FROM device_links l JOIN sync_groups g ON g.id = l.group_id
        WHERE l.device_id = $1`,
      [deviceId],
    );
    return rows[0]?.snapshot_device_id ?? deviceId;
  }

  async find(deviceId: string): Promise<GroupInfo | null> {
    const { rows } = await this.pool.query<{ key_created_at: Date; devices: string }>(
      `SELECT g.key_created_at,
              (SELECT count(*) FROM device_links x WHERE x.group_id = g.id) AS devices
         FROM device_links l JOIN sync_groups g ON g.id = l.group_id
        WHERE l.device_id = $1`,
      [deviceId],
    );
    const row = rows[0];
    return row ? { devices: Number(row.devices), keyCreatedAt: row.key_created_at } : null;
  }

  async createGroup(deviceId: string, keyHmac: Buffer, now: Date): Promise<{ groupId: string } | null> {
    return this.tx(deviceId, async (db) => {
      const linked = await db.query(`SELECT 1 FROM device_links WHERE device_id = $1`, [deviceId]);
      if (linked.rowCount) return null;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO sync_groups (key_hmac, snapshot_device_id, key_created_at, created_at) VALUES ($1, $2, $3, $3) RETURNING id`,
        [keyHmac, deviceId, now],
      );
      const groupId = rows[0]?.id;
      if (!groupId) throw new Error("sync_groups: INSERT не вернул строку");
      await db.query(`INSERT INTO device_links (device_id, group_id, linked_at) VALUES ($1, $2, $3)`, [deviceId, groupId, now]);
      // Собственный снапшот устройства становится снапшотом группы — снова «живой».
      await db.query(`UPDATE snapshots SET orphaned_at = NULL WHERE device_id = $1`, [deviceId]);
      return { groupId };
    });
  }

  async rotateKey(deviceId: string, keyHmac: Buffer, now: Date): Promise<{ groupId: string } | null> {
    return this.tx(deviceId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `UPDATE sync_groups g SET key_hmac = $2, key_created_at = $3
           FROM device_links l
          WHERE l.group_id = g.id AND l.device_id = $1
          RETURNING g.id`,
        [deviceId, keyHmac, now],
      );
      return rows[0] ? { groupId: rows[0].id } : null;
    });
  }

  async redeem(deviceId: string, keyHmac: Buffer, now: Date): Promise<RedeemResult> {
    return this.tx(deviceId, async (db): Promise<RedeemResult> => {
      // FOR UPDATE: параллельный rotate/delete группы дождётся нас (или мы его) — и в READ COMMITTED условие
      // key_hmac перепроверится по новой версии строки, так что перевыпущенный ключ уже не подойдёт.
      const found = await db.query<{ id: string; key_hmac: Buffer }>(`SELECT id, key_hmac FROM sync_groups WHERE key_hmac = $1 FOR UPDATE`, [keyHmac]);
      const group = found.rows[0];
      // Индексный поиск по HMAC не даёт утечки по времени (для подбора префикса нужен прообраз HMAC); поверх —
      // сравнение с постоянным временем.
      if (!group || !hmacEqual(group.key_hmac, keyHmac)) return { ok: false };

      const current = await db.query<{ group_id: string }>(`SELECT group_id FROM device_links WHERE device_id = $1`, [deviceId]);
      const currentId = current.rows[0]?.group_id;
      if (currentId === group.id) return { ok: true, groupId: group.id, devices: await this.countDevices(db, group.id), alreadyLinked: true };
      if (currentId) await this.leave(db, deviceId); // из другой группы — по правилам unlink

      await db.query(`INSERT INTO device_links (device_id, group_id, linked_at) VALUES ($1, $2, $3)`, [deviceId, group.id, now]);
      // Собственный прежний снапшот устройства — сирота: помечаем, не удаляем.
      await db.query(`UPDATE snapshots SET orphaned_at = $2 WHERE device_id = $1`, [deviceId, now]);
      return { ok: true, groupId: group.id, devices: await this.countDevices(db, group.id), alreadyLinked: false };
    });
  }

  async unlink(deviceId: string): Promise<void> {
    await this.tx(deviceId, (db) => this.leave(db, deviceId));
  }

  async deleteGroup(deviceId: string): Promise<void> {
    await this.tx(deviceId, async (db) => {
      const { rows } = await db.query<{ group_id: string; snapshot_device_id: string }>(
        `SELECT l.group_id, g.snapshot_device_id
           FROM device_links l JOIN sync_groups g ON g.id = l.group_id
          WHERE l.device_id = $1
          FOR UPDATE OF g`,
        [deviceId],
      );
      const group = rows[0];
      if (!group) return;
      const members = (await db.query<{ device_id: string }>(`SELECT device_id FROM device_links WHERE group_id = $1`, [group.group_id])).rows.map((r) => r.device_id);
      // Снапшот группы достаётся инициатору: его прежний (сиротский) снапшот заменяется, строка переезжает.
      const owner = group.snapshot_device_id;
      if (owner !== deviceId && (await db.query(`SELECT 1 FROM snapshots WHERE device_id = $1`, [owner])).rowCount) {
        await db.query(`DELETE FROM snapshots WHERE device_id = $1`, [deviceId]);
        await db.query(`UPDATE snapshots SET device_id = $2, orphaned_at = NULL WHERE device_id = $1`, [owner, deviceId]);
      }
      await db.query(`DELETE FROM sync_groups WHERE id = $1`, [group.group_id]); // device_links — каскадом
      // Остальные устройства возвращаются к своим снапшотам — они снова «живые».
      await db.query(`UPDATE snapshots SET orphaned_at = NULL WHERE device_id = ANY($1::uuid[])`, [members]);
    });
  }

  /**
   * Выход устройства из группы внутри транзакции:
   * - не владелец → получает КОПИЮ снапшота группы как собственный (собственный сирота заменяется);
   * - владелец, в группе есть другие → снапшот «переезжает» на самое раннее из оставшихся (там остаётся копия,
   *   а строка ушедшего устройства — его собственная копия, так что данные не теряет никто);
   * - последний → группа удаляется (ключ погашен), снапшот остаётся у устройства.
   */
  private async leave(db: Tx, deviceId: string): Promise<void> {
    const { rows } = await db.query<{ group_id: string; snapshot_device_id: string }>(
      `SELECT l.group_id, g.snapshot_device_id
         FROM device_links l JOIN sync_groups g ON g.id = l.group_id
        WHERE l.device_id = $1
        FOR UPDATE OF g`,
      [deviceId],
    );
    const group = rows[0];
    if (!group) return;
    await db.query(`DELETE FROM device_links WHERE device_id = $1`, [deviceId]);
    const others = await db.query<{ device_id: string }>(`SELECT device_id FROM device_links WHERE group_id = $1 ORDER BY linked_at, device_id`, [group.group_id]);
    const next = others.rows[0]?.device_id;
    if (!next) {
      await db.query(`DELETE FROM sync_groups WHERE id = $1`, [group.group_id]);
      await db.query(`UPDATE snapshots SET orphaned_at = NULL WHERE device_id = $1`, [deviceId]);
      return;
    }
    if (group.snapshot_device_id === deviceId) {
      await this.copySnapshot(db, deviceId, next);
      await db.query(`UPDATE sync_groups SET snapshot_device_id = $2 WHERE id = $1`, [group.group_id, next]);
    } else {
      await this.copySnapshot(db, group.snapshot_device_id, deviceId);
    }
  }

  /** Копия снапшота `from` под ключом `to` (заменяет прежнюю строку `to`). Нет исходной строки — ничего не делаем. */
  private async copySnapshot(db: Tx, from: string, to: string): Promise<void> {
    await db.query(
      `INSERT INTO snapshots (device_id, version, updated_at, data, size_bytes, orphaned_at)
       SELECT $2, version, updated_at, data, size_bytes, NULL FROM snapshots WHERE device_id = $1
       ON CONFLICT (device_id) DO UPDATE
         SET version = EXCLUDED.version, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data,
             size_bytes = EXCLUDED.size_bytes, saved_at = now(), orphaned_at = NULL`,
      [from, to],
    );
  }

  private async countDevices(db: Tx, groupId: string): Promise<number> {
    const { rows } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM device_links WHERE group_id = $1`, [groupId]);
    return Number(rows[0]?.n ?? 0);
  }

  private async tx<T>(deviceId: string, fn: (db: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const db = await this.pool.connect();
      try {
        await db.query("BEGIN");
        await db.query(`SELECT 1 FROM devices WHERE id = $1 FOR UPDATE`, [deviceId]);
        const result = await fn(db);
        await db.query("COMMIT");
        return result;
      } catch (error) {
        await db.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if (attempt < MAX_ATTEMPTS && code !== undefined && RETRYABLE.has(code)) continue;
        throw error;
      } finally {
        db.release();
      }
    }
  }
}
