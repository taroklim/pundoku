# Pundoku — публичный деплой (PD-61)

Цель: владелец ставит PWA на iPhone по HTTPS и проходит iPhone-чек-лист. Схема повторяет SUMMON
(`products/game-rooms/DEPLOY.md`): домашний Windows-ноут, Docker Desktop, GitHub Actions self-hosted runner,
Cloudflare-домен через Cloudflare Tunnel. Отличия от SUMMON — **один origin** вместо двух хостов и миграции отдельным
сервисом.

> Статус проверки: образы Docker и сам compose-стек на машине разработки собрать/запустить было нельзя (нет Docker) —
> см. раздел «Не проверено». Первый запуск на ноуте нужно проводить наблюдаемо, по разделу «Первый ручной запуск».

## Схема

```
iPhone (Safari / PWA) --HTTPS--> Cloudflare (домен, TLS) --Tunnel--> cloudflared (служба Windows на ноуте)
                                                                          |
                                                          http://localhost:8090   (только 127.0.0.1)
                                                                          v
   ┌──────────────────────────── docker compose, проект `pundoku` ──────────────────────────────────┐
   │  web (nginx)  :80  ── /            статика PWA + SPA-fallback                                 │
   │                    ── /api/*, /health  reverse proxy ──> api :3000 ──> postgres :5432         │
   │  migrate (одноразовый: node dist/db/migrate.js, до старта api)                                 │
   └────────────────────────────────────────────────────────────────────────────────────────────────┘
   Наружу опубликован ТОЛЬКО web: 127.0.0.1:8090 -> 80. api и postgres не публикуются вообще.
```

Входящие порты на ноуте не открываются: `cloudflared` и GitHub-раннер сами ходят наружу.

## Компоненты

- **Docker Desktop** (Windows, WSL2) — контейнеры. Должен стартовать вместе с Windows (Settings -> General -> Start Docker
  Desktop when you sign in), иначе после перезагрузки ноута сайт лежит до ручного запуска.
- **web** (`apps/web/Dockerfile`, `apps/web/nginx/`) — nginx:alpine со статикой `apps/web/dist`, SPA-fallback,
  проксирует `/api/*` и `/health` на api, gzip, кэш- и security-заголовки. Порт на хосте: **`127.0.0.1:8090`**
  (SUMMON занимает `127.0.0.1:8080` и `127.0.0.1:3000` — не пересекаемся).
- **api** (`apps/api/Dockerfile`) — Express 5. `NODE_ENV=production`, `TRUST_PROXY=1`. Не опубликован на хост.
- **postgres** — `postgres:16-alpine`, данные в именованном volume `pundoku_postgres_data`. Не опубликован на хост.
- **migrate** — одноразовый контейнер того же образа, что api (см. «Миграции»).
- **cloudflared** — служба Windows на ноуте (Cloudflare Tunnel): публичный hostname -> `http://localhost:8090`.
- **GitHub Actions self-hosted runner** — деплой при пуше в `main` (`.github/workflows/deploy.yml`),
  ночной бэкап (`.github/workflows/backup.yml`).

### Почему один origin, а не два хоста как у SUMMON

У SUMMON фронтенд и API пересекались по путям, поэтому там два хоста. У Pundoku все API-роуты уже под `/api/*`, а в dev
`apps/web/vite.config.ts` проксирует `/api` на api. Прод повторяет ту же схему: nginx отдаёт статику и проксирует `/api`.
Плюсы: одна запись Cloudflare Tunnel, нет CORS, нет запечённого в бандл адреса api (`VITE_API_BASE_URL` в проде пуст).
Service worker не кэширует `/api/*` (`navigateFallbackDenylist` в `vite.config.ts`).

## GitHub Secrets и Variables (полный список)

Создаются в репозитории: **Settings -> Secrets and variables -> Actions**.

