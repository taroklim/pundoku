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
Переменные: `DATABASE_URL`, `PORT` (3000; целое 1–65535 — порт 0 не поддерживается; не задан → 3000, пустой/нечисловой/дробной/вне диапазона → ошибка конфигурации), `WEB_ORIGIN` (CORS, через запятую; по умолчанию
`http://localhost:5173`), `SUDOKU_COM_BASE_URL`, `SUDOKU_COM_TIMEOUT_MS` (5000),
`DAILY_FALLBACK_DIFFICULTY` (`medium` — профиль движка 30 подсказок/singles ≈ Sudoku.com «hard»; допустимо — значения `DIFFICULTIES` движка (`easy|medium|hard|expert|master`), иное значение — ошибка конфигурации при старте), `DAILY_UPSTREAM_RETRY_MS` (60000, см. «Замена фолбэка»; как и `SUDOKU_COM_TIMEOUT_MS` — только десятичные цифры), `LOG_LEVEL` (`info`; `trace|debug|info|warn|error|fatal|silent`), `TRUST_PROXY` (`1` за reverse proxy).

Неверное значение `PORT`, `LOG_LEVEL`, `DAILY_FALLBACK_DIFFICULTY`, `SUDOKU_COM_TIMEOUT_MS`, `DAILY_UPSTREAM_RETRY_MS` — ошибка конфигурации при старте: одна строка в stderr без стека, код выхода 1.

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
- `Cache-Control: public, max-age=3600` для `source: sudoku.com`; для фолбэк-сетки (`generator`) —
  `max-age=60`: она временная и заменится настоящей (см. «Замена фолбэка»).
- `400 invalid_date` — формат/календарь; `400 future_date` — дальше завтра (UTC);
  `404 not_available_yet` — «завтра» у Sudoku.com ещё нет (без кэша, повторить позже);
  `503 daily_unavailable` — Sudoku.com не ответил И фолбэк-генератор не сработал (например, не
  собран движок); ничего не кэшируется, повторить позже.

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

`PUT /api/snapshot` `{ version: int ≥ 0, updatedAt: ISO 8601, data: object }`
(`updatedAt` — строгий ISO 8601 date-time с часовым поясом: `2026-09-29T10:00:00Z`,
`…:00.123Z`, `…:00+03:00`; `"1"`, `"2026"`, `"2026-09-29"`, без пояса, несуществующие даты — `400`).
Строго заглавные `T` и `Z`: формат RFC 3339 допускает строчные `t`/`z`, но API их **не принимает** —
`"2026-09-29t10:00:00z"` → `400 invalid_updated_at` (`Date.toISOString()` клиента всегда даёт заглавные):
- `409 snapshot_conflict` + `snapshot: {version, updatedAt, data}` (текущий на сервере), если
  присланный `version` ≤ сохранённого — клиент сливает сам и шлёт новую версию.
- `413 snapshot_too_large` — сериализованный `data` больше 1 МиБ.
- `400 invalid_body | invalid_version | invalid_updated_at | invalid_data`.
- Структура `data` не валидируется (jsonb, схема на клиенте) — только «объект»; лимиты PD-14 не менялись: 1 МиБ
  `data` по UTF-8 байтам, JSON-парсер 1200 КиБ (`413 payload_too_large`), CORS разрешает `PUT`/`Authorization`.
  Формат `data` (`schemaVersion`, `grid`, `days`), политика 409-слияния и бюджет размера — в README `apps/web`.
- Клиент не должен полагаться на «мёртвые» устройства: токен без снапшота даёт `404 snapshot_not_found` на GET —
  это нормальное состояние нового устройства.

## Источник сетки дня: Sudoku.com

Неофициальный JSON Easybrain, проверен живым запросом 2026-09-29 (детали и примеры —
docblock в `src/daily/sudoku-com-source.ts`):

```
GET https://sudoku.com/api/v2/dc/YYYY-MM-DD      X-Requested-With: XMLHttpRequest  (обязателен, иначе 403)
200 {"id":"1f13c7e4-…","mission":"0020…","solution":"9624…","win_rate":52.1,"difficulty":"hard"}
204 (пустое тело) — дата дальше завтра по UTC;  404 text/html — невалидная дата;  CORS-заголовков нет.
```

Цепочка в `src/daily/service.ts`: кэш `daily_puzzles` → Sudoku.com → генератор `@pundoku/engine`
(`dailyPuzzle(date, difficulty)`, seed = `dailySeed(date, difficulty)`, напр. `2026-09-29/medium`; сложность — `DAILY_FALLBACK_DIFFICULTY`, по умолчанию `medium`).
**Seed-конвенция сетки дня едина для сервера и офлайн-клиента:** фолбэк — только `dailyPuzzle` движка,
не `generate({ seed: date })` (это другая сетка). Закреплено тестом `src/daily/generator.test.ts`
(api-фолбэк === `dailyPuzzle` движка). Что бы ни стало источником, строка сохраняется навсегда — у всех клиентов одна
сетка на дату. Таймаут запроса — `SUDOKU_COM_TIMEOUT_MS`; 403/таймаут/невалидный JSON/несогласованные
mission+solution → фолбэк.

### Замена фолбэка настоящей сеткой

