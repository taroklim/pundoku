export interface Snapshot {
  deviceId: string;
  version: number;
  updatedAt: Date;
  data: Record<string, unknown>;
  sizeBytes: number;
}

export type SnapshotWrite = Omit<Snapshot, "updatedAt"> & { updatedAt: Date };

export type UpsertResult = { stored: true; snapshot: Snapshot } | { stored: false; current: Snapshot };

export interface SnapshotRepo {
  get(deviceId: string): Promise<Snapshot | null>;
  /** Сохраняет, только если version строго больше сохранённой; иначе возвращает текущий снапшот. */
  upsertIfNewer(write: SnapshotWrite): Promise<UpsertResult>;
}

/** Лимит на сериализованный `data` (1 МиБ). Сверх — 413. */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024;
