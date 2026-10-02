# Юзабилити-исследование конкурентов, часть A (PD-105)

Дата: 2026-10-02. Роль: marketing. Конкуренты: Sudoku.com (Easybrain), Good Sudoku (Zach Gage), NYT Games Sudoku, Apple (Games app / Apple News+ Sudoku / Apple Arcade).
Приложения не устанавливались: только страницы App Store, обзоры, справка, новости, отзывы.

## 0. Как читать файл

- **Факт** — со ссылкой. **Рекомендация** — помечена «Рек.».
- «не подтверждено» — источника нет или он вторичный и противоречивый.
- Отзывы — короткие цитаты (до 15 слов). Источник «iTunes RSS» — публичная лента отзывов App Store, (`itunes.apple.com/us/rss/customerreviews/...`); текст вытащен через WebFetch (суммаризатор), поэтому цитаты могут быть неточны в мелочах. Для решений использовать как сигнал, а не как точную цитату.
- Официальную справку NYT (help.nytimes.com) и nytimes.com открыть не удалось — WebFetch их блокирует. Всё про NYT Sudoku — из App Store и вторичных источников; надёжность ниже, чем у остальных конкурентов.
- Часть формулировок про NYT (Autocheck «красная косая», Hint «клетка с наибольшей информацией») совпадает дословно с официальной справкой Apple News (см. §4). Сторонние сайты могли смешать два продукта. Эти пункты помечены «возможно, не NYT».
- Сверка Pundoku — по `products/pundoku/CLAUDE.md`, `07-concept-draft.md`, по коду `apps/web/src/play/{logic.ts,controls.tsx,Board.tsx}` и кадрам QA `research/usability-2026-10/shots/scen/S01–S05` (смотрел S04, S05). Поведение, которого я не нашёл в коде, помечено «не найдено», это не равно «нет».
- Расхождение в исходных данных: в задании у Pundoku «5 сложностей», в `CLAUDE.md` — 4 (релиз 1). Не уточнял, сверить с PM.

### Что в Pundoku сейчас (для сверки, по коду и кадрам)

- Ввод только «клетка, потом цифра». Режима «цифра-первой» и блокировки цифры не найдено (`enterDigit(cell, digit)`, `store.input(d)`).
- Панель 1–9 в один ряд, под каждой цифрой счётчик «сколько осталось», у закрытой цифры «·». Кнопки Notes / Undo / Erase, высота ряда 46 pt (`controls.tsx`).
- Подсветка выбранной клетки и одинаковых цифр (`Board.tsx`, класс `same`). Подсветки строки/столбца/блока по выбору не нашёл.
- Заметки: переключатель Notes. Автозаметок («заполнить все кандидаты») нет. При постановке цифры заметки в соседних клетках не убираются: на кадре S05 после «6» заметка «6» в том же блоке осталась.
- Ошибки: неверная цифра сразу подсвечивается («сургуч», `isWrong` сверяет с решением), без настройки и без лимита ошибок. «N cells left» считает неверную цифру как незакрытую.
- Подсказок в релизе 1 нет (`STATUS.md`: «Подсказки-функции в релизе 1 нет», флаг `assisted` заложен в схему). «Фонарь/Глифы» — релиз 2.
- Undo без ограничения, без redo. В Чернильном режиме (1.1) undo и стирание цифр отключены, ошибка = клякса.
- Ежедневка: Today + архив + Year-полотно; отдельного счётчика стрика в `CLAUDE.md` нет.
- Монетизации нет. Аккаунта нет, вместо него ключ восстановления.
- Доступность: у панели есть `aria-label` с остатком, «N cells left» озвучивается порогами. Полный аудит делает PD-108 (B2), я его не дублирую.

---

## 1. Sudoku.com (Easybrain)

