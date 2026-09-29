-- 0002_daily_puzzles: кэш ежедневных сеток (PD-3).
-- Сетка дня неизменна: одна строка на дату, запрашивается у источника один раз и хранится навсегда.
-- source = 'generator' означает фолбэк (Sudoku.com был недоступен); допускается позже перезапросить
-- источник, но сейчас это не делается — у всех клиентов должна быть одна и та же сетка.
CREATE TABLE daily_puzzles (
  date        DATE        PRIMARY KEY,
  mission     TEXT        NOT NULL CHECK (mission  ~ '^[0-9]{81}$'),
  solution    TEXT        NOT NULL CHECK (solution ~ '^[1-9]{81}$'),
  difficulty  TEXT        NOT NULL,
  win_rate    NUMERIC(5,2),
  source      TEXT        NOT NULL CHECK (source IN ('sudoku.com', 'generator')),
  source_id   TEXT,
  fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
