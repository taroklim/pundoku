# PD-27 — привязка e-mail к анонимному аккаунту (ADR, план)

Решение владельца (2026-09-30): в настройках, без регистрации, без паролей, игра работает без входа.
Необязательный блок «Сохранить прогресс по e-mail»: вводишь адрес → письмо → на новом устройстве
тот же путь → прогресс подтягивается (слияние по правилам PD-14/PD-31).

## Ключевое отступление от «magic link» (обосновано)
На iOS установленная PWA и Safari имеют **раздельное** хранилище (IndexedDB, токен устройства).
Ссылка из письма открывается в Safari, а не в PWA, — «войти по ссылке» привязало бы не то устройство.
Поэтому основной механизм — **одноразовый код** (8 цифр) из письма, который вводится в Settings
той же PWA. Ссылка в письме допустима как удобство (`PUBLIC_WEB_URL/#/settings?code=…` подставляет
код в поле, подтверждение — кнопкой), но не как самостоятельный способ входа. Челлендж привязан к
устройству, запросившему письмо, поэтому ссылка, открытая в другом браузере, не сработает — и это
нормально (ожидаемое поведение нужно объяснить в UI текстом).

## Модель данных (миграция `0006_accounts.sql`)
Токен устройства НЕ подменяется: у каждого устройства остаётся свой `deviceToken`. Меняется только
то, чей снапшот читает/пишет устройство.
- `accounts(id uuid pk, email_hmac bytea unique not null, email_hint text not null,
  snapshot_device_id uuid not null references devices(id), created_at timestamptz)` — e-mail
  хранится **только как HMAC-SHA256 с серверным ключом** (`EMAIL_HMAC_KEY`, нормализация: trim,
  lowercase, NFKC) + маска для показа (`j***@gmail.com`). Открытого адреса в БД нет.
- `device_links(device_id uuid pk references devices(id) on delete cascade,
  account_id uuid not null references accounts(id) on delete cascade, linked_at)`.
- `login_challenges(id uuid pk, device_id uuid not null references devices(id) on delete cascade,
  email_hmac bytea not null, code_hash bytea not null, expires_at, attempts int default 0,
  consumed_at null, created_at)`. `code_hash` = HMAC(код) тем же ключом; сам код в БД не хранится.
- Снапшот аккаунта остаётся в `snapshots` под `accounts.snapshot_device_id`. Резолв в `requireDevice`:
  `snapshotOwnerId = device_links → accounts.snapshot_device_id, иначе device.id`. Репозиторий
  снапшота получает `snapshotOwnerId`; вся логика `upsertIfNewer`/409 остаётся без изменений.
- Чистка: просроченные/погашенные challenges удаляются при каждом request (не массовый DELETE по
  расписанию — обычный `DELETE ... WHERE expires_at < now()` в репозитории допустим в коде приложения;
  тестам — свежая БД).

## Единый флоу «request → verify» (одинаков для привязки и для входа на новом устройстве)
Все эндпоинты под `requireDevice` (Bearer токен устройства).
- `POST /api/account/email/request` `{email, locale}` → **всегда `202 {sent:true}`** при валидном
  формате (ответ не раскрывает, есть ли такой аккаунт); 400 при кривом e-mail; 429 при лимитах.
  Предыдущие незакрытые challenges этого device+email гасятся. Письмо на языке `locale` (en/uk/ru).
- `POST /api/account/email/verify` `{email, code}` → 200 `{linked:true, emailHint, created:boolean}`.
  Если аккаунта для `email_hmac` нет — создаётся, `snapshot_device_id` = это устройство (его снапшот
  становится снапшотом аккаунта). Если есть — устройство линкуется к нему (собственный снапшот
  устройства остаётся сиротой, не удаляется). 400 `invalid_or_expired` для всех неуспехов (неверный
  код, истёк, погашен, чужое устройство) — без различий. Код одноразовый, TTL 15 мин, максимум 5
  попыток на challenge (после — challenge мёртв).
- `GET /api/account` → `{linked:false}` или `{linked:true, emailHint, devices:n}`.
- `DELETE /api/account` → «отвязать это устройство»: удаляет `device_links` этого устройства; если
  это владелец снапшота и есть другие связанные устройства — снапшот переезжает (`UPDATE snapshots
  SET device_id`, `accounts.snapshot_device_id`) на другое связанное устройство; если связанных нет —
  удаляется аккаунт целиком (e-mail-хеш стирается). Локальные данные устройства не трогаются.
