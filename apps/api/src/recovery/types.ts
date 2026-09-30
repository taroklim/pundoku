export interface GroupInfo {
  /** Сколько устройств в группе (включая это). */
  devices: number;
  keyCreatedAt: Date;
}

export type RedeemResult = { ok: false } | { ok: true; groupId: string; devices: number; alreadyLinked: boolean };

/**
 * Хранилище групп синхронизации и ключей восстановления. Составные операции атомарны — в Postgres это одна
 * транзакция с блокировками строк (см. db/recovery-repo.ts). Ключ здесь всегда в виде HMAC.
 */
export interface RecoveryRepo {
  /** Чей снапшот читает/пишет устройство: владелец группы, если устройство в группе, иначе само устройство. */
  snapshotOwnerOf(deviceId: string): Promise<string>;
  find(deviceId: string): Promise<GroupInfo | null>;
  /** Создаёт группу (снапшот этого устройства становится снапшотом группы). `null` — устройство уже в группе. */
  createGroup(deviceId: string, keyHmac: Buffer, now: Date): Promise<{ groupId: string } | null>;
  /** Заменяет ключ группы (старый перестаёт работать). `null` — устройство не в группе. */
  rotateKey(deviceId: string, keyHmac: Buffer, now: Date): Promise<{ groupId: string } | null>;
  /** Присоединяет устройство к группе по HMAC ключа; `ok:false` — такого ключа нет (причины не различаем). */
  redeem(deviceId: string, keyHmac: Buffer, now: Date): Promise<RedeemResult>;
  /**
   * «Отвязать это устройство» (идемпотентно). Устройство получает копию снапшота группы как собственный;
   * если оно владело снапшотом и в группе есть другие — снапшот переезжает на одно из них; последнее — гасит группу.
   */
  unlink(deviceId: string): Promise<void>;
  /** «Удалить ключ и разорвать все связи»: группа и связи удалены, снапшот группы достаётся этому устройству. */
  deleteGroup(deviceId: string): Promise<void>;
}
