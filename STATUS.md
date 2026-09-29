# Pundoku — статус

Создан: 2026-09-29. Доска задач — источник правды между сессиями. Контекст и решения владельца —
`products/pundoku/CLAUDE.md` и `reports/sudoku-pwa-research/07-concept-draft.md`.

## Чек-пойнт 2026-09-29 (конец первой волны релиза 1)

**Сделано и смержено в `main` (репо `products/pundoku/`, HEAD `4c58fe7`):**
- PD-0 скаффолд: pnpm-монорепо `apps/web` (Vite+React PWA-каркас, i18n en/uk/ru, без UI экранов),
  `apps/api` (Express 5 + pg, собственный SQL-раннер миграций), `packages/engine` (MIT).
- PD-2 движок (`@pundoku/engine`, 0 зависимостей, без GPL/sudoku-core): `solve/countSolutions/
  hasUniqueSolution`, human-решатель с логом техник (naked/hidden single, locked candidates
  pointing+claiming, naked/hidden pair), `techniqueForCell`, `rateDifficulty` (+`'beyond'`),
  `generate({difficulty, seed})` детерминированный (xoshiro128**), `dailySeed/dailyPuzzle`, `MoveLog`
  + `heatmap/summary/solvingStyle`. QA PD-5: PASS (66/66, единственность 400/400 независимо,
  классификация 100 %, техники 176/176, детерминизм в двух процессах).
- PD-3 бэкенд: `GET /api/daily/:date` (без `solution`; 400 invalid/future, 404 `not_available_yet`
  для «завтра»), `POST /api/daily/:date/verify`, `POST /api/devices` (`deviceToken`, в БД только
  sha256), `GET/PUT /api/snapshot` (401/409/413), rate-limit 60/мин, кэш сеток в `daily_puzzles`.
  QA PD-6: PASS (46 тестов live на Homebrew Postgres 16, гонка 409 корректна, mission = Sudoku.com
  побайтно).
- После мержа на `main`: `pnpm typecheck/build` зелёные, engine 66/66, api 39 passed + 7 skipped
  (live/DB без env). **Фолбэк проверен вживую с реальным движком:** api с мёртвым upstream
  (`SUDOKU_COM_BASE_URL=http://127.0.0.1:1`) на дату 2026-09-15 → `source: "generator"`,
  `difficulty: "hard"`, 0.55 с, второй запрос из кэша с той же `mission`, `verify` с сохранённым
  решением → `correct: true`. **Найдено расхождение:** api вызывает `generate({difficulty, seed:
  date})`, а движок для «сетки дня» предлагает `dailyPuzzle(date, difficulty)` с другим составом
  seed — сетки разные (`8096…` vs `0000…`). Офлайн-клиент, считающий фолбэк сам, не совпадёт с
  сервером → PD-8(j). (Строка 2026-09-15/generator осталась в QA-БД `pundoku_qa`;
  `dropdb pundoku_qa`, когда не нужна.)
- PD-1 → PD-7: **макет поля v2 утверждён владельцем** (см. ниже). Файлы в `design/`.