| Имя | Тип | Обязателен | Что это и чем генерировать |
|---|---|---|---|
| `POSTGRES_PASSWORD` | Secret | да | Пароль Postgres. `openssl rand -hex 24` (hex, чтобы не ломать URL подключения — спецсимволы `/ + =` пришлось бы экранировать). Применяется **только при первом создании тома** — см. «Смена секретов» |
| `RECOVERY_KEY_HMAC_SECRET` | Secret | да | HMAC-секрет ключей восстановления, **>= 32 байт**. `openssl rand -base64 48`. Без него (или короче 32) api не стартует — см. ниже |
| `PUBLIC_ORIGIN` | Variable (не секрет) | да | Публичный адрес PWA: `https://pundoku.<твой-домен>` — со схемой, без пути и без завершающего `/`. Уходит в `WEB_ORIGIN` api |
| `LAPTOP_USER` | Variable | нет | Имя пользователя Windows на ноуте, у которого стоит Docker Desktop. По умолчанию `pyshn` (как в SUMMON). Нужна, только если это другой пользователь |

Других секретов нет: `POSTGRES_USER`/`POSTGRES_DB` фиксированы (`pundoku`) в `deploy.yml`, `DATABASE_URL`/`PORT`/
`TRUST_PROXY`/`NODE_ENV` собирает `docker-compose.yml`, Sudoku.com-переменные и `LOG_LEVEL` имеют дефолты в compose
(переопределяются через `.env` при необходимости: `SUDOKU_COM_BASE_URL`, `SUDOKU_COM_TIMEOUT_MS`,
`DAILY_FALLBACK_DIFFICULTY`, `LOG_LEVEL`). Cloudflare API-токен не нужен: явных заголовков `no-cache` достаточно,
чтобы Cloudflare не залипал на устаревшей статике (у SUMMON для этого пришлось делать purge, см. GR-72).

Как падает без `RECOVERY_KEY_HMAC_SECRET` (проверено запуском собранного api с `NODE_ENV=production`): в stderr одна
строка `[pundoku-api] Ошибка конфигурации: Переменная окружения RECOVERY_KEY_HMAC_SECRET не задана: вне development нужен
секрет ≥32 байт ...`, код выхода 1; при значении короче 32 байт — `... должна быть не короче 32 байт (сейчас N)`. Кроме
того, `docker compose` не поднимет стек, пока переменная не задана (`:?` в compose), а `deploy.yml` падает на шаге
сборки `.env` с понятным сообщением. Миграции от секрета не зависят.

### Смена секретов
- `POSTGRES_PASSWORD` читается Postgres только при инициализации пустого тома. Поменял секрет после первого запуска —
  api перестанет подключаться (auth failed). Менять так: `docker exec -it pundoku-postgres-1 psql -U pundoku -c
  "ALTER USER pundoku PASSWORD '<новый>'"`, затем обновить секрет и передеплоить.
- `RECOVERY_KEY_HMAC_SECRET`: в БД лежит HMAC ключа, не сам ключ. Сменишь или потеряешь — все выданные ключи
  восстановления перестанут работать. Хранить копию секрета в менеджере паролей.

## Первичная настройка (владелец, один раз)

Агент ничего из этого сделать не может (нужны аккаунты GitHub/Cloudflare и доступ к ноуту).

### 1. Репозиторий GitHub
1. Создать пустой репозиторий (private) на GitHub, например `Taroklim/Pundoku` — без README/лицензии.
2. В папке продукта на macOS: `git remote add origin git@github.com:<владелец>/Pundoku.git`, затем
   `git push -u origin main` (смерженный `main` с этим тикетом).
3. Добавить Secrets и Variables из таблицы выше.

### 2. Self-hosted runner на ноуте
Раннер привязан к одному репозиторию, поэтому для Pundoku нужен **второй экземпляр** рядом с SUMMON-овским.
1. Репозиторий -> **Settings -> Actions -> Runners -> New self-hosted runner** -> Windows/x64.
2. Распаковать в **отдельную** папку (например `C:\actions-runner-pundoku`, не в папку SUMMON-раннера) и выполнить команды
   со страницы мастера как есть. `config.cmd` запускать из PowerShell **от администратора**; на вопрос «run as a service»
   ответить **да** (иначе раннер не переживёт закрытие терминала/перезагрузку). Метки по умолчанию (`self-hosted`,
   `Windows`, `X64`) оставить — `deploy.yml`/`backup.yml` ждут именно их.