- `DELETE /api/account?all=1` → **удалить e-mail и разорвать все связи**: аккаунт и все `device_links`
  удаляются, e-mail-хеш стирается; снапшот остаётся у устройства-владельца (в нём нет
  персональных данных, только ходы судоку). Для приватности этого достаточно.

## Безопасность
- Коды/токены одноразовые, TTL 15 мин, хеш (HMAC) в БД, сравнение constant-time.
- Rate-limit: по IP (существующий in-memory механизм; request — 10/час, verify — 30/час),
  по устройству (request — 5/час, считать по `login_challenges`), по e-mail-HMAC (request — 5/час,
  чтобы не заспамить чужой ящик; при превышении — тот же 202 без отправки, без утечки факта лимита
  по e-mail; 429 только по IP/устройству).
- Ответы не различают «e-mail известен / неизвестен».
- **Не логируем**: e-mail, код, ссылку, токены. `pino` `redact` расширить (тело запроса
  `email`, `code`, `authorization`); в логи писать только `emailHmacPrefix` (первые 6 hex) и
  `challengeId` — чтобы можно было расследовать без PII. Письма в dev-транспорте логировать нельзя
  в общий лог — писать в файл (см. ниже).
- Конфиг: `EMAIL_HMAC_KEY` (обязателен вне dev, ≥32 байта, ConfigError), `PUBLIC_WEB_URL`,
  `MAIL_TRANSPORT=file|smtp` (`file` — только вне production), `MAIL_FROM`.

## Почтовый транспорт
Интерфейс `MailTransport { send({to, subject, text, html?}) }`. Реализации: `FileMailTransport`
(dev/тесты — пишет `.eml`-подобные файлы в `MAIL_DEV_DIR`, по умолчанию `apps/api/.dev-mail/`, в
`.gitignore`), `SmtpMailTransport` — **не реализуется в PD-27** (заглушка, кидает
`NotConfigured`), пока владелец не выберет провайдера. Тексты писем en/uk/ru, plain text + минимальный
html, без трекинга.

## Web
- Маршрут `#/settings` + шестерёнка в шапке Today (таб-бар остаётся 3 вкладки). В Settings уже есть
  язык — переносится/остаётся там же.
- Блок «Сохранить прогресс по e-mail», состояния: не привязан → форма e-mail → «код отправлен»
  (поле кода, «отправить ещё раз» с паузой, текст про то, что письмо может прийти в спам и что ссылку
  на iPhone лучше не открывать — вводить код) → привязан (маска e-mail, «устройств: n», кнопки
  «Отвязать это устройство», «Удалить e-mail и разорвать все связи»).
- После успешного verify: `SyncManager.resetAfterAccountChange()` — сбросить `META_SYNC_STATE`,
  `pulled=false`, `syncNow(true)`: `integrate` при `state===null` смержит снапшот аккаунта с
  локальными днями, дальше штатный цикл/409. Токен устройства не меняется. Локальные данные не теряются.
- i18n en/uk/ru, паритет ключей проверяется тестом (как у Year).
- Дизайн: designer делает макет экрана Settings (HTML в `design/`), на утверждение владельцу не
  выносим, если макет укладывается в токены v2 и HIG (мелкая форма); иначе — вопрос через Coordinator.

## Разбиение работ
1. `pd-27-api` (developer): миграция, `requireDevice` резолв, эндпоинты, транспорт, письма, rate-limit,
   redact, тесты (интеграционные с `TEST_DATABASE_URL`), README api.
2. Designer (параллельно): макет Settings в `design/pd27-settings.html` + заметка.
3. `pd-27-web` (developer), после макета: маршрут, Settings UI, клиент API, resetAfterAccountChange,
   i18n, тесты; ветка от main, файлы не пересекаются с api.
4. Слияние → ветка/мерж, QA (живой стенд: два «устройства» = два профиля Playwright, файловый
   транспорт; слияние по PD-14/31, лимиты, гонки verify, отвязка владельца).

## Что нужно от владельца для реальной почты (не блокирует dev)
Провайдер отправки (SMTP-сервис: Resend/Postmark/SES/Mailgun или свой SMTP), домен и DNS-доступ
(SPF/DKIM/DMARC), адрес отправителя (`MAIL_FROM`), публичный URL веба (`PUBLIC_WEB_URL`), решение,
где живёт прод (сейчас прода нет). До этого — файловый транспорт.
