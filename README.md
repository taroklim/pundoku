# Pundoku

Чистое судоку как ежедневный ритуал — PWA для iPhone. Контекст продукта, роадмап и
ограничения — `CLAUDE.md`; доска тикетов — `STATUS.md`.

## Структура

```
apps/
  web/        @pundoku/web   — React + Vite PWA (vite-plugin-pwa, i18n en/uk/ru). Клиент, офлайн-first.
  api/        @pundoku/api   — Express 5 (Node/TS): прокси Sudoku.com для Today + аккаунт устройства/снапшот. Postgres.
packages/
  engine/     @pundoku/engine — генератор/решатель с логом техник. Чистый ES2022, без DOM/Node, MIT.
docker-compose.yml           — postgres:16 + api (сборка из apps/api/Dockerfile, контекст — корень).
tsconfig.base.json           — общий strict-конфиг TypeScript, пакеты его расширяют.
eslint.config.js             — общий ESLint (flat config, typescript-eslint).
```

## Запуск

Требования: Node 20+ (`.nvmrc`), pnpm 12 (`corepack enable` подхватит версию из `packageManager`).

```sh
pnpm i                      # зависимости всего workspace
cp .env.example .env        # локальные переменные (не коммитится)

pnpm dev                    # web + api параллельно (vite :5173, api :3000)
pnpm dev:web                # только web; с iPhone в той же сети: pnpm dev:web -- --host
pnpm dev:api                # только api (tsx watch), GET http://localhost:3000/health

pnpm typecheck              # tsc --noEmit во всех пакетах (из чистого клона, без предварительного build)
pnpm test                   # vitest (engine; api — unit + интеграционные против DATABASE_URL, скип без БД)
pnpm lint                   # eslint
pnpm build                  # engine → api → web (dist/)
pnpm measure:engine 200     # замер попыток/времени генерации сетки по классам (см. README движка)
```

Postgres локально — через Docker (или любой свой, напр. `brew install postgresql@16`,
`createdb pundoku_dev`), api при этом гоняется без контейнера:

```sh
docker compose up -d postgres   # либо свой Postgres + DATABASE_URL в .env
pnpm migrate                # применить миграции к DATABASE_URL из .env
pnpm dev:api
```

`.env` ищется в `apps/api/.env`, затем в корне репо. Эндпоинты, curl-примеры и запуск без
Docker — `apps/api/README.md`.

Всё в контейнерах: `docker compose up --build` (api сам прогоняет миграции перед стартом).

## Миграции (решение PD-0)

Собственный SQL-раннер на `pg` без ORM — `apps/api/src/db/migrate.ts`. Файлы
`apps/api/migrations/NNNN_name.sql`, применяются по порядку, каждая в транзакции, учёт в
`schema_migrations`. Откатов нет — только миграция вперёд. Подробности —
`apps/api/migrations/README.md`.

## Что где менять

- Экраны и UI — `apps/web/src/` (после утверждения макета владельцем; PD-0 — только оболочка).
- Переводы — `apps/web/src/i18n/locales/{en,uk,ru}.json`, язык определяется по `navigator.language`.
- PWA-манифест и service worker — `apps/web/vite.config.ts` (`VitePWA`, autoUpdate).
- Иконки — `apps/web/public/icons/` (плейсхолдеры; перегенерация `pnpm --filter @pundoku/web icons`).
- HTTP-эндпоинты — `apps/api/src/app.ts` (роуты по модулям `daily/`, `devices/`, `snapshot/`; описание — `apps/api/README.md`).
- Логика судоку — `packages/engine/src/`. Никакого GPL-кода (HoDoKu, Sudoku Explainer) — только
  переписанная по описанию логика техник.

## iOS PWA — чек-лист, заложенный в каркас

`viewport-fit=cover` + `env(safe-area-inset-*)`, `100dvh`, `touch-action: manipulation`,
`apple-mobile-web-app-capable`, `theme-color` под светлую/тёмную тему, шрифт ≥16px в нативных
`<select>/<input>` (иначе Safari зумит), `prefers-color-scheme` и `prefers-reduced-motion`.
Полный список — `reports/sudoku-pwa-research/03-tech.md` в корне портфеля.