3. Проверить: Settings -> Actions -> Runners -> статус **Idle**.

Особенности, унаследованные от SUMMON (все уже учтены в workflow):
- служба раннера работает под Local System и не видит PATH пользователя -> шаг «Добавить Docker Desktop в PATH»
  (`C:\Users\<LAPTOP_USER>\AppData\Local\Programs\DockerDesktop\resources\bin`; Docker Desktop у нас per-user);
- у Local System нет CLI-плагинов Docker -> `DOCKER_CONFIG: C:\Users\<LAPTOP_USER>\.docker`;
- Execution Policy -> `shell: powershell -ExecutionPolicy Bypass -File "{0}"`;
- фиксированный `COMPOSE_PROJECT_NAME: pundoku`;
- кириллица не используется в inline-PowerShell (только в комментариях YAML) — на Windows-раннере она роняла workflow;
- ненулевой код возврата `docker` проверяется явно (`-File` иначе завершал бы шаг зелёным).

### 3. Cloudflare Tunnel
Нужен домен, управляемый Cloudflare.
1. Cloudflare Zero Trust -> **Networks -> Tunnels**. Если туннель SUMMON уже есть — открыть его; иначе **Create a tunnel**
   (Cloudflared), поставить `cloudflared` на ноут как службу Windows по команде из мастера.
2. Вкладка **Public Hostname -> Add a public hostname**:
   - Subdomain/Domain: например `pundoku` + твой домен;
   - Service: Type **HTTP**, URL **`localhost:8090`**.
3. Cloudflare сам создаст DNS-запись (CNAME на туннель, proxied). Сертификат/HTTPS выдаёт Cloudflare, на ноуте
   TLS-настройки не нужны.
4. Значение `PUBLIC_ORIGIN` = `https://<subdomain>.<домен>`.

`cloudflared` запущен на хосте, поэтому `localhost:8090` — это опубликованный порт Docker. (Если `cloudflared` когда-нибудь
переедет в контейнер — адрес источника придётся менять на имя сервиса `web:80`; сейчас так не делаем.)

### 4. Питание ноута
Спящий режим останавливает всё, включая раннер и туннель: Параметры -> Система -> Питание — «никогда» при питании от сети.

## Первый ручной запуск (до автодеплоя)

На ноуте, в клоне репозитория (PowerShell), чтобы убедиться, что стек вообще поднимается:

```powershell
copy .env.example .env
# Отредактировать .env: POSTGRES_PASSWORD, RECOVERY_KEY_HMAC_SECRET, PUBLIC_ORIGIN (см. таблицу секретов).
$env:COMPOSE_PROJECT_NAME = 'pundoku'      # то же имя проекта, что в deploy.yml
docker compose build
docker compose up -d                        # postgres -> migrate -> api -> web
docker compose ps                           # postgres/api/web: running (healthy); migrate: exited (0)
curl.exe -i http://127.0.0.1:8090/health    # 200 {"status":"ok",...}
curl.exe -I http://127.0.0.1:8090/          # 200
```

После этого пуш в `main` (или **Actions -> Deploy (self-hosted) -> Run workflow**) выкатывает всё сам. Если первый
запуск сделан руками из другой папки — имя проекта всё равно `pundoku`, стек не задвоится.

## Автодеплой

`.github/workflows/deploy.yml`, триггеры: push в `main` и `workflow_dispatch` (только с ветки `main`).

1. **gates** (GitHub-hosted `ubuntu-latest`, service Postgres 16): `pnpm install --frozen-lockfile` -> `pnpm build`
   (engine -> api -> web) -> `pnpm typecheck` -> `pnpm migrate` -> `pnpm test` (engine, web, api включая интеграционные
   тесты против реального Postgres и recovery-интеграцию). Lint в гейт не входит (деплой не должен блокироваться стилем);
   гонять — `pnpm lint`.
