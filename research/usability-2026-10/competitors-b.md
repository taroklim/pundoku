# Юзабилити-исследование конкурентов, часть B (2026-10-02)

Охват: Brainium «Sudoku», Logic Wiz (Sudoku Classic / Sudoku & Variants), Sven's SudokuPad (CTC), sudoku.coach. Коллега в `competitors-a.md` разбирает Sudoku.com, Good Sudoku, NYT Games, Apple Games.

Рамка: только юзабилити (не маркетинг и не цены). Монетизация учтена лишь как раздражитель UX.

## 0. Как читать файл

- **Факт** идёт со ссылкой на источник. **Рекомендация** помечена «Рек.» и является моим суждением, а не фактом.
- Пометка «не подтверждено» значит, что за отведённое время я не нашёл первичного источника.
- Ограничения метода:
  - Приложения не ставились, только публичные страницы.
  - WebFetch отдаёт пересказ страницы моделью, а не дословный текст. Цитаты отзывов взяты из таких пересказов и не сверены слово в слово (все ≤15 слов).
  - У отзывов App Store в выдаче нет года для части дат («Jul 9», «Jul 28»). Я пишу «дата без года».
  - Главная страница sudoku.coach, её /learn и /about рендерятся JS и через WebFetch не читаются (только баннер cookies). Для sudoku.coach подтверждено мало (см. раздел 4).
  - Есть тёзки: `sudoku.coach` (веб/TWA), `sudokucoach.app` (iOS, другой продукт), `conteit/sudoku-coach` на GitHub (открытая PWA, другой проект). Я их не смешиваю.
- Исходные для Pundoku: `products/pundoku/CLAUDE.md` и `reports/sudoku-pwa-research/07-concept-draft.md`. Сравнения «у Pundoku лучше» сделаны по концепту и плану, реализацию в коде я не проверял.

## 1. Выбор конкурентов и обоснование

