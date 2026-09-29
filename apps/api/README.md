# @pundoku/api

Минимальный Node/TS бэкенд (Express 5, `pg`, Postgres): прокси сетки дня Sudoku.com с кэшем и
фолбэком на генератор + анонимный аккаунт устройства со снапшотом прогресса (PD-3).

## Запуск локально без Docker

Нужен любой Postgres 13+ (на macOS: `brew install postgresql@16 && brew services start postgresql@16`).

```sh
createdb pundoku_dev                                   # один раз
echo 'DATABASE_URL=postgres://localhost:5432/pundoku_dev' > apps/api/.env   # или в корневой .env
pnpm --filter @pundoku/api migrate                     # применить migrations/*.sql
pnpm dev:api                                           # tsx watch, http://localhost:3000
```

`.env` ищется сначала в `apps/api/.env`, затем в корне репо (`.env.example` — там же).
Переменные: `DATABASE_URL`, `PORT` (3000), `WEB_ORIGIN` (CORS, через запятую; по умолчанию
`http://localhost:5173`), `SUDOKU_COM_BASE_URL`, `SUDOKU_COM_TIMEOUT_MS` (5000),
`DAILY_FALLBACK_DIFFICULTY` (`hard`), `LOG_LEVEL` (`info`), `TRUST_PROXY` (`1` за reverse proxy).

С Docker: `docker compose up -d postgres` и дальше то же самое (см. корневой README).

## Эндпоинты

Все ошибки — JSON `{ "error": { "code", "message" } }` (+ доп. поля, например `snapshot` у 409).
Rate-limit по IP (in-memory): `/api/daily/*` — 60/мин, `POST /api/devices` — 10/мин; сверх — `429`
с `Retry-After`. Заголовки `RateLimit-Limit/Remaining/Reset` есть всегда.

### Сетка дня (без авторизации)

`GET /api/daily/:date` — `date` в `YYYY-MM-DD` (UTC), допустимо до «завтра» включительно.

```sh
curl http://localhost:3000/api/daily/2026-09-28
# {"date":"2026-09-28","mission":"002000000085703020…830","difficulty":"hard","winRate":52.1,"source":"sudoku.com"}
```

- `mission` — 81 цифра, `0` = пустая клетка; `solution` клиенту **не отдаётся**.
- `source`: `sudoku.com` или `generator` (фолбэк, `winRate` тогда отсутствует).
- `Cache-Control: public, max-age=3600`.
- `400 invalid_date` — формат/календарь; `400 future_date` — дальше завтра (UTC);
  `404 not_available_yet` — «завтра» у Sudoku.com ещё нет (без кэша, повторить позже).

`POST /api/daily/:date/verify` `{ "grid": "<81 цифра 1-9>" }` → `{ "correct": true|false }` —
сравнение с решением, сохранённым на сервере.

```sh
curl -X POST http://localhost:3000/api/daily/2026-09-28/verify \
  -H 'content-type: application/json' -d '{"grid":"962415378185763429…832"}'
```

### Устройство и снапшот

`POST /api/devices` → `201 { "deviceId": "<uuid>", "deviceToken": "<43 символа base64url>" }`.
Клиент вызывает при первом запуске и хранит токен; сервер хранит только sha256-хеш,
повторно токен не выдаётся. Остальные вызовы — с `Authorization: Bearer <deviceToken>`
(`401 unauthorized` при отсутствии/неизвестном токене).

```sh
TOK=$(curl -s -X POST http://localhost:3000/api/devices | jq -r .deviceToken)

curl -X PUT http://localhost:3000/api/snapshot -H "Authorization: Bearer $TOK" \
  -H 'content-type: application/json' \
  -d '{"version":1,"updatedAt":"2026-09-29T10:00:00Z","data":{"grid":{},"year":{}}}'
# 200 {"version":1,"updatedAt":"2026-09-29T10:00:00.000Z","sizeBytes":24}

curl http://localhost:3000/api/snapshot -H "Authorization: Bearer $TOK"
# 200 {"version":1,"updatedAt":"2026-09-29T10:00:00.000Z","data":{"grid":{},"year":{}}}   | 404 snapshot_not_found
```