2. **deploy** (`[self-hosted, Windows, X64]`, зависит от gates, только `main`): PATH для Docker -> `.env` из
   Secrets/Variables (валидирует: секрет >= 32 байт, `PUBLIC_ORIGIN` вида `https://host`) -> `docker compose config -q` ->
   `docker compose build` -> `docker compose up -d` -> smoke -> `docker image prune -f`. При падении любого шага в лог
   выводятся `docker compose ps -a` и хвост логов сервисов.
3. **Smoke** по `127.0.0.1:8090` (мимо Cloudflare, поэтому проверяет сам стек, а не туннель), до 30 попыток с паузой 5 с:
   `GET /health` (nginx -> api), `GET /` (статика), `GET /manifest.webmanifest`, `GET /api/daily/<сегодня UTC>`
   (nginx -> api -> Postgres: подтверждает миграции и БД). Всё должно быть 200.

Файл `.env` пересоздаётся на каждом деплое (checkout чистит рабочую директорию); запущенные контейнеры продолжают
жить со своим окружением и от отсутствия файла не страдают.

## Миграции — решение

**Одноразовый compose-сервис `migrate`** (тот же образ, `node dist/db/migrate.js`), от которого `api` зависит
через `service_completed_successfully`. Почему не «при старте api» и не отдельный шаг workflow:
- **одной командой**: `docker compose up -d` поднимает postgres -> миграции -> api -> web, ручной первый запуск и
  автодеплой идентичны, ни того, ни другого нельзя «забыть»;
- **fail-fast**: упавшая миграция обрывает `up` с ошибкой, деплой красный, а работающий api предыдущей версии не
  пересоздаётся и продолжает обслуживать запросы. При миграции «внутри старта api» новый api уходил бы в рестарт-цикл, а
  старый уже был бы заменён;
- api не зависит от прав/гонок при перезапусках: миграции идемпотентны (учёт в `schema_migrations`, каждая в
  транзакции), повторный `up` — no-op.

Образ api по-прежнему умеет мигрироваться сам при старте (`CMD` в Dockerfile), но в compose команда переопределена на
`node dist/index.js`.

**Правило для авторов миграций:** миграция накатывается, пока ещё работает api прошлой версии, а откат кода схему не
откатывает (откатов в раннере нет, только «вперёд»). Значит — только обратно-совместимые изменения; удаление/
переименование — в два релиза. Читать SQL новой миграции глазами до пуша в `main`.

Вручную: `docker compose run --rm migrate`.

## Заголовки, кэш и безопасность (`apps/web/nginx/`)

Что реально лежит в `dist` (проверено сборкой): `index.html`, `manifest.webmanifest`, `registerSW.js`, `sw.js`,
`workbox-<hash>.js`, `assets/*` (хешированные js/css/worker), `icons/*`, `splash/*` (26 экранов запуска iOS).

| Что | Cache-Control | Почему |
|---|---|---|
| `/assets/*` | `public, max-age=31536000, immutable` | имя = хеш содержимого |
| `/`, `index.html`, SPA-fallback | `no-cache` | ссылается на хеш-ассеты, должен обновляться сразу |
| `/sw.js`, `/registerSW.js`, `/workbox-*.js` | `no-cache` | иначе PWA зависнет на старой версии |
| `/manifest.webmanifest` | `no-cache`, `Content-Type: application/manifest+json` | mime задан явно |
| `/icons/*`, `/splash/*` | `no-cache` (ревалидация по ETag) | URL без хеша; без явного заголовка Cloudflare кэширует `.png` на несколько часов и обновлённая иконка не доезжает (урок GR-72) |
| `/health` | `no-store` | |

Отсутствующий файл в `/assets/`, `/icons/`, `/splash/` даёт 404, а не `index.html`; остальные пути — SPA-fallback.
gzip включён для js/css/json/svg/manifest.