**Решения владельца по макету (2026-09-29, PD-7):** поле **B Boxes**; чернила **индиго #3B48B0**
(тёмная #8C96FF); панель 1–9 **один ряд с остатками** (сколько раз цифра ещё не поставлена); в зазор
между полем и панелью — строка статуса «N cells left»; таймер **тихо в подписи дня**; заливки
соседей (ряд/колонка/блок) **выключены**, «та же цифра» — чернила 10 %, выбор — 16 % + кольцо;
**3 вкладки** Today · Play · Year. Веса: givens New York Semibold, цифры игрока SF Medium.
Спецификация движения M1–M6 с reduced-motion фолбэками, проход 2 и low-замечания — в конце
`design/pd7-board-critique.md`. Референс — `design/pd7-board-variants.html` (вариант B) и PNG
`design/pd7-shots/B-light.png`, `B-dark.png`.

**Следующий шаг (новый PM, новый чат Coordinator'а) — UI релиза 1 по утверждённому макету:**
1. App shell + таб-бар 3 вкладки (стекло с фолбэками), Appearance по системе, safe areas, 100dvh.
2. Компонент поля B (givens `ui-serif` Semibold / игрок `system-ui` Medium, заливки 10 %/16 % + кольцо,
   движение M1/M2/M3/M6 с фолбэками) + панель 1–9 один ряд с остатками + notes/undo/erase + строка
   «N cells left». Low-замечания прохода 2 включить в бриф: кольцо выбора радиус 4 в B; остатки в
   двухрядной раскладке не нужны (выбран один ряд); паддинг под Share в состоянии «решено».
3. Экран Today: `GET /api/daily`, таймер в подписи дня, карточка дня (heatmap/summary/technique из
   `MoveLog`, win_rate только после решения), M5 «улёт» последней клетки в Grid ∞, постоянная сетка.
4. Клиентское правило замены генераторной сетки (см. решение PM ниже) — в тикете Today.
5. Устройство/снапшот: `POST /api/devices` при первом запуске, `PUT/GET /api/snapshot`, IndexedDB
   локально; сервер — источник правды для постоянной сетки и года.
Перед UI-тикетом поля/Today закрыть PD-8(a) — контракт `undo` в `MoveLog` (см. ниже).

## Риски / решения уровня продукта
- Task List харнесса PM недоступен — тикеты ведутся в fallback-таблице ниже. У PM в этой сессии не
  было `SendMessage` — связь со специалистами только через спавн/файлы.
- На машине нет Docker: Dockerfile/compose написаны, но не запускались; Node 24 вместо 20 из `.nvmrc`.
  Живой стенд — Homebrew Postgres 16 (`pundoku_dev`, QA — `pundoku_qa`).
- Sudoku.com — чужой контент (ToS Easybrain), может закрыться; всегда через адаптер с фолбэком.
  Отдаёт и «завтра»; даты > today+1 → 204.
- **Калибровка сложности (PD-5, существенно):** все 5 дневных сеток Sudoku.com (включая три
  «hard») решаются одними singles — движковый `easy` (38 подсказок) ≈ Sudoku.com `hard` (30).
  Следствие: на Today «Technique reached» почти всегда single, `rateDifficulty` покажет easy при
  ярлыке hard. **Решение PM (2026-09-29):** на Today показывать ярлык источника (Sudoku.com) и
  честную технику; для Play ввести вторую ось — число подсказок: easy 38/singles, medium 30/singles,
  hard 26/locked, expert 24/pairs, master beyond — тикет PD-9 (снапшоты seed обновить).
- **Решение PM (фолбэк на «сегодня»):** генераторная сетка кэшируется, но не навсегда — при
  следующем запросе сервер перезапрашивает Sudoku.com и заменяет сетку (`source` → `sudoku.com`,
  `replaced_at`); клиент, уже начавший генераторную сетку, сравнивает `mission` со своей и доигрывает
  свою. Сервер — PD-8, клиент — в тикете Today.
- Движок: X-Wing+ нет (верх expert не контролируется); любое изменение генератора меняет все
  seed-сетки — версионировать алгоритм при изменениях.
- Ветки `pd-2`, `pd-3` смержены; worktree'ы `products/pundoku-worktrees/pd-2`, `pd-3` можно удалить
  (`git worktree remove`), незакоммиченного там нет.

## Замечания QA PD-16 (app shell, eae5fa2 — смержен в main)
- (низкая) forced-colors: выбранную вкладку отличает только жирность подписи — добавить рамку/подчёркивание под `@media (forced-colors: active)`; сделать в PD-11 или полировке.
- (низкая, осознанно) в reduced motion остался кроссфейд цвета вкладки 0.12 s — как в макете, только смена цвета; если владелец хочет строгий ноль — вернуть глобальное правило.
- (для владельца) возможная светлая вспышка при запуске PWA в тёмной теме: manifest `background_color`/`theme_color` только светлые. Проверяется на iPhone (шаг 5); лечение — `apple-touch-startup-image`, задел в PD-19.
- (HIG, макет утверждён) иконки таб-бара только контурные, бар прилегает к низу, а не плавает — не менять без решения владельца.

## Проверки для владельца на iPhone 16 (установленная PWA) — когда будет готов Today, не сейчас
1. Safari → «Поделиться» → «На экран Домой», открыть иконку: запуск без адресной строки, иконка/название верны.
2. Светлая тема: таб-бар прилегает к низу, подписи не залезают под индикатор Home; Today индиго с бледной подложкой.
3. Стекло: оценить цвет/просвечивание бара, когда появятся прокручиваемые экраны.
4. Тёмная тема (Экран и яркость → Тёмное): фон чёрный, бар тёмно-серый, вкладка #8C96FF, статус-бар под часами в цвет фона.
5. Перезапуск PWA из тёмной темы: нет ли светлой вспышки в первую секунду.
6. Тап по вкладкам без задержки 300 мс; двойной тап не масштабирует.
7. Потянуть экран вверх/вниз: нет «пружины», таб-бар не сдвигается.
8. Повернуть телефон: зафиксировать поведение, бар не уезжает под вырез/индикатор.
9. Размер текста на максимум: подписи вкладок остаются мелкими, заголовок растёт.
10. Уменьшение прозрачности / Увеличение контраста: бар непрозрачный, тексты темнее.
11. Язык iPhone Українська / Русский: подписи переводятся, без обрезки.
12. Режим полёта + перезапуск PWA: открывается офлайн.
Дополнительно по QA PD-23/PD-17 (Play):
13. VoiceOver: «N cells left» объявляется только на порогах (кратно 10 и последние 5), не на каждую цифру; после решения не остаётся «1 cell left».
14. Ряд кнопок Notes/Undo/Erase на узком экране (SE / крупный текст) в uk и ru: одной высоты, подписи без обрезки.
15. Выбор неверной клетки: видны и индиго-кольцо, и сургучное (светлая/тёмная тема).
16. Ввод пальцем: попадание по клеткам и клавишам панели (36–41 pt на 390–430 pt — вопрос владельцу (а)), заметки, undo, таймер при сворачивании PWA, ощущение движений M1/M2/M3/M6, размер текста.
Не проверено QA: реальное стекло iOS, `env(safe-area-inset-*)`, статус-бар в тёмной теме, установка, reduced-transparency/contrast в webkit.

## Backlog по QA PD-17 (не чиним сейчас)
- 320×568 (iPhone SE 1-го поколения) скролл на 6–10 px — не целевое устройство.
- Заметки 7-8-9 касаются нижней линии клетки на 320pt — проверить на устройстве.
- Провизорный select сложности 36pt < 44pt — заменить при утверждении формы в PD-12.
- forced-colors: границы блоков (не iOS).
- Решение PM: провизорный выбор сложности показывает все 5 уровней движка (easy/medium/hard/expert/master) после PD-9; в i18n en/uk/ru добавить `master`.

## Ожидает решения владельца
- Year (PD-24): 4 вопроса в `design/pd24-year-notes.md` §5 — раскладка (рекомендация C Blocks), исправления цветом vs тихо, признак «решено с помощью» (рекомендация: нет), доигрывание пропущенных дней. Кадры: `design/pd24-shots/`, макет `design/pd24-year-variants.html`. Реализацию Year не начинаем до ответа.
- (а) Клавиши панели 28–41 pt по ширине (36–41 pt на 390–430) при HIG-минимуме 44 pt — подтвердить размер после проверки на устройстве (iPhone 16, 390 pt).
- (б) Подсвечивать ли конфликты (одинаковая цифра в ряду/колонке/блоке) до решения, или только сверка с решением (сейчас ошибка видна, только если цифра ≠ решению). Рекомендация PM: только сверка с решением (без «подсказок» о конфликтах), как сейчас — чище для ежедневной сетки; но владелец решает.

## Тикеты (fallback-трекер)
| ID | Тикет | Owner | Priority | Status | BlockedBy |
|----|-------|-------|----------|--------|-----------|
| PD-0 | Скаффолд монорепо + первый коммит (1a4d42d) | developer | P1 | completed | — |
| PD-1 | HTML-макет экрана Today v1 (866cff5) — владельцем не утверждён, заменён PD-7 | designer | P1 | completed | — |
| PD-2 | Движок судоку (`pd-2` @ 82e3c46, смержен 0460107) | developer | P1 | completed | PD-0 |
| PD-3 | Бэкенд: прокси Sudoku.com + анонимный аккаунт и снапшот (`pd-3` @ cec97d0, смержен 4c58fe7) | developer | P1 | completed | PD-0 |
| PD-4 | QA PD-1: Playwright, PASS, 5 minor → чек-лист в критике PD-7 | qa-tester | P1 | completed | PD-1 |
| PD-5 | QA PD-2: PASS с оговорками, 4 minor → PD-8 | qa-tester | P1 | completed | PD-2 |
| PD-6 | QA PD-3: PASS с оговорками, 4 minor → PD-8 | qa-tester | P1 | completed | PD-3 |
| PD-7 | Макет v2 поля A/B/C (15b5a24) — утверждён владельцем: B Boxes | designer | P1 | completed | — |
| PD-8 | Полировка по QA PD-5/PD-6 (бриф ниже; смержен в main, 3c02fab) | developer | P1 | completed | — |
| PD-9 | Play: вторая ось сложности — число подсказок (бриф ниже) + п.0 low-замечания QA PD-15 (смержен в main, b3643f0) | developer | P2 | completed | — |
| PD-10 | UI 1: app shell + таб-бар 3 вкладки (стекло с фолбэками), токены v2 в CSS, тема по системе, safe areas, 100dvh, заглушки Today/Play/Year (смержен в main, eae5fa2) | developer | P1 | completed | — |
| PD-11 | UI 2: компонент поля B + панель 1–9 с остатками + notes/undo/erase + «N cells left» + движение M1/M2/M3/M6 (Play-экран, локальная игра на движке); смержен в main (QA PD-17 + регресс PD-23 PASS) | developer | P1 | completed | — |
| PD-24 | Дизайн: варианты экрана Year (полотно года) + вопрос владельцу — HTML-макет в `design/`, скилл apple-design; НЕ реализация — смержен в main (8aea006): варианты A Ruled-rows/B/C Blocks, 15 кадров, заметка; ждёт выбора владельца | designer | P1 | completed | — |
| PD-12 | UI 3: экран Today — `GET /api/daily/:date`, подпись дня с таймером, карточка дня (heatmap/summary/technique, win_rate после решения), M5, постоянная сетка. Из PD-8: клиентский фолбэк-грид ТОЛЬКО через `dailyPuzzle(date, difficulty)` с difficulty из ответа api; при возврате в сеть сверять сетку по `source`/`mission` (сетка могла смениться generator→sudoku.com, пока игрок не решил) + два Low из QA PD-23 (см. ниже); реализация по утверждённому макету (Today solved: карточка дня, Grid ∞); ветка `pd-12` | developer | P1 | in_progress | — |
| PD-13 | UI 4: клиентское правило замены генераторной сетки (сравнение `mission`, доигрывание своей) | developer | P1 | pending | PD-12 |
| PD-14 | UI 5: устройство/снапшот — `POST /api/devices`, `PUT/GET /api/snapshot`, IndexedDB, сервер — правда для постоянной сетки/года | developer | P1 | pending | PD-12 |
| PD-15 | QA PD-8: PASS с оговорками (seed-сетки побайтово те же, undo, api live; 2 low → PD-9/п.0) | qa-tester | P1 | completed | PD-8 |
| PD-16 | QA PD-10 (eae5fa2): Playwright chromium+webkit, реальная сборка, apple-design как ревьюер | qa-tester | P1 | completed | PD-10 |
| PD-17 | QA PD-11 (0e87330): PASS с оговорками, блокеров нет; 6 находок чинятся до мержа (Medium — дубликаты `.wv` после M3), остальное в backlog ниже | qa-tester | P1 | completed | PD-11 |
| PD-18 | QA PD-12 | qa-tester | P1 | pending | PD-12 |
| PD-19 | QA PD-13 | qa-tester | P1 | pending | PD-13 |
| PD-21 | QA PD-9 (b3643f0): PASS с оговорками, 400 новых сеток, easy побайтово равен cf788ce; low → PD-22 | qa-tester | P2 | completed | PD-9 |
| PD-22 | Low-полировка по QA PD-21 (engine/api, без спешки): (а) `generate({difficulty:'constructor'/'toString'})` → RangeError с неверным текстом — `Object.hasOwn`; (б) валидация `maxAttempts` (0, -1, NaN, 1.5) и `clues:null`; (в) README: clues ≈17 практически недостижимо; (г) допустимые `DAILY_FALLBACK_DIFFICULTY` в `apps/api/src/config/env.ts` из `DIFFICULTIES`, ошибка при старте без стека; (д) README engine: у v1 easy было ровно 38, не «≤38»; (е) heavy-тест ~160 с при таймауте 180 с — поднять/разнести | developer | P3 | pending | — |
| PD-23 | QA-регресс PD-11 (8c4d3e6): PASS, блокеров и Medium нет, 5 уровней без сырых ключей, Worker не подвешивает UI | qa-tester | P1 | completed | PD-11 |
| PD-20 | QA PD-14 | qa-tester | P1 | pending | PD-14 |

### Бриф PD-8 (developer, P1 — пункт (a) блокирует UI-тикеты поля/Today)
Движок: (a) зафиксировать и реализовать контракт `undo` в `MoveLog` — undo после `erase` не должен
давать heatmap `null` и +1 correction; undo после `note_add` не должен ломать `clean`; описать в
README и покрыть тестами; (b) `dailySeed` валидирует дату (`'2026-13-45'` → ошибка); (c) README —
все экспорты `src/index.ts`; (d) README про попытки/время генерации по факту (hard median 8
попыток, max 30).
API: (e) `updatedAt` в `PUT /api/snapshot` — строгий ISO (`"1"` → 400); (f) `src/test/**` не
попадает в `dist`; (g) отказ источника без генератора → `503 daily_unavailable` + info-лог факта
upstream-запроса; (h) `migrate.ts:62` — `pathToFileURL` (каталог с пробелом); (i) перезапрос
Sudoku.com для строк `source='generator'` при следующем запросе на дату и замена сетки (`source`,
`replaced_at`), тест; (j) единая seed-конвенция сетки дня: api использует `dailyPuzzle(date,
difficulty)` движка (или `dailySeed`), не сырой `seed: date`, — чтобы офлайн-клиент воспроизводил
ту же фолбэк-сетку, что сервер; зафиксировать в README обоих пакетов и тестом. Живой QA до закрытия.

### Бриф PD-9 (developer, P2)
`generate` принимает целевое число подсказок как вторую ось: easy 38/singles, medium 30/singles,
hard 26/locked candidates, expert 24/pairs, master — beyond. `rateDifficulty` учитывает обе оси;
`DAILY_FALLBACK_DIFFICULTY` по умолчанию → профиль, близкий к Sudoku.com hard (30/singles).
Обновить снапшоты seed (все сетки изменятся — версия алгоритма в README), heavy-тест по классам.

## Задача для тикета деплоя / PD-14 (находка developer PD-9)
Строки `daily_puzzles` с `source='generator'` хранят фолбэк-сетку версии алгоритма, под которой они сгенерированы. При обновлении `GENERATOR_VERSION` (v1 → v2 в PD-9) такие строки на живых стендах устаревают: либо чистить `source='generator'` при обновлении версии, либо хранить версию алгоритма в строке (колонка `generator_version`) и игнорировать несовпадающие. Прода у Pundoku пока нет; на dev/qa стендах — `DELETE FROM daily_puzzles WHERE source='generator'`.

## Калибровка сложности — закрыто (PD-9, b3643f0, смержен в main 52a0be8; QA PD-21 PASS с оговорками)
Профили `DIFFICULTY_PROFILES`: easy 38/singles, medium 30/singles, hard 26/locked, expert 24/pairs, master 24/beyond; `GENERATOR_VERSION=2`; фолбэк Today по умолчанию medium (≈ Sudoku.com hard). Замеры QA под нагрузкой: p95 expert 773 мс, master 59 мс; хвост expert до 202 попыток из потолка 300. Пункт 0 (typecheck без build, realpath в migrate) закрыт там же.
- **Стенд:** в `pundoku_qa` остались 144 строки `daily_puzzles` (138 generator, версия v1) — DELETE был заблокирован классификатором, не обходил. Лучше пересоздать: `dropdb pundoku_qa && createdb pundoku_qa` + миграции (`pnpm migrate`), либо владелец разрешит DELETE.

## Low из QA PD-23 (берёт PD-12)
1. При возврате на Play с Today заново проигрываются стухшие M1 (inkSet) и M3 (unitWave): `pop`/`wave` остаются в снапшоте стора, PlayScreen монтируется заново — сбрасывать при размонтировании/после проигрыша.
2. В sr-only live-регионе после решения остаётся «1 cell left»; порог debounce 600 мс.

## Замечания QA PD-15 (PD-8, смержен)
- low/medium: в чистом клоне `typecheck` до `build` падает (api-тест импортирует собранный `@pundoku/engine`) — порядок `build → typecheck` или references; в PD-9 п.0.
- low: `migrate.ts` `isDirectRun` сравнивает `import.meta.url` с `argv[1]` без realpath — запуск через симлинк молча выходит с 0; в PD-9 п.0.
- косметика: heavy-тесты движка ~75 с (README обещает 20–30); RFC3339 со строчными t/z → 400 — упомянуть в README API.
- не проверено: живой Sudoku.com (`LIVE_SUDOKU_COM=1`), фолбэк 29.02.2028 через HTTP (даты дальше «завтра» → 400), тесты `apps/web`.

## Агенты (текущий статус)
| Имя | Роль | Статус | Тикет | Обновлено |
|-----|------|--------|-------|-----------|
| PM-Pundoku | product-manager | waiting | PD-12 | 2026-09-29 09:00 |
| Dev-PD9 | developer | working | PD-9 | 2026-09-29 09:25 |
| Dev-PD12 | developer | working | PD-12 | 2026-09-29 12:10 |
