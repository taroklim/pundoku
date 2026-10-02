-- 0007_sync_groups_pending_rotation: отложенная замена ключа восстановления (PD-126, SC-08 / H-21).
-- «Replace key» больше не гасит старый ключ сразу: новый ключ выдаётся как ОЖИДАЮЩИЙ (хранится только его HMAC, как и
-- у основного), старый остаётся рабочим. Переключение — атомарно по явному подтверждению «Key saved»
-- (POST /api/recovery/key/rotate/confirm); неподтверждённый ожидающий ключ протухает (pending_expires_at, 24 ч) и
-- никогда не принимается в redeem. Одна ожидающая замена на группу: новая замена затирает прежнюю.
-- Только ADD COLUMN без NOT NULL и без значений по умолчанию: применяется на задеплоенной БД без потери и без
-- перезаписи строк, существующие группы получают «нет ожидающей замены».
ALTER TABLE sync_groups
  ADD COLUMN pending_key_hmac    BYTEA CHECK (pending_key_hmac IS NULL OR octet_length(pending_key_hmac) = 32),
  -- Непрозрачная метка замены: подтверждение обязано её вернуть, иначе устройство, которое показывало прежнюю
  -- замену, подтвердило бы чужой (ещё никому не показанный) ключ, начатый на другом устройстве группы.
  ADD COLUMN pending_id          UUID,
  ADD COLUMN pending_expires_at  TIMESTAMPTZ,
  ADD CONSTRAINT sync_groups_pending_all_or_none CHECK (
    (pending_key_hmac IS NULL) = (pending_id IS NULL) AND (pending_id IS NULL) = (pending_expires_at IS NULL)
  );
