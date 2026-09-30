-- 0006_sync_groups: ключ восстановления и группы синхронизации устройств (PD-27, api-часть PD-47).
-- Без почты, паролей и регистрации: устройство создаёт ключ, человек видит его ОДИН РАЗ, на другом устройстве
-- вводит ключ — и оба читают/пишут один снапшот. Токен устройства не меняется, меняется только «чей снапшот».
-- «Группа» = «есть ключ». В БД только HMAC-SHA256 ключа с серверным секретом RECOVERY_KEY_HMAC_SECRET.
CREATE TABLE sync_groups (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hmac            BYTEA       NOT NULL UNIQUE CHECK (octet_length(key_hmac) = 32),
  -- Устройство, под чьим id лежит общий снапшот в `snapshots`. Всегда связано с группой (device_links);
  -- одно устройство владеет снапшотом не более чем одной группы. Без ON DELETE: владельца не удаляем молча.
  snapshot_device_id  UUID        NOT NULL UNIQUE REFERENCES devices (id),
  key_created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE device_links (
  device_id  UUID        PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
  group_id   UUID        NOT NULL REFERENCES sync_groups (id) ON DELETE CASCADE,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX device_links_group_idx ON device_links (group_id);

-- Метка «сирота»: собственный снапшот устройства, присоединившегося к чужой группе, больше никем не читается
-- (устройство теперь читает снапшот группы). Строку не удаляем — данные могли не дойти до группы; метка нужна
-- будущей чистке по политике проекта (сейчас политики и задачи чистки нет). Сбрасывается, когда строка снова
-- становится живой: запись через PUT, копия/переезд снапшота группы, создание ключа этим устройством.
ALTER TABLE snapshots ADD COLUMN orphaned_at TIMESTAMPTZ;