Масштаб: 1.9M оценок, 4.8 из 5, бесплатно + покупки, 263.6 MB, iOS 15+ ([App Store](https://apps.apple.com/us/app/sudoku-com-number-games/id1193508329)).

### 1.1 Онбординг и первый запуск
- Обучающий экран/тур при первом запуске: **не подтверждено** (в описании App Store и на сайте о нём ничего нет). На сайте есть статьи для новичков («3 Things Almost All Beginner Sudoku Players Get Wrong» и др.), не интерактив ([sudoku.com/how-to-play](https://sudoku.com/how-to-play/)).
- Шесть уровней: Easy, Medium, Hard, Expert, Master, Extreme ([sudoku.com](https://sudoku.com/)). Сторонний анализ: Easy/Medium/Hard технически почти неразличимы (те же приёмы, различается число клеток), реальная прогрессия начинается с Expert/Master ([SudokuPulse](https://sudokupulse.com/articles/sudoku-difficulty/); источник сторонний, у сайта свои продукты).
- Первый запуск в iOS-приложении по отзывам перегружен рекламой (см. 1.9).

### 1.2 Ввод цифр
- Модель «клетка, потом цифра» — **не подтверждено** официально; кнопки на странице: Undo, Erase, Notes, Hint ([sudoku.com](https://sudoku.com/)). Режима «цифра-первой» не нашёл.
- Размер целей — слабое место по отзывам: «Numbers so close together, constantly mistype» и «Number 1 narrow and close to edge» (пересказ отзывов, [JustUseApp](https://justuseapp.com/en/app/1193508329/sudoku-com-sudoku-puzzle/reviews); агрегатор, точность цитат не гарантирована). App Store-сводка перечисляет «small touch targets causing accidental inputs» как повторяющуюся жалобу ([App Store](https://apps.apple.com/us/app/sudoku-com-number-games/id1193508329)).
- Рекламный баннер рядом с панелью цифр вызывает случайные нажатия (тот же агрегатор, отзыв 2021 года).
- Подсветка дубликатов цифр в строке/столбце/блоке — есть ([Easybrain](https://easybrain.com/sudoku)).
- Свежие отзывы (RSS, 2026-09-25…28): после обновления использованная цифра на панели получает галочку вместо исчезновения — «Looks like I still have numbers left now»; другой: «Why do my used numbers get a check mark instead of just disappearing». Это пример негативной реакции на смену индикатора «цифра закончилась» ([iTunes RSS, стр. 2](https://itunes.apple.com/us/rss/customerreviews/page=2/id=1193508329/sortby=mostrecent/json)).

### 1.3 Заметки/кандидаты
- Есть режим Notes; по описанию Google Play заметки обновляются автоматически, когда игрок ставит цифру («Each time you fill in a cell... your notes are automatically updated») — это фрагмент из выдачи поиска по странице [Google Play](https://play.google.com/store/apps/details?id=com.easybrain.sudoku.android&hl=en_US); саму страницу открыть не удалось. Отдельной кнопки «заполнить все кандидаты» не подтверждено.
- Отзыв (RSS, 2026-09-29): авто-заметки «makes the puzzles laughably easy» ([iTunes RSS](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1193508329/sortby=mostrecent/json)) — часть игроков считает автоподстановку обесценивающей игру.
- Заметки не выделены жирным/мелкие (пересказ отзыва, JustUseApp, ссылка выше) — не подтверждено.

### 1.4 Подсказки
- Есть Hint; сайт заявляет, что подсказки «explain solving methods that will help you improve your skills» ([sudoku.com](https://sudoku.com/)).
- Отзывы (пересказ, JustUseApp): хвалят «explains why numbers go there», ругают «Bowman's Bingo hints extremely impractical» (т.е. подсказка иногда предлагает метод перебора) и просят «option to turn off hint explanations». Не подтверждено дословно.
- Цена подсказки: в iOS-версии часть отзывов описывает «video ad for a hint» (сводка поиска, агрегаторы; в RSS 2026-09 этого не видно). **Не подтверждено** для текущей версии.

### 1.5 Ежедневка и стрики
- Daily Challenges с календарём и архивом: «pick a date on the calendar», «previous days or months»; прогресс «0/30» (месяц), раздел Awards ([sudoku.com/challenges](https://sudoku.com/challenges)). Описание приложения: «unique trophies» за ежедневные задачи, сезонные события с медалями ([App Store](https://apps.apple.com/us/app/sudoku-com-number-games/id1193508329)).
- Счётчик стрика, правила его потери: **не подтверждено**.
- Отзыв: события на 100+ уровней «too excessive» (пересказ, JustUseApp) — сезонные ивенты воспринимаются как раздувание.

### 1.6 Статистика/достижения
- Статистика есть (App Store: «statistics tracking and mistake highlighting»), есть счёт, счётчик ошибок и таймер на игровом экране ([sudoku.com](https://sudoku.com/)). Состав экрана статистики: **не подтверждено**.
- Трофеи/медали/Awards — геймификация поверх судоку (ссылки выше).

### 1.7 Ошибки и проверка
- Лимит ошибок: можно выключить или поставить 3, 5, 10 (фрагмент выдачи поиска по [Google Play](https://play.google.com/store/apps/details?id=com.easybrain.sudoku.android&hl=en_US)). Auto-Check включается отдельно ([Easybrain](https://easybrain.com/sudoku)). На сайте по умолчанию видно «mistake counter (3-strike limit)» ([sudoku.com](https://sudoku.com/)).
- Отзывы: «Three mistakes limit too harsh for beginners», «3-strike limit doesn't match settings toggle» (пересказ, JustUseApp); RSS 2026-09-27: «Can you take off the mistakes I don't like that you have to restart» — игрок не нашёл, как отключить рестарт после лимита.
- RSS 2026-09-25 (положительный): «Love that you can no longer change values in previously filled squares» — часть игроков ценит блокировку заполненных клеток, как у Pundoku в Чернильном режиме.

### 1.8 Доступность
- App Store: «The developer has not yet indicated which accessibility features this app supports» ([App Store](https://apps.apple.com/us/app/sudoku-com-number-games/id1193508329)) — проверено 2026-10-02 через WebFetch.
- VoiceOver, Dynamic Type, поведение при Reduce Motion: **не подтверждено**.
- Темы: 3 цветовые темы ([Easybrain](https://easybrain.com/sudoku)). Тёмная тема: отзыв 2021 «Dark mode numbers grey out, invisible» (JustUseApp) и свежие RSS 2026-09-25/28: «Why did the three different background color options get removed? I need dark mode» и «WHY IS THERE NO DARK MODE IN 2026?!» — **противоречит** описанию с темами; возможно, после обновления набор изменился. Не подтверждено.
- Крупные цели касания — плохо (см. 1.2).

### 1.9 Монетизация-раздражители
- Реклама во время игры — главная жалоба. Свежие RSS-отзывы (2026-09-28…30, около 30 из ~35 просмотренных про рекламу): «Every few numbers I put in it give me an add»; «Complete a row — see an ad; fill in a box — see an add»; «Can't dismiss the ad until you open the App Store»; «ads...ridiculously long, extremely frequent, and make you wait forever» ([iTunes RSS](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1193508329/sortby=mostrecent/json)). Несколько авторов пишут, что реклама резко выросла недавно.
- Отключение: «Sudoku.com No Ads» $14.99 разово ([App Store](https://apps.apple.com/us/app/sudoku-com-number-games/id1193508329)); в выдаче поиска также $4.99/мес (вторичные, не подтверждено). Отзыв: «$15 to buy out. No night mode.»
- Сайт: «Ads help us keep our game free» ([sudoku.com](https://sudoku.com/)).
- Трекинг: App Store заявляет сбор покупок, местоположения, идентификаторов и использования, трекинг между сторонними сервисами.

### 1.10 Лучше, чем у Pundoku
- Подсказка с объяснением техники по запросу (у Pundoku подсказок нет).
- Настраиваемый лимит ошибок и Auto-Check (у Pundoku одно фиксированное поведение).
- Авто-обновление заметок при постановке цифры (у Pundoku нет).
- Календарь челленджей с трофеями за месяц, более заметный «ритуал» (но у Pundoku есть Year-полотно).
- Шесть уровней, понятная шкала.

### 1.11 Лучше у Pundoku
- Ноль рекламы и перебивок, ноль баннеров рядом с панелью цифр.
- Счётчик остатка под каждой цифрой, а не галочка (реакция на галочку у Sudoku.com отрицательная, §1.2).
- Крупная панель (46 pt), одна строка.
- Ошибка видна сразу, без счётчика поражений.
- Нет трекинга.

### 1.12 Взять / избегать
- Взять: подсказки, которые объясняют метод; настраиваемую строгость ошибок; авто-обновление заметок; календарь/архив.
- Избегать: рекламу между действиями и рядом с панелью; обязательный лимит ошибок без явного выключателя; смену индикатора «цифра закончилась» на галочку; сезонные ивенты-раздувалки; событийные награды как главный двигатель.

---

## 2. Good Sudoku (Zach Gage)

Цена и оценка (App Store, iPhone/iPad/Mac): бесплатно + «Full Game Unlock» $4.99; 4.2 из 5 (1.3K оценок); версия 1.0.30 от 2025-07-21; в истории версий упомянута синхронизация iCloud ([App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)). Отдельная версия в Apple Arcade — «Good Sudoku+», без рекламы и покупок, 4.1 (649 оценок) ([App Store](https://apps.apple.com/us/app/good-sudoku/id1551669399)).
Расхождение: iMore писал, что полный набор стоит $3.99 и что бесплатны только Daily и режим Good ([iMore](https://www.imore.com/zach-gage-releases-good-sudoku-reimagined-and-fun-take-classic)); сейчас в App Store $4.99. Состав бесплатной части сегодня **не подтверждён**.

### 2.1 Онбординг и первый запуск
- Есть обучение и «technique» практика отдельно от партий: игрок может отрабатывать приёмы по одному и видеть прогресс ([App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)). Рецензии хвалят туториал («the tutorial has been super helpful in understanding the basics», [iMore](https://www.imore.com/zach-gage-releases-good-sudoku-reimagined-and-fun-take-classic)).
- Минусы онбординга: туториал нельзя пропустить, зависает на теме заметок (вторичный источник, [Game Solver](https://game-solver.com/good-sudoku-by-zach-gage/); возможно устарело). Отзыв RSS 2026-07-29: «no instruction set or definitions» — игрок без знания жанра не понял экран ([iTunes RSS](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1489118195/sortby=mostrecent/json)). Обзор 148apps: нет словаря терминов вне разделов техник, трудно вспомнить, что такое «Focus Mode» ([148apps](https://www.148apps.com/sudoku/good-sudoku-review/)).
- Сложность подписана навыками: игра сообщает, какие приёмы потребуются на каждом уровне ([Tools and Toys](https://toolsandtoys.net/good-sudoku-for-ios-by-zach-gage-and-jack-schlesinger/)).

### 2.2 Ввод цифр
- **Режима «Number First» нет — самая частая просьба в отзывах:** «I wish it supported 'Number First' input» (2026-07-19); «can't select a number and then just touch square...must select each time» (2026-05-21); «Needs number lock» (2026-06-01); «Can't lock numbers», «additional clicks that should be easily avoidable» (2026-04-21) ([iTunes RSS](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1489118195/sortby=mostrecent/json)). Старые отзывы 2020–21 хвалят другой механизм: выбрать цифру и увидеть возможные клетки (Focus Mode; [App Store UK, отзыв Igor](https://apps.apple.com/gb/app/good-sudoku-by-zach-gage/id1489118195?see-all=reviews&platform=iphone)).
- Focus Mode: подсвечивает клетки с выбранной цифрой и все клетки, на которые она влияет ([Vice](https://www.vice.com/en/article/good-sudoku-is-making-me-good-at-sudoku/); [Tools and Toys](https://toolsandtoys.net/good-sudoku-for-ios-by-zach-gage-and-jack-schlesinger/)).
- Хаптика при вводе, настраиваемая («satisfying haptic feedback», 148apps). Отзыв: «clean, nice haptic feedback» (RSS 2026-03-07).
- Автозавершение: строка/столбец с одной недостающей цифрой заполняется касанием ([Tools and Toys](https://toolsandtoys.net/good-sudoku-for-ios-by-zach-gage-and-jack-schlesinger/)) — «busywork reduction».

### 2.3 Заметки/кандидаты
- Auto Note: одним касанием заполняет все кандидаты ([Vice](https://www.vice.com/en/article/good-sudoku-is-making-me-good-at-sudoku/)).
- Два вида пометок: обычные кандидаты и «cross-out» («здесь точно не эта цифра»), плюс цветная подсветка. В Arcade-версии ревью жалуются на три инструмента заметок и сложный интерфейс ([App Store Arcade](https://apps.apple.com/us/app/good-sudoku/id1551669399)).
- Отзывы (RSS): «candidates can't be completely erased»; «trouble with it unexpectedly leaving note mode»; «highlight the containing cell, not the pencil mark»; «visually crowded and confusing» (2026-04-08…08-04). UX старых версий: «UX is messy especially with the cross out note tool» (2020, App Store UK).
- Обзор Game Solver: автозаметки визуально перегружают (вторичный источник).

### 2.4 Подсказки (сильнейшая сторона продукта)
- Решатель работает во время игры, читает ответы и заметки игрока и подсвечивает «следующий логичный шаг» с подсказкой-пояснением техники ([iMore](https://www.imore.com/zach-gage-releases-good-sudoku-reimagined-and-fun-take-classic); [Tools and Toys](https://toolsandtoys.net/good-sudoku-for-ios-by-zach-gage-and-jack-schlesinger/); [App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)). Обзоры называют это ключевым отличием («teaches strategy rather than just giving answers», [148apps](https://www.148apps.com/sudoku/good-sudoku-review/)).
- Слабое место: подсказка опирается на то, что игрок записал в заметках, и часто «не новая». Отзывы: «Hints only give one piece of information (and always something I already know)» (2026-08-21); «clicking on hint only to be shown a 'naked pair' that I've already seen» (2026-07-22); «hints don't work very well...shows moves you've already made» (2026-02-12) ([iTunes RSS](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1489118195/sortby=mostrecent/json)). Аналогично App Store-сводка: подсказка иногда сообщает то, что игрок уже знает ([App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)).
- Расположение кнопки подсказки в Arcade-версии — случайные нажатия ([App Store Arcade](https://apps.apple.com/us/app/good-sudoku/id1551669399)).
- Цена: во внутренних режимах — часть прогресса (отслеживаются «hint usage» и время, Vice). Платные подсказки/реклама: не подтверждено; отзыв 2026-05 хвалит «polite 'excuse the ad'» — реклама бывает в бесплатной версии, но редко.

### 2.5 Ежедневка и стрики
- Три ежедневных режима со сложностью, растущей в течение недели, и глобальные таблицы лидеров ([App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)); три режима Good / Arcade / Eternal.
- Стрики: **не подтверждено**; есть «medals»/медальный счётчик (отзыв 2026-05-26: «medals don't show on medal count»).
- Проблемы по отзывам: результаты и турнирный счёт ломаются («score recorded as just '1'», 2026-02-11), Game Center-значок «stays on screen» (2026-09-25).

### 2.6 Статистика/достижения
- Статистика — по iMore, платная часть (старый источник); отслеживаются подсказки и время ([Vice](https://www.vice.com/en/article/good-sudoku-is-making-me-good-at-sudoku/)); достижения/лидерборды через Game Center ([Arcade](https://apps.apple.com/us/app/good-sudoku/id1551669399)).
- Отзыв: «no longer tells me how I ranked» (2026-01-15).

### 2.7 Ошибки и проверка
- Arcade и Eternal — режимы без права на ошибку («test your ability to solve grids without making any mistakes», выдача поиска; подробности [Game Solver](https://game-solver.com/good-sudoku-by-zach-gage/), вторичный). Отзыв (RSS, дата усечена в UK-списке): «Almost ridiculously easy to make a mistake and lose a life» ([App Store UK](https://apps.apple.com/gb/app/good-sudoku-by-zach-gage/id1489118195?see-all=reviews&platform=iphone)) — относится ли к конкретному режиму, не подтверждено.
- Мгновенная/по запросу проверка в режиме Good: **не подтверждено**.
- Баг-репорты о нарушении уникальности: «3 pro-level puzzles that violate the Sudoku uniqueness rule» (2026-08-06); стартовая daily была нерешаемой ([148apps](https://www.148apps.com/sudoku/good-sudoku-review/)). Урок для Pundoku: если ежедневка берётся извне или из генератора, нужна автоматическая проверка уникальности.

### 2.8 Доступность
- App Store: «The developer has not yet indicated which accessibility features this app supports» (проверено 2026-10-02, [App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)). VoiceOver/Dynamic Type: **не подтверждено**. Вторичный источник утверждает, что нет настройки размера шрифта ([Game Solver](https://game-solver.com/good-sudoku-by-zach-gage/)); возможно устарело.
- Тёмная тема: ревью в App Store-сводке: «dark mode paywall-restricted» ([App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)); RSS 2026-01-03: «auto night mode not working». Смена цветовой схемы действует только внутри партии и по режимам (148apps).

### 2.9 Надёжность (не входит в список срезов, но критично для PWA-ритуала)
- Главная жалоба 2026 года: приложение вечно висит на экране «Loading…» без интернета, в том числе у людей, купивших полную версию: «why would i not be able to play offline when i purchased full access» (2026-07-14); «can't play on airplane» (2026-04-03); «delete and redownload» помогает (2026-07-17). Около 15 отзывов за 2026 год ([iTunes RSS](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1489118195/sortby=mostrecent/json)). Причина (Game Center/сервер турниров) — **не подтверждено**.
- Батарея/CPU: «consumes over 200% CPU» (Mac, 2026-05-27); 2020: «Insane battery consumption».

### 2.10 Монетизация-раздражители
- $4.99 разово, без подписки, без постоянной рекламы: отзыв «No ads, no subscription...almost every feature can be toggled on/off» (RSS 2026-03-14). Остальное — минимально навязчиво. Тёмная тема за платой (см. 2.8) — раздражитель.
- Сбор данных: идентификаторы и использование для рекламы и функций ([App Store](https://apps.apple.com/us/app/good-sudoku-by-zach-gage/id1489118195)).

### 2.11 Лучше, чем у Pundoku
- Подсказки по уровню знаний игрока с объяснением приёма; обучение приёмам вне партий.
- Auto Note, cross-out, цветные пометки, Focus Mode (режим выделения цифры).
- Хаптика (у Pundoku вибраций нет по решению владельца).
- Режимы без права на ошибку (аналог Чернильного).

### 2.12 Лучше у Pundoku
- Надёжный офлайн-старт как проектное требование (PWA; но см. §6 — проверять на iPhone).
- Меньше инструментов заметок, одна кнопка Notes, нет «трёх видов» пометок.
- Мгновенная видимая ошибка вместо потери «жизни».
- Нет платных стен, тёмная тема системная.

### 2.13 Взять / избегать
- Взять: учебные подсказки, «объясни технику»; но подсказку строить от фактического состояния клеток, а не только от заметок игрока; режим «цифра-первой»/блокировка цифры; Focus-подсветка.
- Избегать: три вида заметок без объяснения; ошибки, наказываемые потерей жизни при мисклике; зависимость старта от сети; пустую подсказку «ты уже это знаешь»; тёмную тему за платой; туториал без пропуска.

---

## 3. NYT Games: Sudoku

Контекст: Sudoku в приложении NYT Games и на сайте, три сложности Easy/Medium/Hard, новый комплект каждый день ([App Store](https://apps.apple.com/us/app/nyt-games-word-games-sudoku/id307569751): «Play a new puzzle every day in easy, medium or hard mode»). 4.8 из 5, 293 тыс. оценок, Editors' Choice; подписка «Games» $4.99–$5.99/мес (там же). Важно: [приложение «Sudoku ▦» (id1407780576)](https://apps.apple.com/us/app/sudoku/id1407780576) принадлежит Tripledot Studios, не NYT — на него не опираться.
Надёжность: официальная справка недоступна (см. §0). Ниже вторичные источники.

### 3.1 Онбординг и первый запуск
- Отдельного обучения Sudoku в NYT Games: **не подтверждено**. Минимализм подтверждается третьей стороной: «clean and minimalist», «no ads mid-solve, no intrusive pop-ups» ([SudokuPulse](https://sudokupulse.com/articles/nyt-sudoku-tips/); сайт-конкурент, нейтральность не гарантирована).
- Отзывы приложения в целом: конфликт навигации и агрессивная монетизация (запросы рейтинга, платные бонусы), офлайн работает только для кроссворда ([iTunes RSS NYT Games](https://itunes.apple.com/us/rss/customerreviews/page=1/id=307569751/sortby=mostrecent/json); по одному срезу ленты, к Sudoku относится один отзыв).

### 3.2 Ввод цифр
- Модель ввода «клетка, потом цифра», режим «цифра-первой»: **не подтверждено**. В десктопной версии режим кандидатов переключается Пробелом («toggle between fill and candidate modes using the Space bar», [Reveal That](https://revealthat.com/nyt-sudoku-answers-today/); пересказ справки).
- Когда цифра стоит в сетке девять раз, она на панели светлеет; можно отключить в настройках (там же; **возможно, не NYT**: та же формулировка есть в справке Apple News, §4).
- Подсветка строки/блока/столбца или одинаковых цифр по выбору игрока (выдача поиска, вторичный, не подтверждено).
- Неограниченный undo ([SudokuPulse](https://sudokupulse.com/articles/nyt-sudoku-tips/)).

### 3.3 Заметки/кандидаты
- Ручные заметки + автозаполнение кандидатов: утверждает SudokuPulse (вторичный; «auto-fill candidates option that populates every empty cell»). Офиц. подтверждения нет. Автор статьи сам отмечает, что автозаполнение захламляет поле.

### 3.4 Подсказки
- Кнопка Hint подсвечивает «следующую логичную клетку» и помечает неверную, если там ошибка (пересказ справки: [Reveal That](https://revealthat.com/nyt-sudoku-answers-today/); **возможно, не NYT** — формулировка совпадает со справкой Apple News).
- Объяснения техники у подсказки нет в описаниях: **не подтверждено**.
- Влияние на стрик: два вторичных источника противоречат друг другу — «Using the Hint button... will disable your timer and streak» (выдача поиска, без URL-страницы) против Apple News «hints and checking don't affect» (§4). **Не подтверждено для NYT.**
- Reveal (клетка/пазл) выводит пазл из статистики и стрика (пересказ справки, Reveal That; возможно общая с Apple News формулировка).

### 3.5 Ежедневка и стрики
- Три пазла в день (Easy/Medium/Hard), сложность не растёт к концу недели ([SudokuPulse](https://sudokupulse.com/articles/nyt-sudoku-tips/)). Wikipedia пишет, что бесплатен первый выбранный за день уровень, остальные два — по подписке ([Wikipedia](https://en.wikipedia.org/wiki/The_New_York_Times_Games)); точные условия сегодня **не подтверждены**.
- Стрик есть («a streak counter rewards consecutive daily completions», SudokuPulse); правила заморозки/потери — **не подтверждено**.
- Время смены пазла — слабое место: петиция 2024 года утверждает, что Mini и Sudoku меняются в 22:00 по будням и 18:00 по выходным, из-за чего «it's the same one from the day before» ([Change.org](https://www.change.org/p/change-the-nyt-mini-and-sodoku-reset-times-to-midnight)). Отзыв App Store 2026-09-21: «calendar / time zone is frustrating for Sudoko. They must use UTC.» ([iTunes RSS NYT](https://itunes.apple.com/us/rss/customerreviews/page=1/id=307569751/sortby=mostrecent/json)). Другой источник говорит о полуночи ET (выдача поиска) — **расхождение, не подтверждено**.

### 3.6 Статистика/достижения
- «Best times and streaks for every difficulty level» (выдача поиска по описанию приложения/справки; вторичный). Scoreboard и стрик учитывают только пазлы без Reveal (Reveal That). Достижений-значков в духе Sudoku.com не найдено.

### 3.7 Ошибки и проверка
- Autocheck (по пазлу, включается внутри партии, красная косая черта на неверном), Check Square/Puzzle по запросу, не влияющее на статистику: пересказы справки ([thewordfinder](https://www.thewordfinder.com/nyt-sudoku-solver/2026-09-30) не открылся; через выдачу поиска). **Возможно, это формулировки Apple News**, не NYT. Для NYT подтверждена общая схема «проверка в любой момент, неверные подсвечиваются» ([SudokuPulse](https://sudokupulse.com/articles/nyt-sudoku-tips/)).
- Лимита ошибок нет (нигде не упоминается). Настройка «подсвечивать конфликты» есть (SudokuPulse).

### 3.8 Доступность
- App Store: «The developer has not yet indicated which accessibility features this app supports» (проверено 2026-10-02, [App Store](https://apps.apple.com/us/app/nyt-games-word-games-sudoku/id307569751)). VoiceOver/Dynamic Type/цветовая слепота для Sudoku: **не подтверждено**.

### 3.9 Монетизация-раздражители
- Подписка (Games $4.99–$5.99/мес); бесплатный стартовый набор, платный доступ к остальному (App Store, Wikipedia). Агрессивные запросы оценки и звук рекламы — по отзывам на всё приложение (RSS NYT); к Sudoku относятся не обязательно. Рекламы «в середине решения» нет по SudokuPulse (вторичный).
- Потеря прогресса при сворачивании приложения: «everything you've been working on... disappears in a nano second if you blink away» ([App Store](https://apps.apple.com/us/app/nyt-games-word-games-sudoku/id307569751), отзыв) — игра ли это Sudoku, не подтверждено.

### 3.10 Лучше, чем у Pundoku
- Стабильная калибровка сложности: Medium (23–26 клеток) требует больше приёмов, чем Expert у Sudoku.com; сложность определяется приёмами, а не числом клеток ([SudokuPulse difficulty](https://sudokupulse.com/articles/sudoku-difficulty/); сторонний). У Pundoku пока вторая ось «число подсказок» (`STATUS.md`, PD-9) — сверить честность сложности.
- Стрик + шкала времени + best time по сложностям как привычный якорь ритуала.
- Autocheck «по желанию», проверка по запросу.

### 3.11 Лучше у Pundoku
- Тепловая карта пути, Таймлапс, Year-полотно — осмысленный «итог дня», а не число.
- Ежедневка не привязана ко времени смены по часовому поясу издателя (в Pundoku дата = локальная? — проверить, см. §6).
- Счётчики остатка по цифрам.
- Нет подписки.

### 3.12 Взять / избегать
- Взять: калибровка по приёмам; Hint/Reveal отдельно от статистики (честный флаг `assisted`, он уже запланирован); тихий дизайн без интерстициалов.
- Избегать: сброс ежедневки не в локальную полночь (жалоба); платный доступ к «своему» дню.

---

## 4. Apple: что реально есть

Прямой ответ: **собственного судоку в приложении Apple Games у Apple нет.**

- Apple Games (iOS 26): центр управления играми: вкладки Home, Arcade, Friends, Library, Search; встроенных игр/головоломок нет ([9to5Mac](https://9to5mac.com/2026/01/09/ios-26-adds-new-games-app-on-iphone-heres-what-it-does/); [Apple Newsroom](https://www.apple.com/newsroom/2025/06/introducing-the-apple-games-app-a-personalized-home-for-games/)). Даёт Game Center: друзья, достижения, «challenges» поверх таблиц лидеров. Для юзабилити судоку Games app не эталон.
- **Apple News+ Sudoku (iOS 18.2+, подписчики News+; на старте США и Канада)** — единственный «судоку от Apple»: три сложности (easy, moderate, challenging) ([AppleInsider](https://appleinsider.com/articles/24/10/25/apple-news-adds-sudoku-to-the-puzzle-collection-in-ios-182); [9to5Mac](https://9to5mac.com/2024/10/25/sudoku-apple-news/)). Регионы сегодня — **не подтверждено** (данные от 2024-10).
- Apple Arcade: «Sudoku by MobilityWare+» (ранее Sudoku Simple, учит цветом, начинает с малых сеток; [MobilityWare](https://www.mobilityware.com/apple-arcade-launches-solitaire-and-sudoku-simple-by-mobilityware/)) и «Good Sudoku+» (§2). Без рекламы и покупок по описанию Arcade ([App Store](https://apps.apple.com/us/app/good-sudoku/id1551669399)).
- В App Store много судоку с Game Center (таблицы лидеров), например Sudokan ([App Store](https://apps.apple.com/us/app/sudokan/id6636466044)); отдельной «судоку-подборки» от редакции Apple я не подтверждал.

Далее — разбор Apple News+ Sudoku (первичный источник: справка Apple для Mac, [Apple Support](https://support.apple.com/en-am/guide/news/iph7f8229dd1/mac); справку для iPhone WebFetch отдаёт только оглавлением, детали с iPhone — из выдачи поиска по [той же справке](https://support.apple.com/guide/iphone/solve-sudoku-puzzles-iph9b53d2906/ios)).

### 4.1 Онбординг
- Отдельного обучения не описано: **не подтверждено**. Разбор по справке — только «как играть».

### 4.2 Ввод цифр
- Mac: клик по пустой клетке, цифры с клавиатуры или экранной панели, стрелки для перемещения, Delete/Eraser для стирания ([Apple Support](https://support.apple.com/en-am/guide/news/iph7f8229dd1/mac)).
- iPhone (выдача поиска): вкладка Pen: выбрать клетку, нажать цифру. Режим «цифра-первой»: не подтверждён. Нажатие на цифру подсвечивает такие же цифры в сетке (справка Mac).

### 4.3 Заметки
- Вручную или «Autofill Notes»; когда ставится цифра, совпадающие заметки автоматически убираются из связанных клеток (справка Mac).
- iPhone: когда заметка уверенно превращается в ответ, её фиксируют **долгим нажатием на цифру** на клавиатуре — альтернатива «переключателю Notes» (выдача поиска по справке iPhone; не подтверждено дословно).

### 4.4 Подсказки
- «Get Hint» выделяет самую решаемую клетку (с наибольшим количеством информации) и предлагает стратегию (справка Mac).

### 4.5 Ежедневка и стрики
- Три пазла в день, архив. Стрик: решить хотя бы один пазл дня любой сложности без Reveal (выдача поиска по справке iPhone). Таблицы лидеров по каждой сложности через Game Center (там же).
- Reveal выводит пазл из scoreboard и стрика; подсказки и проверка не влияют (справка Mac).

### 4.6 Статистика
- Scoreboard и стрик в приложении News (справка Mac). Детали экрана — не подтверждено.

### 4.7 Ошибки
- Show Conflicts: красные треугольники у дубликатов. Autocheck: красная косая на неверном ответе. Check Square/Puzzle по запросу, без влияния на статистику. Таймер можно скрыть, он ставится на паузу, когда игрок вышел (справка Mac). Лимита ошибок нет (упоминаний нет).
- Autocheck в одной справке Apple также «показывает завершение блока, строки или столбца» (выдача поиска по справке iPhone, не подтверждено).

### 4.8 Доступность
- Для Apple News+ Sudoku данных об VoiceOver/Dynamic Type/цветовой слепоте не нашёл: **не подтверждено**. Приложение News системное, но поддержку конкретно в судоку не проверял.

### 4.9 Монетизация
- Только в подписке Apple News+; рекламы внутри судоку не найдено (не подтверждено); цена подписки не исследовалась.

### 4.10 Лучше, чем у Pundoku
- Продуманная модель проверки: ошибки видны по запросу/по желанию, при этом не влияют на статистику; конфликты (дубликаты) подсвечиваются отдельно от «неверно по решению».
- Автоудаление заметок в связанных клетках и Autofill Notes.
- Подсказка «самая решаемая клетка» + стратегия.
- Таймер можно скрыть.

### 4.11 Лучше у Pundoku
- Доступно без подписки и без региональных ограничений (PWA).
- Таймлапс, карточка дня, Year-полотно.
- Счётчик остатка по цифрам.

### 4.12 Взять / избегать
- Взять: три независимых уровня проверки (конфликты, Autocheck, Check по запросу) и правило «подсказки и проверки не рвут стрик, Reveal рвёт»; долгое нажатие на цифру как быстрый способ «закрепить заметку».
- Избегать: ориентироваться на Apple Games app как на образец судоку — там судоку нет.

---

## 5. Сводная таблица «срез × конкурент»

| Срез | Sudoku.com | Good Sudoku | NYT Games Sudoku | Apple (News+ Sudoku) | Pundoku сейчас |
| --- | --- | --- | --- | --- | --- |
| Онбординг | Тура нет (не подтв.); статьи на сайте; много рекламы с первых минут | Туториал + отработка приёмов; нельзя пропустить, нет словаря | Не подтв.; минимализм | Не подтв. | Сразу сетка дня, без заставки и регистрации |
| Ввод цифр | Клетка-первой (не подтв.); мелкие цели, баннер у панели | Клетка-первой; **нет Number First** (частая жалоба); Focus Mode | Не подтв.; цифра светлеет после 9 (возможно не NYT) | Клетка, потом цифра; подсветка одинаковых | Клетка-первой; счётчик остатка; 46 pt; нет цифры-первой |
| Заметки | Авто-обновление при вводе; Notes | Auto Note, cross-out, цвет; перегружено | Ручные, автозаполнение (вторичный) | Ручные, Autofill, авто-удаление, долгое нажатие | Ручные; без авто и без удаления у соседей |
| Подсказки | Объясняют метод; видео-за-подсказку (не подтв.) | Лучшие: по знаниям игрока; но «уже знаю» | Hint на клетку; без объяснения (не подтв.) | «Самая решаемая клетка» + стратегия | Нет (релиз 2; флаг `assisted` заложен) |
| Ежедневка/стрик | Календарь, архив, трофеи; стрик не подтв. | 3 режима, лидерборды; баги результатов | 3 в день; стрик; жалобы на время смены | 3 в день, стрик без Reveal, Game Center | Today, архив, Year-полотно; стрика нет |
| Статистика/достижения | Статистика, трофеи, медали | Платная статистика (старый источник), Game Center | Best times, стрики по сложностям | Scoreboard, стрик | Карточка дня, win_rate, Year |
| Ошибки/проверка | Лимит 3/5/10/выкл, Auto-Check; «слишком строго» | Arcade/Eternal без права на ошибку; мисклик = жизнь | Autocheck/Check по запросу, без лимита (частично не NYT) | Conflicts, Autocheck, Check; не влияют на стат | Мгновенно, без настройки, без лимита; Ink в 1.1 |
| Доступность | Метки в App Store не заданы; цели мелкие; спор о тёмной теме | Метки не заданы; тёмная тема платная (отзыв) | Метки не заданы | Не подтв. | `aria-label` на панели, озвучка «N cells left»; аудит в PD-108 |
| Монетизация | Реклама между действиями, $14.99 | $4.99 разово, редко реклама; тёмная тема за платой | Подписка, запросы оценки | Подписка News+ | Нет |

---

## 6. Топ-10 практик и анти-практик для Pundoku

Приоритет: P0 — проверить/сделать до следующего релиза, P1 — в ближайших тикетах, P2 — в бэклог, P3 — следить.

| # | Практика / анти-практика | Откуда | Приоритет | Рек. |
| --- | --- | --- | --- | --- |
| 1 | **Офлайн-старт без сети — безусловный.** Good Sudoku теряет доверие платящих из-за вечного «Loading…» без сети (около 15 отзывов за 2026); NYT Games офлайн только в кроссворде | §2.9, §3.1 | P0 | Для PWA на iPhone: холодный запуск в режиме полёта, после чистки кэша iOS, после установки на экран «Домой»; сбой синка/ключа никогда не блокирует игру. Это шаги для владельца (я их не выполняю). |
| 2 | **Никакой рекламы/перебивок и платных стен на базовое** (в т.ч. тёмная тема). Реклама между ходами — основная причина 1-звёздочных отзывов Sudoku.com | §1.9, §2.10 | P0 (сохранить) | Закрепить как принцип в `CLAUDE.md`; в позиционировании упор на тишину. |
| 3 | **Подсказка, объясняющая технику и строящаяся от реального состояния сетки,** а не только от заметок игрока; без «ты это уже знаешь» | §2.4, §1.4, §4.4 | P1 | В релизе 2 («Фонарь»): многоуровневая подсказка (область → название приёма → клетка); решатель Pundoku с логом техник уже есть. Флаг `assisted`, как у Apple, не рвёт Year, но помечает. |
| 4 | **Режим «цифра-первой» / блокировка цифры.** Самая частая просьба к Good Sudoku; у Pundoku его нет | §2.2 | P1 | Добавить опциональный режим «закрепить цифру» (долгое нажатие на цифру панели, как идея Apple для заметок); счётчик остатка уже есть. |
| 5 | **Заметки: авто-удаление у соседей при вводе цифры + отдельная опция «заполнить кандидаты».** У Pundoku после постановки цифры заметки соседей остаются (кадр S05) | §4.3, §1.3, §2.3 | P1 | Авто-удаление — по умолчанию вкл. (с отдельным undo-шагом); «заполнить кандидаты» — кнопка в меню Notes, не по умолчанию (часть игроков считает это «слишком легко»). В Чернильном режиме решить отдельно. |
| 6 | **Мисклик в необратимом режиме.** Good Sudoku: «ridiculously easy to make a mistake and lose a life»; клетка у Pundoku ~39 pt при минимуме HIG 44 | §2.7 | P1 (до выхода Ink) | Для Ink: проверить на реальном iPhone частоту промахов по клетке; рассмотреть двухфазный ввод (цифра «примеряется» мягко, фиксируется следующим касанием/паузой). Вынести на согласование владельцу, так как меняет суть режима. |
| 7 | **Уровни проверки как отдельные настройки:** конфликты (дубликаты) / мгновенная подсветка неверного / проверка по запросу; без лимита «жизней» | §4.7, §1.7, §3.7 | P2 | Сейчас одна жёсткая модель. Минимум: тумблер «показывать ошибки сразу» (по умолчанию вкл.) и кнопка «Проверить»; лимит ошибок не вводить (жалоба на 3-strike). |
| 8 | **Ежедневка: граница дня — локальная полночь и явная дата на экране.** NYT: смена в 22:00/18:00 и жалоба «must use UTC» | §3.5 | P1 | Проверить, как Today определяет «сегодня» при путешествии/смене пояса и у кого до полуночи не опубликована сетка Sudoku.com (фолбэк на генератор по `seed = дата`); подпись дня видна всегда. |
| 9 | **Индикатор «цифра закончилась»: счётчик остатка, не галочка.** Sudoku.com после обновления заменил исчезновение галочкой и получил отрицательную реакцию | §1.2 | P3 (сохранить) | Не менять. Проверить читаемость «·» у VoiceOver и при Dynamic Type. |
| 10 | **Доступность как преимущество:** ни у одного из трёх метки App Store не заданы; у Sudoku.com жалобы на мелкие цели | §1.8, §2.8, §3.8 | P1 | Довести результаты PD-108 до заявляемых возможностей: VoiceOver по сетке (клетка, значение, заметки, подсказанная/заданная), Dynamic Type вне сетки, различимость «задано/поставлено» без цвета (серифы/гротеск уже это дают), Reduce Motion. Если PWA позволяет, прямо заявить. |

### Дополнительно (не вошло в топ-10)
- Туториал: у Good Sudoku жалуются, что его нельзя пропустить и нет словаря. Рек.: у Pundoku — одноразовые подсказки-«карточки» в контексте (первое касание Notes, первый вход в Ink), страница «как это работает» в Settings, никаких обязательных туров (P2).
- Стрик: у Sudoku.com/NYT/Apple он есть; у Pundoku это Year-полотно. Рек.: если добавлять счётчик, то тихий, без «потери» и без пуш-давления; правило Apple «подсказка не рвёт, Reveal рвёт» (P2/P3, решение владельца).
- Режим «Лжец»/«Чернила» — позиция новизны: у конкурентов аналог только режимы без права на ошибку у Good Sudoku (Arcade/Eternal).
- Качество сетки: у Good Sudoku баги неуникальных сеток и нерешаемая daily. Рек.: автопроверка уникальности и solver-прогон для каждой сетки (в т.ч. из прокси Sudoku.com) (P1, если ещё не сделано).
- Калибровка сложности: по технике, а не по числу клеток (у Sudoku.com Easy/Medium/Hard почти одно и то же, SudokuPulse). Сверить с `STATUS.md` (PD-9).

---

## 7. Не удалось подтвердить

- Официальная справка NYT (help.nytimes.com, nytimes.com/puzzles/sudoku) недоступна для WebFetch. По NYT: онбординг, режим ввода, автокандидаты, влияние Hint на стрик, правила бесплатного доступа, время смены ежедневки, VoiceOver.
- Sudoku.com: онбординг, модель ввода (клетка/цифра-первой), цена подсказки сегодня, состав статистики, правила стрика, существование тёмной темы после обновления сентября 2026, VoiceOver/Dynamic Type. Страницу Google Play открыть не удалось (цитаты — из фрагментов поисковой выдачи).
- Good Sudoku: состав бесплатной части сегодня, наличие стриков, режим проверки в режиме Good, VoiceOver/Dynamic Type, причина вечного «Loading…».
- Apple News+ Sudoku: полный текст справки для iPhone (открывается только оглавление); доступность; регионы сегодня; цена.
- Reddit: прямые обсуждения не нашлись (поиск возвращал страницы App Store); отзывы взяты из ленты App Store (iTunes RSS) и агрегатора JustUseApp (пересказы).
- Выбор «5 сложностей» против «4» в Pundoku.
