export interface GroupInfo {
  /** Сколько устройств в группе (включая это). */
  devices: number;
  keyCreatedAt: Date;
  /** Когда протухает ожидающая (неподтверждённая) замена ключа; `null` — её нет. Может быть в прошлом: тогда её уже нет. */
  pendingExpiresAt: Date | null;
}

/** Ожидающая замена ключа (PD-126): HMAC нового ключа, метка для подтверждения и срок жизни. */
export interface PendingRotation {
  id: string;
  keyHmac: Buffer;
  expiresAt: Date;
}

export type ConfirmRotationResult =
  | { ok: true; groupId: string; keyHmac: Buffer }
  /** `no_key` — устройство не в группе; `no_pending` — ожидающей замены нет; `replaced` — на другом устройстве начата новая замена (метка не совпала); `expired` — срок вышел. */
  | { ok: false; reason: "no_key" | "no_pending" | "replaced" | "expired" };

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
  /**
   * Начинает замену ключа: кладёт НОВЫЙ ключ как ожидающий (затирая прежнюю ожидающую замену). Рабочий ключ группы не
   * меняется и продолжает приниматься в redeem. `null` — устройство не в группе.
   */
  startRotation(deviceId: string, pending: PendingRotation): Promise<{ groupId: string } | null>;
  /** Атомарно делает ожидающий ключ рабочим (старый перестаёт работать), если метка и срок совпали. */
  confirmRotation(deviceId: string, pendingId: string, now: Date): Promise<ConfirmRotationResult>;
  /** Отбрасывает ожидающую замену (идемпотентно; рабочий ключ не трогает). */
  cancelRotation(deviceId: string): Promise<void>;
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