Заголовки на ответах статики (nginx): `X-Content-Type-Options: nosniff`, `Referrer-Policy:
strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`.
Проксируемые `/api/*` и `/health` несут заголовки `helmet` из самого api (nginx их не дублирует — на эмуляции
первая версия конфига слала по два `X-Frame-Options`/`CSP`, исправлено), включая `Strict-Transport-Security:
max-age=31536000; includeSubDomains` — учти, что после первого запроса к `/api/*` браузер будет требовать HTTPS и для
поддоменов `pundoku.<домен>`. Кэш-заголовок `immutable` для `/assets/` ставится только на успешные ответы, чтобы 404 на
отсутствующий файл не закэшировался на год.

**Полный CSP намеренно не ставится.** Политику нельзя надёжно проверить без реального iOS Safari: приложение использует
inline-`style` (React), Web Worker генератора (`assets/generate.worker-*.js`), service worker, inline-стиль в `<head>`,
возможны `blob:`/`data:` изображения (PNG-шаринг — в планах). Неверная директива тихо ломает установленную PWA,
а проверить это агент не может. Поставлена только `frame-ancestors 'none'` — единственная директива, не влияющая на
загрузку ресурсов. Полный CSP — отдельный тикет с проверкой на устройстве.

Реальный IP клиента: Cloudflare кладёт его в `CF-Connecting-IP`; nginx (`real_ip_header`, доверие только приватным
адресам — порт опубликован лишь на 127.0.0.1) подставляет его как `$remote_addr` и передаёт api **единственным**
значением `X-Forwarded-For` (клиентский XFF не дописывается — его нельзя подделать). api с `TRUST_PROXY=1` (один
доверенный прыжок) видит в `req.ip` реального клиента, поэтому rate-limit (`/api/daily` 60/мин, `POST /api/devices`
10/мин) считается по человеку, а не по всем сразу. Проверено на собранном api: разные `X-Forwarded-For` — разные корзины.

## Откат

Миграции вперёд-only и обратно-совместимые (см. выше), поэтому откат кода безопасен для схемы.

1. **Быстрее всего — переразвернуть прошлый хороший коммит:** GitHub -> Actions -> Deploy (self-hosted) -> нужный
   прошлый успешный запуск -> **Re-run all jobs**. Раннер заново чекаутит тот SHA, прогоняет гейты, собирает и поднимает.
2. **Или откатить коммит в `main`:** `git revert <sha>` + push — сработает обычный автодеплой.
3. **Вручную на ноуте** (если GitHub/раннер недоступен): в папке клона `git checkout <хороший sha>`, положить `.env`
   (см. «Первый ручной запуск»), `docker compose up -d --build`.
4. **Аварийно остановить сайт:** `docker stop pundoku-web-1` (данные не тронуты; `docker start pundoku-web-1` вернёт).
   Команды `docker compose ...` требуют `.env` в папке — они интерполируют обязательные переменные; прямые `docker`
   команды по имени контейнера — нет.

Предыдущий образ отдельно не хранится: образы пересобираются из коммита, поэтому откат = сборка нужного коммита.

## Диагностика 502 и «сайт не открывается»

Начинать с проверки **на самом ноуте**, потом снаружи — так видно, на каком звене обрыв:

```powershell
curl.exe -i http://127.0.0.1:8090/health      # 1) стек жив? ожидаем 200 и {"status":"ok"}
docker ps --filter "label=com.docker.compose.project=pundoku"   # 2) какие контейнеры живы
docker logs --tail 80 pundoku-api-1           # 3) причина падения api
curl.exe -i https://<PUBLIC_ORIGIN>/health    # 4) то же через Cloudflare
```

- **1) даёт 200, а через Cloudflare 502/530/1033** — проблема в туннеле: служба `cloudflared` остановлена/не в сети,
  либо в Public Hostname неверный URL (должно быть `http://localhost:8090`, не `https`, не другой порт).
- **1) не отвечает вовсе** — `web` не запущен: Docker Desktop не стартовал (после перезагрузки ноута), контейнер
  упал (`docker logs pundoku-web-1`; частая причина — опечатка в `default.conf`), либо ноут спал.