`PUT /api/snapshot` `{ version: int ≥ 0, updatedAt: ISO 8601, data: object }`:
- `409 snapshot_conflict` + `snapshot: {version, updatedAt, data}` (текущий на сервере), если
  присланный `version` ≤ сохранённого — клиент сливает сам и шлёт новую версию.
- `413 snapshot_too_large` — сериализованный `data` больше 1 МиБ.
- `400 invalid_body | invalid_version | invalid_updated_at | invalid_data`.
- Структура `data` не валидируется (jsonb, схема на клиенте) — только «объект».

## Источник сетки дня: Sudoku.com

Неофициальный JSON Easybrain, проверен живым запросом 2026-09-29 (детали и примеры —
docblock в `src/daily/sudoku-com-source.ts`):

```
GET https://sudoku.com/api/v2/dc/YYYY-MM-DD      X-Requested-With: XMLHttpRequest  (обязателен, иначе 403)
200 {"id":"1f13c7e4-…","mission":"0020…","solution":"9624…","win_rate":52.1,"difficulty":"hard"}
204 (пустое тело) — дата дальше завтра по UTC;  404 text/html — невалидная дата;  CORS-заголовков нет.
```

Цепочка в `src/daily/service.ts`: кэш `daily_puzzles` → Sudoku.com → генератор `@pundoku/engine`
с seed = дата. Что бы ни стало источником, строка сохраняется навсегда — у всех клиентов одна
сетка на дату. Таймаут запроса — `SUDOKU_COM_TIMEOUT_MS`; 403/таймаут/невалидный JSON/несогласованные
mission+solution → фолбэк.

**Точка подключения движка (PD-2):** `src/daily/generator.ts`, `EngineGenerator` — ожидает
`generate({ difficulty, seed }) → { givens, solution }` (81 число 0..9 / 1..9). Модуль грузится
динамически, чтобы typecheck/тесты api не зависели от собранного движка; пока в `main` заглушка,
фолбэк отвечает `500 internal`.

## Схема БД

- `daily_puzzles(date PK, mission, solution, difficulty, win_rate, source, source_id, fetched_at)` — `0002`.
- `devices(id uuid PK, token_hash unique, created_at, last_seen_at)`,
  `snapshots(device_id PK → devices, version, updated_at, data jsonb, size_bytes, saved_at)` — `0003`.

Раннер — `src/db/migrate.ts` (см. `migrations/README.md`).

## Тесты

```sh
pnpm --filter @pundoku/api test                 # unit (supertest + моки) и интеграционные
LIVE_SUDOKU_COM=1 pnpm --filter @pundoku/api test -- sudoku-com-live   # живой запрос к Sudoku.com
```

Интеграционные (`src/integration.test.ts`) идут против `TEST_DATABASE_URL ?? DATABASE_URL`,
сами прогоняют миграции, создают свои строки (даты `1999-01-0x`, свои устройства) и убирают их.
Если БД недоступна — файл скипается с предупреждением в консоли.

## Структура

```
src/app.ts               сборка Express-приложения с DI (helmet, cors, pino-http, json, роуты, ошибки)
src/index.ts             реальные зависимости (pg Pool, SudokuComSource, EngineGenerator) + listen
src/config/env.ts        переменные окружения
src/daily/               types, sudoku-com-source (адаптер), generator (адаптер движка), service, router
src/devices/             tokens (генерация/хеш), auth (requireDevice), router
src/snapshot/            types, router
src/db/                  pool, migrate, *-repo (Postgres-реализации репозиториев)
src/middleware/          error-handler, rate-limit, request-log
src/test/fakes.ts        in-memory репозитории и фейки для unit-тестов
migrations/              NNNN_name.sql
```