| Конкурент | Почему в выборке | Роль для сравнения |
|---|---|---|
| **Brainium «Sudoku»** (iOS id418044512) | Массовый: 4.7/5, 161K оценок на App Store ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)), 603.3K отзывов по данным [brainium.com](https://brainium.com/games/sudoku/). Объясняющие подсказки, авто-заметки, ежедневка, статистика. | Типичный «казуальный мейнстрим» на iPhone. Богатая история жалоб на редизайн и рекламу. |
| **Logic Wiz** (Sudoku Classic, Sudoku & Variants) | 4.8/5 при 391 и 1.6K оценок ([Classic](https://apps.apple.com/us/app/classic-sudoku-by-logic-wiz/id6443815428), [Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)). Самый богатый набор решательских инструментов (двойная нотация, sticky digit, мультивыбор). Отзывы цитируют переходы с закрытых Sudoku+ и Enjoy Sudoku. | Сила-пользователь без рекламной агрессии Sudoku.com. Хорошее зеркало «что хотят настойчивые игроки». |
| **Sven's SudokuPad** (web + iOS) | «Золотой стандарт» ввода и режимов у энтузиастов: движок из видео Cracking the Cryptic ([App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073), [web](https://sudokupad.app/)). Есть Replay (родственник нашего Таймлапса). | Эталон ввода (Digit / Corner / Centre / Colour), антипример онбординга и доступности. |
| **sudoku.coach** | Главный «обучающий» веб-сервис без рекламы (в [01-market.md](../../../../reports/sudoku-pwa-research/01-market.md) назван ближайшим к нише). Карта сайта подтверждает глубину обучения ([sitemap](https://sudoku.coach/sitemap.xml)). | Эталон «подсказка = техника, а не цифра». Для UX-деталей использована также открытая PWA `conteit/sudoku-coach` (раздел 4.9). |

Кого не взял и почему:
- **Andoku 3.** Сильные заметки и подсказки, но он в основном Android ([источник](https://www.appbrain.com/app/andoku-sudoku-3/com.andoku.three.gp)). Для iPhone-PWA вторичен.
- **Simple Sudoku / «минималистичные».** Нет надёжных публичных данных об UX кроме витрин магазинов.
- **Cracking the Cryptic (нативное приложение Studio Goya).** Это про варианты судоку, а не про классику.

---

## 2. Brainium «Sudoku»

### 2.1 Онбординг и первый запуск
- Не подтверждено: публичных описаний первого запуска и туториала не нашёл.
- Экран «как играть» в Help Center есть только как статья «What are the Sudoku rules?» ([Help Center](https://brainium.helpshift.com/hc/en/7-sudoku/)).

### 2.2 Ввод цифр
- Есть режим **Number Painting**: быстро заполняет клетки выбранной цифрой или заметкой ([brainium.com](https://brainium.com/games/sudoku/), [game-solver](https://game-solver.com/sudoku-2-7/)). То есть доступен и порядок «сначала цифра, потом клетки».
- Отзывы после обновления жалуются на потерю быстрого ввода:
  - «removal of the long press is extremely disappointing» (дата без года; [отзывы](https://apps.apple.com/us/app/sudoku/id418044512?see-all=reviews&platform=iphone&sort=helpful)).
  - «toggle button doesn't register» при переключении заметки/цифра ([те же отзывы](https://apps.apple.com/us/app/sudoku/id418044512?see-all=reviews&platform=iphone)).
  - «You CAN enter a different number into an already solved cell, overwriting» ([те же отзывы](https://apps.apple.com/us/app/sudoku/id418044512?see-all=reviews&platform=iphone&sort=helpful)). Пользователи просят блокировать клетку после ввода.
- Агрегатор отзывов: редизайн цифровой панели ломает мышечную память; пожилые игроки часто ошибаются на мелкой панели ([justuseapp](https://justuseapp.com/en/app/418044512/sudoku/reviews)).
- Отзыв (пересказ в сниппете поиска, первоисточник не открыт) про лишнюю анимацию при вводе цифры, из-за которой лагает ввод, и про 5–6 тапов, чтобы цифра «зарегистрировалась». Считать слабым свидетельством.

### 2.3 Заметки и кандидаты
- Есть Auto-Fill Notes и Auto-Clear Notes ([brainium.com](https://brainium.com/games/sudoku/)). Одним переключателем, без повторного включения на каждую цифру (сниппет поиска, [brainium.com](https://brainium.com/games/sudoku/)).
- Отзыв: «AUTOFILL for notes is such a timesaver!»; шрифт заметок больше, чем у других приложений ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)).
- Очистка: отдельный режим Auto-Clear. Ручная очистка не подтверждена.

### 2.4 Подсказки
- Позиционирование: подсказка «teaches you why», с анимациями и цветовой подсветкой ([brainium.com](https://brainium.com/games/sudoku/)). Положительные отзывы: «hints are very educational» ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)).
- Деградация: «No more hints of finned or sashimi swordfish, no XY WING»; другой отзыв: «runs out of gas leaving you with trial and error» (оба без года и от 10/13/2025; [отзывы](https://apps.apple.com/us/app/sudoku/id418044512?see-all=reviews&platform=iphone&sort=helpful)). Подсказка «попробуй наугад» воспринимается как отказ сервиса.
- Цена подсказки (лимит, реклама за подсказку): не подтверждено.

### 2.5 Ежедневка и стрики
- Daily Puzzle: общий для всех пазл на день, календарь символов ([Help Center](https://brainium.helpshift.com/hc/zh-hant/7-sudoku/faq/463-what-is-a-daily-puzzle-and-what-does-the-calendar-indicate/)):
  - золотая галочка, если решил в тот же день без подсказок;
  - серебряная, если в другой день или с подсказкой;
  - **играть можно только в пределах текущего месяца**.
- Стрики: в FAQ не подтверждены. Сравнительный сайт пишет, что daily у Brainium «limited focus» ([sudokuaday](https://sudokuaday.com/comparison-pages/sudoku-a-day-vs-brainium)). Это сайт-конкурент, источник предвзятый.
- Лидерборды глобальные и друзей ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)).

### 2.6 Статистика и достижения
- Есть статистика и достижения ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)). Детали экранов не подтверждены.
- Потеря данных как повод обращения в поддержку: статьи «iOS: My cumulative score disappeared! How do I restore it?», «Android: Can I transfer my Sudoku data to a new device?» ([Help Center](https://brainium.helpshift.com/hc/en/7-sudoku/)).

### 2.7 Ошибки и проверка
- Есть Auto-Check Errors, отключаемый в настройках (сниппет поиска, [brainium.com](https://brainium.com/games/sudoku/)). Стоимость ошибки (лимит ошибок): не подтверждено.
- Отзыв «difficulty seeing which numbers players entered versus original clues» после обновления ([justuseapp](https://justuseapp.com/en/app/418044512/sudoku/reviews)).

### 2.8 Доступность
- App Store: «The developer has not yet indicated which accessibility features this app supports» ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)).
- Подтверждено: настройка размера шрифта и ключевого цвета через вкладку Themes (Grid Style, Backdrop, Font Size, Key Color), переключатель CONCRETE CELLS ([Help Center](https://brainium.helpshift.com/hc/en/7-sudoku/faq/169-ios-the-numbers-are-too-small-can-i-make-them-bigger/?p=all)).
- Жалобы: дальтоники не различают элементы после обновления, контраст после редизайна ([justuseapp](https://justuseapp.com/en/app/418044512/sudoku/reviews)). Поддержку VoiceOver и Dynamic Type не подтвердил.

### 2.9 Монетизация-раздражители
- Отзывы: «pop up ads in the middle of the game», «Ads after ads after ads. Cannot start a single game without watching ads» ([отзывы](https://apps.apple.com/us/app/sudoku/id418044512?see-all=reviews&platform=iphone)).
- Counter-signal в агрегаторе: «only a brief one in order to start a puzzle» ([justuseapp](https://justuseapp.com/en/app/418044512/sudoku/reviews)). Опыт неоднороден.
- Снятие рекламы: на странице App Store $11.99 ([App Store](https://apps.apple.com/us/app/sudoku/id418044512)); сайт-конкурент пишет $4.99 ([sudokuaday](https://sudokuaday.com/comparison-pages/sudoku-a-day-vs-brainium)). Расхождение объясняется регионом или временем. Принимаю цифру со страницы App Store.
- В Help Center отдельный блок «Ad related» и баг-репорт «Restore Purchase Bug» (ноябрь 2025), громкая реклама ([Help Center](https://brainium.helpshift.com/hc/en/7-sudoku/)).

### 2.10 Итог по Brainium
- **У них лучше, чем у Pundoku:**
  - Number Painting и авто-заметки уже есть.
  - Настройка размера шрифта и цвета.
  - Календарь ежедневных с мягкой «серебряной» градацией.
  - Крупный шрифт заметок (по отзыву).
- **У Pundoku лучше:**
  - Нет рекламы.
  - Отличие «дано / поставлено» по гарнитуре, а не только по цвету (в 07 заложено).
  - Контраст посчитан.
  - Восстановление без аккаунта и логинов.
  - Нет лидербордов и очков.
- **Взять:**
  - Серебряная / золотая градация вместо потери стрика.
  - Один переключатель авто-очистки заметок.
  - Крупные заметки.
- **Избегать:**
  - Редизайн панели ввода после релиза.
  - Анимация на каждом вводе.
  - Возможность перезаписать решённую клетку.
  - Подсказка «методом проб».

---

## 3. Logic Wiz (Sudoku Classic, Sudoku & Variants)

### 3.1 Онбординг и первый запуск
- Не подтверждено: описаний первого запуска нет.
- Витрина обещает «Beautiful minimal design for focused play» ([Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)). Это заявление, а не проверка.

### 3.2 Ввод цифр
- Есть sticky digit mode (цифра «залипает» для последовательных клеток), мульти-выбор клеток ([Classic](https://apps.apple.com/us/app/classic-sudoku-by-logic-wiz/id6443815428), [Classic reviews](https://apps.apple.com/us/app/sudoku-by-logic-wiz/id6443815428?see-all=reviews&platform=iphone)).
- Отзыв по Variants: убрали однострочную панель цифр, из-за чего «constant misclicks» и падение вовлечённости. Это пересказ, дословную цитату не сверил ([Variants reviews](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853?see-all=reviews&platform=iphone)).
- Тот же паттерн, что у Brainium: смена раскладки панели цифр наказывает привычных игроков.

### 3.3 Заметки и кандидаты
- Две нотации (double notation), несколько стилей pencil marks, авто-удаление pencil marks, раскраска и рисование по полю, в том числе по отдельным пометкам (сниппет поиска, [Classic](https://apps.apple.com/us/app/classic-sudoku-by-logic-wiz/id6443815428)).
- Обновление v4.5.4 «Improved Fill Candidates»: можно выбрать правила (классика или правила всей головоломки), область (выделение или всё поле); «no more ad for Fill Candidates» ([Variants, What's New](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)). То есть раньше авто-кандидаты были за рекламой.
- Желаемое пользователями: подсветка отдельных pencil marks ([Variants reviews](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853?see-all=reviews&platform=iphone&sort=recent)).

### 3.4 Подсказки
- «Smart hints and strategy explanations — no guessing required» ([Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)).
- Отзыв: подсказка называет технику и показывает, как она применена ([Classic reviews](https://apps.apple.com/us/app/sudoku-by-logic-wiz/id6443815428?see-all=reviews&platform=iphone)).
- Запрос пользователей: «easier access to advanced technique tutorials» ([Variants reviews](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853?see-all=reviews&platform=iphone)). Лесенка подсказок и цена: не подтверждено.

### 3.5 Ежедневка и стрики
- Маркетинг сайта: «Themed Weekly Challenges», «track your streak» ([logic-wiz.com](https://logic-wiz.com/)). Это недельные темы, а не ежедневка. Механику стрика не подтвердил.

### 3.6 Статистика и достижения
- «Track your solve times, favorite strategies, and improvement over time» ([logic-wiz.com](https://logic-wiz.com/)). Экраны не подтверждены.
- Отзыв: кросс-платформенная синхронизация и «buy once to play on every platform» ([Classic reviews](https://apps.apple.com/us/app/sudoku-by-logic-wiz/id6443815428?see-all=reviews&platform=iphone)).

### 3.7 Ошибки и проверка
- «Multiple error detection modes» ([Classic, описание](https://apps.apple.com/us/app/classic-sudoku-by-logic-wiz/id6443815428)). Какие именно и с каким штрафом: не подтверждено.

### 3.8 Доступность
- App Store: «The developer has not yet indicated which accessibility features this app supports» ([Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)).
- 23 языка ([Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)). VoiceOver, Dynamic Type, цветовую слепоту, Reduce Motion не подтвердил.

### 3.9 Монетизация-раздражители
- Отзывы: «borderline unusable», «really over the top and annoying» (Classic). Разработчик отвечает, что показывает долю рекламы относительно конкурентов ([Classic reviews](https://apps.apple.com/us/app/sudoku-by-logic-wiz/id6443815428?see-all=reviews&platform=iphone&sort=recent)).
- Variants: «suddenly overnight it went from an occasional brief ad to extremely frequent ads» ([Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)).
- Реклама после третьей ошибки и одна реклама при старте игры: это слабое свидетельство (сниппет поиска, первоисточник не открыт).
- Подписки Variants: $2.99 в месяц, $9.99 в год, $24.99 пожизненно ([Variants](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)). Classic: от $5.59 до $6.99 ([Classic](https://apps.apple.com/us/app/classic-sudoku-by-logic-wiz/id6443815428)).

### 3.10 Итог по Logic Wiz
- **У них лучше, чем у Pundoku:**
  - Sticky digit.
  - Мульти-выбор.
  - Две нотации.
  - Настраиваемое заполнение кандидатов с областью и правилами.
  - Раскраска.
  - Облачная синхронизация.
  - Быстрая реакция разработчика.
- **У Pundoku лучше:**
  - Нет рекламы и платных ограничений.
  - Тихий визуал.
  - Не нужен аккаунт.
  - Карточка дня, Year и Таймлапс (у Logic Wiz аналога не нашёл).
- **Взять:**
  - Заполнение кандидатов с выбором области (выделенное или всё поле) и явным правилом.
  - Sticky digit как опцию.
- **Избегать:**
  - Ломать однострочную панель цифр.
  - Закрывать базовый инструмент (авто-кандидаты) рекламой.

---

## 4. Sven's SudokuPad (web и iOS)

### 4.1 Онбординг и первый запуск
- Не подтверждено: нет данных о первом запуске.
- Продукт предполагает, что пользователь пришёл по ссылке на готовую головоломку или импортирует её. Для новичков это порог ([01-market.md](../../../../reports/sudoku-pwa-research/01-market.md): «порог входа выше»).
- App Store: «Option to paste link inside app» (версия 1.3.1.1, 12/09/2021). Это последняя версия на странице ([App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073)).

### 4.2 Ввод цифр
- Четыре режима: Digit (Z), Corner (X), Centre (C), Colour (V); переключение пробелом или Page Down; модификаторы: Ctrl+цифра = Centre, Shift+цифра = Corner, Ctrl+Shift+цифра = Colour ([sudokupad.app](https://sudokupad.app/)).
- Выбор: перетаскивание, Ctrl+клик (добавить или убрать), стрелки, «Invert selection» ([sudokupad.app](https://sudokupad.app/)).
- Тач (сниппет поиска): двойной тап и долгий тап по клетке выбирают «по инструменту» (tool-sensitive). Двойной тап по заполненной клетке подсвечивает все такие цифры.
- Отзыв: «The UI for this app is just simply perfect» ([iOS reviews](https://apps.apple.com/us/app/svens-sudokupad/id1570622073?see-all=reviews&platform=iphone)). Фраза «by far the best for working sudokus» из сниппета поиска без URL первоисточника.
- На мобильной ОС нельзя масштабировать и двигать поле; с Pen Tool без клавиатуры не работать (сниппет поиска, вероятно из справки; не подтверждено).

### 4.3 Заметки и кандидаты
- Corner и Centre, плюс цветовые метки ([App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073)).
- Жалоба: нет авто-удаления pencil marks при постановке цифры ([iOS reviews](https://apps.apple.com/us/app/svens-sudokupad/id1570622073?see-all=reviews&platform=iphone)). Авто-кандидатов в описании нет.

### 4.4 Подсказки
- Подсказок и обучения техникам не подтвердил. Это инструмент решателя, а не тренер (описание [App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073)).

### 4.5 Ежедневка и стрики
- Не подтверждено, и по сути продукта их, судя по описанию, нет. Единственный «ритуал» здесь — решать пазлы из видео CTC.

### 4.6 Статистика и достижения
- Не подтверждено. Есть **Replay** (воспроизведение решения) ([App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073)).
- Баг Replay: таймер показывает неверное время, репроигрыш идёт с включённым conflict checker независимо от настроек, иногда теряются последние шаги ([issue #34](https://github.com/SudokuPad/sudokupad-web-issues/issues/34), открыт с 2022-12-01, без ответа).

### 4.7 Ошибки и проверка
- Кнопка Check: проверка «basic sudoku rules», «May not work on non sudoku grids or special constraints» ([sudokupad.app](https://sudokupad.app/)).
- Пользователь в Steam не находит авто-подсветку неверных цифр, а Check не показывает, какая цифра неверна, только пустые клетки ([Steam](https://steamcommunity.com/app/1706870/discussions/0/3422194223899817996/)).
- Есть conflict checker (включение и отключение; сниппет поиска про настройки, первоисточник не открыт).

### 4.8 Доступность
- App Store: «The developer has not yet indicated which accessibility features this app supports» ([App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073)).
- Цвета: открытое предложение улучшить различимость палитры (issue #35, февраль 2023, без ответа) ([GitHub](https://github.com/SudokuPad/sudokupad-web-issues/issues/35)).
- Таймер не ставится на паузу при переключении приложений, глючит ([iOS reviews](https://apps.apple.com/us/app/svens-sudokupad/id1570622073?see-all=reviews&platform=iphone)). Отсутствие автопаузы важно для PWA.
- VoiceOver, Dynamic Type, Reduce Motion: не подтверждено.

### 4.9 Монетизация-раздражители
- Реклам нет; iOS-версия $2.99; разработчик не собирает данные ([App Store](https://apps.apple.com/us/app/svens-sudokupad/id1570622073)).
- Рейтинг 3.3/5 при 117 оценках. Причины: «iOS app has fallen far behind the web app in features»; нет синхронизации; ограниченные цвета ([iOS reviews](https://apps.apple.com/us/app/svens-sudokupad/id1570622073?see-all=reviews&platform=iphone)).
- Критика цены: «It would be okay if it started free with classics, variants locked behind paywall».

### 4.10 Итог по SudokuPad
- **У них лучше, чем у Pundoku:**
  - Четыре режима ввода и мощный мульти-выбор.
  - Цветовая разметка.
  - Replay.
  - Нет рекламы.
- **У Pundoku лучше:**
  - Новичок получает сетку сразу.
  - Единый вход без импорта ссылок.
  - Авто-кандидаты и подсказки (в SudokuPad их нет).
  - Таймер с автопаузой (если сделаем, см. рекомендации).
  - Карточка дня и Year.
- **Взять:**
  - Идею двойной нотации (Corner и Centre) хотя бы в виде «крупные заметки в углу и центральные кандидаты» для продвинутых.
  - Двойной тап по цифре подсвечивает все такие цифры.
  - Мультивыбор через перетаскивание.
- **Избегать:**
  - Чек без указания, какие цифры неверны.
  - Таймер без автопаузы.
  - Отставание мобильной версии от веба.

---

## 5. sudoku.coach (+ родственная открытая PWA для UX-деталей)

### 5.1 Онбординг и первый запуск
- Структура обучения подтверждена по карте сайта ([sitemap](https://sudoku.coach/sitemap.xml)):
  - /learn: правила, три нотации кандидатов (box, cell, full), сложность, «computer-solver», около 40 страниц техник (naked/hidden single, locked candidate, X-Wing, Swordfish, UR, цепочки, 3D Medusa и т.д.).
  - /practice: отдельное упражнение на каждую технику.
  - /campaign, /play, /solver, /construct, /collections, /print.
  - Языки: en, de, fr, pl, pt, zh-CN. Украинского и русского в списке не вижу.
- Кампания: «practice levels, boss puzzles, Endless mode» ([Google Play, TWA](https://play.google.com/store/apps/details?id=coach.sudoku.twa&hl=en_IN), через поиск; страницу не удалось открыть).
- Первый запуск и туториал: не подтверждено.

### 5.2 Ввод цифр
- Не подтверждено для самого sudoku.coach.
- Вероятный источник (403 при открытии, атрибуция по сниппету): «works on mobile but feels more at home on a desktop or tablet». Обучающие функции, много чтения и переключения панелей тесны на маленьком телефоне ([Medium](https://medium.com/@noobsudoku67/i-spent-a-week-playing-on-4-sudoku-websites-so-you-dont-have-to-a85b978aad29)).

### 5.3 Заметки и кандидаты
- Три отдельные страницы про нотации (box, cell, full candidate) в /learn ([sitemap](https://sudoku.coach/sitemap.xml)). Сниппет поиска: авто-заполнение pencil marks. Детали ввода: не подтверждено.

### 5.4 Подсказки
- «Hint feature is mind-blowing» (отзыв на Google Play, через поиск) ([Google Play](https://play.google.com/store/apps/details?id=coach.sudoku.twa&hl=en_IN)).
- Движок «без ИИ» и техники без галлюцинаций: из [01-market.md](../../../../reports/sudoku-pwa-research/01-market.md); я первоисточник не перепроверил.
- Лесенку подсказок самого sudoku.coach не подтвердил. Её описывает родственный открытый проект (см. 5.9).

### 5.5 Ежедневка и стрики
- Не подтверждено. Вместо ежедневки заявлена кампания.

### 5.6 Статистика и достижения
- Не подтверждено.

### 5.7 Ошибки и проверка
- Не подтверждено для sudoku.coach. Родственный проект проверяет заметки: показывает пропущенные и устаревшие (см. 5.9).

### 5.8 Доступность и монетизация
- Доступность: не подтверждено.
- «100% free» без рекламы и платных функций; офлайн после одноразовой онлайн-активации (сниппеты: [Google Play](https://play.google.com/store/apps/details?id=coach.sudoku.twa&hl=en_IN), [AppBrain](https://www.appbrain.com/app/sudoku-coach/coach.sudoku.twa)).
- Баннер cookies на каждой странице ([sudoku.coach](https://sudoku.coach/en/home)). Для PWA с офлайном это раздражитель на первом экране.

### 5.9 Родственный ориентир: `conteit/sudoku-coach` (открытая PWA; другой проект)
Факты по README ([GitHub](https://github.com/conteit/sudoku-coach)):
- Лесенка подсказок: «region → technique name → exact cells → full walk-through». Цифра не раскрывается.
- Pencil marks в фиксированной мини-сетке 3×3, безлимитный undo / redo, подсветка одинаковых цифр.
- Проверка заметок: коуч показывает пропущенные и устаревшие пометки с логикой.
- Режим «по одной цифре при заметках, чтобы промах тапом не записал не ту заметку».
- Играбельность с клавиатуры. Автотесты на установку, офлайн и WCAG 2 AA (axe) на реальных экранах.
- Раздел Learn: правила, что коуч скажет и чего не скажет, страница на технику.

### 5.10 Итог по sudoku.coach
- **У них лучше, чем у Pundoku:**
  - Глубина обучения: около 40 техник, практика по каждой.
  - Три объяснённые нотации кандидатов.
  - Нет рекламы.
- **У Pundoku лучше:**
  - Продуманный мобильный экран «сетка + панель в нижней половине» (по концепту 07). У sudoku.coach мобильность заявлена слабо.
  - Тихая ежедневка и Year.
  - uk и ru (в sudoku.coach не видны).
- **Взять:**
  - Лесенку «область → название техники → клетки → разбор».
  - Проверку заметок («пропущена пометка» как мягкая ошибка).
  - Автотесты доступности (axe) в Playwright.
- **Избегать:**
  - Тяжёлые панели с текстом на телефоне.
  - Cookie-баннер.

---

## 6. Смежные находки (не основные конкуренты, слабая атрибуция)

- «Sudoku Coach: Killer & Jigsaw» (Google Play): по сниппету поиска есть палитры для дальтоников (Protan, Deutan, Tritan), набор символов, дружелюбный к дислексии, пресет «cognitive-ease». Статистика: сыграно, выиграно, процент по сложностям, лучшее и среднее время, текущий и рекордный стрик, активность по неделям ([Google Play](https://play.google.com/store/apps/details?id=com.appfactory.games.gamesudoku&hl=en)). Страницу открыть не удалось, только сниппет. Это ориентир набора настроек доступности.
- `sudokucoach.app` (iOS, другой продукт): подсказки называют технику («Naked Single… Only 5 can go here»); Daily Puzzle со стриком; подписка PRO $3.99 в месяц или $29.99 в год: «Unlimited hints · Strategy coaching · Ad-free» ([сайт](https://sudokucoach.app/), [блог](https://sudokucoach.app/blog/best-sudoku-app-2026/)). Самореклама, предвзятый источник. В сниппете поиска отслеживание стрика отнесено к PRO. Антипаттерн: нельзя прятать стрик за подпиской.

---

## 7. Сводная таблица: срез × конкурент

| Срез | Brainium | Logic Wiz | SudokuPad | sudoku.coach |
|---|---|---|---|---|
| Онбординг | не подтверждено | не подтверждено | порог входа для новичков (импорт по ссылке) | глубокая обучающая зона; первый запуск не подтверждён |
| Ввод цифр | Number Painting; жалобы: убрали long press, перезапись решённой клетки, тоггл не срабатывает | sticky digit, мультивыбор; жалобы на потерю однострочной панели | 4 режима, мультивыбор, двойной тап подсвечивает цифры; на телефоне нет зума и панорамы | не подтверждено; на телефоне тесно |
| Заметки | авто-заполнение и авто-очистка; крупный шрифт (отзыв) | двойная нотация, области и правила авто-заполнения, раскраска | corner и centre и цвет; нет авто-удаления | 3 нотации кандидатов (страницы обучения); авто-заполнение (сниппет) |
| Подсказки | объясняющие; жалобы на деградацию до «trial and error» | объясняющие, называют технику | нет | сильные по отзывам; лесенка не подтверждена (подтверждена у родственной PWA) |
| Ежедневка | общий пазл, золото и серебро, только в пределах месяца | недельные темы; стрик по маркетингу | нет | нет (кампания) |
| Статистика | есть; потери данных заметны в FAQ | заявлена (время, стратегии) | Replay; багнутый таймер | не подтверждено |
| Ошибки | Auto-Check, отключаемый | несколько режимов; детали не подтверждены | Check не показывает, какая цифра неверна; conflict checker | не подтверждено; родственная PWA проверяет заметки |
| Доступность | App Store: не указано; настройки шрифта и цвета; жалобы дальтоников и пожилых | App Store: не указано; 23 языка | App Store: не указано; issue о цветах открыт | не подтверждено; родственная PWA: axe WCAG 2 AA |
| Монетизация | реклама посреди партии; $11.99 за снятие (App Store) | много рекламы в free; недавний рост; подписки | без рекламы; $2.99 за iOS; критика за отставание | бесплатно, без рекламы; cookie-баннер |

---

## 8. Топ-10 практик и анти-практик для Pundoku

Приоритет: P0 влияет на доверие к продукту или есть риск потери данных, P1 заметно улучшает ключевой цикл, P2 желательно. Это рекомендации, а не факты.

1. **P0, анти-практика: подсказка «пробуй наугад».**
   - Факт: у Brainium это главная причина падения оценок после обновления («runs out of gas leaving you with trial and error»).
   - Рек.: движок Pundoku умеет naked/hidden single, locked candidates, pairs (CLAUDE.md). На Hard и Expert он будет упираться. Когда техника вне набора, честно сказать «нужна техника вне набора», а не предлагать угадывать. Не выдавать цифру без пояснения.
2. **P0, практика: лесенка подсказок без цифры.**
   - Факты: «область → техника → клетки → разбор» ([conteit](https://github.com/conteit/sudoku-coach)); Logic Wiz называет технику ([отзывы](https://apps.apple.com/us/app/sudoku-by-logic-wiz/id6443815428?see-all=reviews&platform=iphone)).
   - Рек.: три шага вместо одного «покажи».
3. **P0, анти-практика: терять данные и привязывать их к устройству.**
   - Факты: у Brainium статьи про пропавший счёт и перенос между устройствами ([Help Center](https://brainium.helpshift.com/hc/en/7-sudoku/)); у SudokuPad нет облачной синхронизации ([отзывы](https://apps.apple.com/us/app/svens-sudokupad/id1570622073?see-all=reviews&platform=iphone)); синхронизацию хвалят у Logic Wiz.
   - Рек.: ключ восстановления показать сразу после первого решённого дня и дать проверить («вставь ключ»). Тест «очистил данные Safari, восстановил» держать в QA.
4. **P1, анти-практика: менять раскладку панели цифр после релиза.**
   - Факты: жалобы у Brainium ([justuseapp](https://justuseapp.com/en/app/418044512/sudoku/reviews)) и Logic Wiz ([Variants reviews](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853?see-all=reviews&platform=iphone)).
   - Рек.: однострочная панель 1–9 и вынос заметок / отмены в отдельный ряд зафиксировать как контракт.
5. **P1, анти-практика: возможность перезаписать решённую клетку и промахи тоггла.**
   - Факты: оба случая у Brainium ([отзывы](https://apps.apple.com/us/app/sudoku/id418044512?see-all=reviews&platform=iphone&sort=helpful)).
   - Рек.: «дано» всегда заблокировано; смена режима заметки / цифра с ясным состоянием; отклик ввода без анимации.
6. **P1, практика: авто-кандидаты с областью и правилом.**
   - Факты: Fill Candidates у Logic Wiz (область, правила, [what's new](https://apps.apple.com/us/app/sudoku-variants-by-logic-wiz/id1530683853)); авто-заполнение и авто-очистка у Brainium.
   - Рек.: один жест заполнить, одно действие undo; без рекламы и платного барьера. Авто-очистку заметок после постановки цифры — настройкой.
7. **P1, практика: number-first как опция.**
   - Факты: Number Painting (Brainium) и sticky digit (Logic Wiz).
   - Рек.: добавить опционально; по умолчанию «клетка, потом цифра».
8. **P1, практика: доступность как заметное отличие.**
   - Факты: на App Store ни один из трёх приложений не заявил поддержку доступности; жалобы дальтоников и пожилых у Brainium.
   - Рек.:
     - Отличие «дано / поставлено» по гарнитуре (уже в 07).
     - Ошибка не только цветом: добавить форму или значок.
     - Подумать о крупном режиме заметок: по отзыву Brainium читаемый шрифт заметок ценится, а у нас заметки 11 pt (минимум HIG). Измерить на iPhone 16.
     - Подключить axe в Playwright (по примеру [conteit](https://github.com/conteit/sudoku-coach)).
9. **P1, анти-практика: таймер без автопаузы и проверка без указания ошибки.**
   - Факты: таймер SudokuPad не встаёт на паузу при уходе из приложения ([отзывы](https://apps.apple.com/us/app/svens-sudokupad/id1570622073?see-all=reviews&platform=iphone)); Check не показывает, какая цифра неверна ([Steam](https://steamcommunity.com/app/1706870/discussions/0/3422194223899817996/)).
   - Рек.: пауза по `visibilitychange`; проверка «подсвети неверные клетки» по запросу; режим без проверки — в Чернильном.
10. **P2, практика: мягкие «серебряные» дни вместо жёсткого стрика.**
    - Факты: Brainium (золото за тот же день без подсказок, серебро за остальное; только в пределах месяца, [Help Center](https://brainium.helpshift.com/hc/zh-hant/7-sudoku/faq/463-what-is-a-daily-puzzle-and-what-does-the-calendar-indicate/)); стрик за подпиской у sudokucoach.app (слабая атрибуция).
    - Рек.: Year-полотно уже решает задачу мягче. Следить, чтобы пропуск дня не «наказывался»; рассмотреть различие «в тот день / позже / с подсказкой».

Дополнительно (не в топ-10):
- Replay из SudokuPad страдает рассинхроном таймера и настроек. Таймлапс Pundoku должен воспроизводить логи ходов без зависимости от текущих настроек проверки ([issue #34](https://github.com/SudokuPad/sudokupad-web-issues/issues/34)).
- Никакой рекламы и никаких «ворот» на базовых инструментах. Fill Candidates у Logic Wiz раньше был за рекламой.

---

## 9. Что не удалось подтвердить

- Онбординг и первый запуск у всех четырёх.
- Цена и лимиты подсказок у Brainium и Logic Wiz.
- Лесенка подсказок, режимы ввода, статистика, ошибки и доступность самого sudoku.coach (JS-страницы не читаются). Нужна ручная проверка в браузере.
- VoiceOver, Dynamic Type, Reduce Motion, цветовая слепота: для всех четырёх подтверждена только запись «developer has not yet indicated» (App Store) и разрозненные отзывы.
- Механика стрика у Logic Wiz и Brainium.
- Расхождение цены Brainium Remove Ads: $11.99 / $4.99 / $2.99 в разных источниках.
- Годы части отзывов App Store («Jul 9», «Jul 28» и т.п.): в выдаче года нет.

## 10. Следующий шаг

Руками (или Playwright на веб-версиях) пройти sudoku.coach и SudokuPad на ширине 393 px: первый запуск, ввод, заметки, подсказки, масштаб элементов. Это закроет главные пробелы раздела 9.
