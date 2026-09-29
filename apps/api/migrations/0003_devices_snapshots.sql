-- 0003_devices_snapshots: анонимный аккаунт устройства и снапшот прогресса (PD-3).
-- Токен устройства клиенту выдаётся один раз; в БД хранится только его sha256-хеш (hex).
CREATE TABLE devices (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    TEXT        NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Один снапшот на устройство; схема data живёт на клиенте (jsonb без жёсткой валидации).
-- version — монотонный счётчик клиента для оптимистичной конкуренции (PUT с version <= текущего → 409).
CREATE TABLE snapshots (
  device_id   UUID        PRIMARY KEY REFERENCES devices (id) ON DELETE CASCADE,
  version     INTEGER     NOT NULL CHECK (version >= 0),
  updated_at  TIMESTAMPTZ NOT NULL,
  data        JSONB       NOT NULL,
  size_bytes  INTEGER     NOT NULL CHECK (size_bytes >= 0),
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
