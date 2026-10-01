-- PD-66: число строк в ключевых таблицах, формат "table=N" (psql -At). Нужен backup.yml (прод ДО и ПОСЛЕ pg_dump)
-- и scripts/verify-dump.sh (восстановленная БД). Список таблиц держать в синхроне с scripts/verify-dump.sh.
SELECT 'devices=' || count(*) FROM devices
UNION ALL SELECT 'snapshots=' || count(*) FROM snapshots
UNION ALL SELECT 'daily_puzzles=' || count(*) FROM daily_puzzles
UNION ALL SELECT 'sync_groups=' || count(*) FROM sync_groups
UNION ALL SELECT 'device_links=' || count(*) FROM device_links
UNION ALL SELECT 'schema_migrations=' || count(*) FROM schema_migrations;