- **1) даёт 502 от nginx (страница «502 Bad Gateway» на `/health` и `/api/*`), а `/` открывается** — не работает
  `api`: смотреть `docker logs pundoku-api-1`. Типичные причины: `Ошибка конфигурации` (секрет `RECOVERY_KEY_HMAC_SECRET`
  не задан/короче 32 байт -> api в рестарт-цикле), БД недоступна (auth failed после смены `POSTGRES_PASSWORD`,
  см. «Смена секретов»), упавшая миграция (`docker compose logs migrate`).
- **Деплой красный на `docker compose up`** — почти всегда миграция: `docker compose logs migrate`; api старой версии
  при этом остаётся работать.
- **429 на ровном месте у всех сразу** — rate-limit считает по IP: значит api видит один адрес для всех. Проверить, что
  `TRUST_PROXY=1` в окружении api (`docker exec pundoku-api-1 printenv TRUST_PROXY`) и что запросы идут через web-nginx.

## Установка на iPhone и что проверять

**HTTPS обязателен**: service worker (офлайн, установка) работает только в secure context; по `http://` PWA не
установится как полноценное приложение. Cloudflare Tunnel даёт настоящий сертификат — дополнительно ничего не нужно.

1. Убедиться, что деплой зелёный, а `https://<PUBLIC_ORIGIN>/health` отвечает 200.
2. На iPhone открыть адрес в **Safari** (не в встроенном браузере мессенджера) -> Поделиться -> **На экран «Домой»**.
   Запускать иконку с домашнего экрана — это и есть PWA (`display: standalone`).
3. Проверить: запускается без адресной строки; экран запуска не светлая вспышка в тёмной теме (`apple-touch-startup-image`);
   работает без сети (включить авиарежим после первого запуска — сетка дня из кэша/фолбэка, ходы сохраняются); после
   возврата в сеть синхронизируется; ключ восстановления создаётся и вводится на втором устройстве. Полный
   iPhone-чек-лист — в `STATUS.md` / у владельца.
4. **Обновление после нового деплоя:** service worker (`autoUpdate`) подтягивает новую версию сам, при следующем
   запуске (иногда со второго). Экраны запуска iOS кэширует **при установке** — если менялись `splash/*` или иконки,
   удалить иконку с домашнего экрана и добавить заново.
5. Если после деплоя видна старая версия — принудительно закрыть приложение (свайп из переключателя) и открыть снова;
   `sw.js` отдаётся с `no-cache`, так что обновление должно доехать без чистки кэша.

## Бэкапы

Минимум, сделанный в этом тикете:

**Ручной дамп** (на ноуте, PowerShell; `docker exec` работает без `.env`):
```powershell
docker exec pundoku-postgres-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" --no-owner --no-privileges -f /tmp/pd.sql "$POSTGRES_DB"'
docker cp pundoku-postgres-1:/tmp/pd.sql .\pundoku-$(Get-Date -Format yyyyMMdd).sql
docker exec pundoku-postgres-1 rm -f /tmp/pd.sql
```
(Именно `-f` + `docker cp`, а не `> file`: в Windows PowerShell 5.1 перенаправление вывода портит кодировку/переводы строк.)

**Восстановление** (данные потеряны, дамп в `.\pundoku.sql`): `docker stop pundoku-api-1`, затем
```powershell
docker cp .\pundoku.sql pundoku-postgres-1:/tmp/restore.sql
docker exec pundoku-postgres-1 sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && PGPASSWORD="$POSTGRES_PASSWORD" createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -f /tmp/restore.sql'
docker start pundoku-api-1
```
Дамп разворачивать `psql` той же или более новой минорной версии, что `pg_dump` (образ `postgres:16-alpine` на обоих концах).

**Ночной бэкап** `.github/workflows/backup.yml` (03:47 UTC + ручной запуск): `pg_dump` из работающего контейнера ->
gzip -> **проверка, что дамп разворачивается** в одноразовом `postgres:16-alpine` (схема на месте, `schema_migrations`
непуста, есть маркер завершения дампа) -> артефакт GitHub Actions на 14 дней (Actions -> запуск -> Artifacts;
физически вне ноута). Это упрощённая версия SUMMON-овского workflow: **нет** локальной копии/ротации на диске ноута,
нет сверки числа строк «прод vs восстановленное» и нет побайтовой сверки данных (`restore-completeness-check`).
Расписание срабатывает, только если ноут включён и раннер онлайн; пропущенный запуск GitHub не ставит в очередь.

