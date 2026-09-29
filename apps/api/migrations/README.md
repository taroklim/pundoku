# Миграции api

Формат: `NNNN_short_name.sql` (четыре цифры, по возрастанию). Применяются по алфавиту
раннером `src/db/migrate.ts`, каждая в своей транзакции; учёт — в таблице `schema_migrations`.
Откатов нет — только новая миграция вперёд.

- Локально: `pnpm --filter @pundoku/api migrate` (нужен `DATABASE_URL` в `.env`).
- В Docker: выполняется автоматически перед стартом сервера (см. `Dockerfile`).