Если Sudoku.com был недоступен и в кэш легла фолбэк-сетка (`source='generator'`), следующий запрос
на эту дату **перезапрашивает Sudoku.com**; при успехе строка заменяется: `source → 'sudoku.com'`,
`difficulty/win_rate/source_id/mission/solution` — от Sudoku.com, `fetched_at` обновляется,
`replaced_at` заполняется (миграция `0004`). Дальше сетка снова неизменна. Перезапросы не чаще
раза в `DAILY_UPSTREAM_RETRY_MS` (60 с) на дату (in-memory, сбрасывается рестартом), чтобы мёртвый
источник не вешал каждый запрос таймаутом. Любой факт обращения к Sudoku.com пишется в лог
уровня `info` (`upstream: "sudoku.com"`, `outcome: ok|not_available|error`).
Следствие для клиента: фолбэк-сетка дня может смениться на другую, пока игрок её не решил;
клиент должен сверять сетку с ответом `GET /api/daily/:date` (поле `source`) при возврате в сеть.

### Версия генератора у фолбэка (PD-14, миграция `0005`)

`generator`-строка хранит `generator_version` — `GENERATOR_VERSION` движка на момент генерации. Когда версия строки
не совпадает с текущей (или NULL — строки до миграции), строка **игнорируется и пересоздаётся** при запросе на
дату: сначала пробуем Sudoku.com (с тем же троттлингом `DAILY_UPSTREAM_RETRY_MS`), иначе генерируем заново текущей
версией (`replaceStale`, атомарная замена; гонка двух запросов не даёт двух разных сеток). Так офлайн-клиент новой
версии движка и сервер снова считают одну и ту же фолбэк-сетку. Строки `sudoku.com` не трогаются никогда. Если движок
не отдаёт версию (не собран) — устаревание не проверяется, строка отдаётся как есть. Тесты — `router.test.ts`,
`generator.test.ts`, `integration.test.ts` (живой Postgres).

**Точка подключения движка:** `src/daily/generator.ts`, `EngineGenerator.generateDaily(date, difficulty)` —
вызывает `dailyPuzzle(date, difficulty)` → `{ givens, solution }` (81 число 0..9 / 1..9). Модуль
грузится динамически, чтобы typecheck api не зависел от собранного движка (для тестов и запуска
движок должен быть собран: `pnpm build`).

## Схема БД

- `daily_puzzles(date PK, mission, solution, difficulty, win_rate, source, source_id, fetched_at)` — `0002`;
  `replaced_at` (когда фолбэк заменён сеткой Sudoku.com, NULL — не заменялась) — `0004`;
  `generator_version` (версия `GENERATOR_VERSION` движка, которой создан фолбэк; NULL у `sudoku.com` и у
  фолбэков до миграции) — `0005`.
- `devices(id uuid PK, token_hash unique, created_at, last_seen_at)`,
  `snapshots(device_id PK → devices, version, updated_at, data jsonb, size_bytes, saved_at)` — `0003`.

Раннер — `src/db/migrate.ts` (см. `migrations/README.md`). Запуск как точка входа определяется по
реальным путям (`realpath`), поэтому `node /путь/к/симлинку-на-migrate.js` работает так же, как прямой запуск.

## Тесты

```sh
pnpm --filter @pundoku/api test                 # unit (supertest + моки) и интеграционные
LIVE_SUDOKU_COM=1 pnpm --filter @pundoku/api test -- sudoku-com-live   # живой запрос к Sudoku.com
```

Typecheck и vitest видят `@pundoku/engine` по исходникам (`paths` в `tsconfig.json`, алиас в
`vitest.config.ts`) — `pnpm typecheck`/`pnpm test` работают из чистого клона без `pnpm build`;
`tsconfig.build.json` paths сбрасывает, сборка использует собранный движок (`pnpm -r build` собирает
по порядку зависимостей).

Интеграционные (`src/integration.test.ts`) идут против живой БД **только если задан `TEST_DATABASE_URL`
(или, как запасной вариант, `DATABASE_URL`)**; иначе весь файл помечается skipped (в консоли предупреждение), а
`pnpm test` при этом остаётся зелёным — «тесты прошли» без URL не значит, что интеграционные выполнялись. Они сами
прогоняют миграции, создают свои строки (даты `1999-01-0x`, свои устройства) и убирают их, но лучше давать
отдельную БД. Точная команда (Homebrew Postgres 16, свежая БД):

```sh
dropdb --if-exists pundoku_test && createdb pundoku_test
DATABASE_URL=postgres://localhost:5432/pundoku_test pnpm migrate      # из корня монорепо; можно и пропустить — тесты мигрируют сами
TEST_DATABASE_URL=postgres://localhost:5432/pundoku_test pnpm --filter @pundoku/api test
```

Проверка: `pnpm --filter @pundoku/api exec vitest run --reporter=verbose | grep integration` — должны быть строки
`✓ src/integration.test.ts > integration (Postgres) > …` (7 тестов), а не `↓` (skipped). Если БД недоступна при
заданном URL — файл тоже скипается с предупреждением, проверяйте вывод. Отдельно от него `sudoku-com-live` всегда
skipped без `LIVE_SUDOKU_COM=1` — это норма.

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
src/test/fakes.ts        in-memory репозитории и фейки для unit-тестов (не попадает в dist: tsconfig.build.json)
migrations/              NNNN_name.sql
```