**Статус данных:** реального восстановления с прод-бэкапа на Windows-раннере никто не проводил (ни workflow, ни
ручные команды выше не запускались). **До первого проверенного восстановления считать prod-данные тестовыми — реальных
пользователей нет.** Полноценные бэкапы (локальная копия и ротация, сверка данных, раннбук восстановления по образцу
SUMMON `DEPLOY.md`) — отдельный тикет перед появлением реальных пользователей.

## Не проверено (нет Docker и Windows-раннера на машине разработки)

Честный список: всё ниже написано по образцу SUMMON и документации, но **ни разу не выполнялось**.

- **Сборка образов** `apps/web/Dockerfile` и `apps/api/Dockerfile` в Docker. Проверено вместо этого: те же команды
  (`pnpm install --frozen-lockfile --filter ...`, `pnpm --filter ... build`, `pnpm --filter @pundoku/api --prod deploy
  --legacy`) в изолированной папке, куда скопированы только файлы, которые копирует Dockerfile — сборка и prod-копия api
  получаются. Не проверено: сам `corepack enable` + pnpm 12 на `node:20-alpine`, теги `node:20-alpine`/`nginx:1.27-alpine`.
- **`docker compose`**: валидность YAML проверена парсером, но не `docker compose config`; поведение
  `depends_on: service_completed_successfully` для `migrate`, `name:` верхнего уровня и `:?`-обязательных переменных
  рассчитано на Docker Compose v2 (Docker Desktop его содержит) — на практике не запускалось.
- **`deploy.yml` / `backup.yml` на реальном раннере**: YAML валиден, кириллицы в `run:` нет, но PowerShell-код (в
  первую очередь запись `.env`, цикл smoke на `curl.exe`, `docker ps --filter label=...`, GZipStream) на Windows не
  запускался. Синтаксис Actions проверен только парсером YAML, `actionlint` недоступен.
- **Cloudflare Tunnel** и HTTPS-доступ снаружи; поведение `CF-Connecting-IP` через туннель (реальный IP клиента для
  rate-limit); откуда именно приходит соединение от `cloudflared` в контейнер `web` (адрес шлюза Docker Desktop,
  ожидаем приватный диапазон — он в `set_real_ip_from`).
- **iPhone**: установка PWA, service worker по HTTPS, экраны запуска, офлайн — агент проверить не может.
- **Бэкап**: workflow и восстановление (см. выше).

## Что проверено локально (без Docker)

- `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (engine 127, api 174 +3
  skipped против реального Postgres после миграций, web 478) — зелёные.
- **nginx 1.31 (brew) с реальным `default.conf`** (подставлены только порт, путь к `dist` и адрес api `127.0.0.1:3560`
  вместо `api:3000` + `resolver` Docker): `nginx -t` ok; `/health` и `/api/daily/<дата>` проксируются в собранный api;
  SPA-fallback на `/nope/deep/link` -> `index.html` 200; `/assets/nope.js` -> 404; заголовки Cache-Control по таблице выше;
  `Content-Type: application/manifest+json` у манифеста; gzip на js; повторные запросы
  с разными `CF-Connecting-IP` -> rate-limit `POST /api/devices` считается по клиенту (10 x 201, затем 429, другой
  клиент 201), клиентский `X-Forwarded-For` игнорируется.
- Собранный api с `NODE_ENV=production`: без `RECOVERY_KEY_HMAC_SECRET` и с секретом короче 32 байт — exit 1 с
  понятным сообщением; миграции 0001-0006 накатываются без секрета и идемпотентны.
- Осталось непроверенным именно в конфиге nginx: `resolver 127.0.0.11` (адрес Docker-DNS) и `http://api:3000` по имени
  сервиса — работают только внутри сети compose.
