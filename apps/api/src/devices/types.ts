export interface DeviceRepo {
  create(tokenHash: string): Promise<{ id: string; createdAt: Date }>;
  /** Находит устройство по хешу токена и обновляет last_seen_at. */
  touchByTokenHash(tokenHash: string): Promise<{ id: string } | null>;
}
