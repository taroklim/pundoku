// Собирает самодостаточный docs/ios-checklist.html из списка пунктов ниже.
// Запуск: node build-checklist.mjs   (вердикты - из прогона node selfcheck.mjs; при изменении результатов правьте status здесь)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "ios-checklist.html");

const V = "v"; // проверено командой (webkit-эмуляция)
const P = "p"; // частично
const I = "i"; // только на реальном iPhone

const GROUPS = [
  ["install", "Установка и запуск"],
  ["today", "Today (сетка дня и Grid ∞)"],
  ["play", "Play (игра пальцем)"],
  ["year", "Year и архив"],
  ["settings", "Настройки и ключ восстановления"],
  ["ink", "Чернильный режим"],
  ["timelapse", "Таймлапс и картинка-отпечаток"],
];

// id, группа, статус, что сделать, что должно получиться, что проверила команда
const ITEMS = [
  [1, "install", P, "В Safari открой pundoku.pp.ua, нажми «Поделиться» → «На экран „Домой“» и открой появившуюся иконку.", "Приложение открывается без адресной строки; иконка и название «Pundoku» верные.", "Описание приложения, название, иконки 180/192/512 и режим «отдельное приложение» на месте и отдаются сервером. Сама установка и вид иконки видны только на телефоне."],
  [2, "install", P, "Светлая тема: посмотри на нижнюю панель вкладок на экране Today.", "Панель прилегает к низу, подписи не заходят под полоску Home; Today — индиго на бледной подложке.", "С подставленными отступами выреза и полоски Home: панель у самого низа, подписи выше полоски, цвета верные. Настоящие отступы iPhone видны только на телефоне."],
  [3, "install", I, "Открой Year (или карточку дня) и прокрути экран под нижней панелью.", "Панель слегка просвечивает и размывает то, что под ней; цвет приятный, подписи читаются.", "В стилях размытие и полупрозрачная заливка заданы. Как стекло выглядит вживую — эмуляция не показывает."],
  [4, "install", P, "Включи тёмную тему (Экран и яркость → Тёмное) и открой приложение.", "Фон чёрный, панель тёмно-серая, активная вкладка светло-фиолетовая; строка состояния под часами сливается с фоном.", "Цвета фона, панели и вкладки совпадают с задуманными. Как выглядит строка состояния под часами — только на телефоне."],
  [5, "install", I, "В тёмной теме смахни приложение вверх, чтобы закрыть, и открой снова.", "Сразу чёрный экран, без светлой вспышки в первую секунду.", "Проверено лишь то, что заставка нужного размера для iPhone 16 подключена и файл отдаётся. Саму вспышку видно только на телефоне."],
  [6, "install", P, "Быстро потапай по вкладкам и дважды тапни по экрану.", "Вкладки реагируют сразу; двойной тап не увеличивает экран.", "Двойное касание-увеличение отключено, после тапов масштаб остался 1. Задержку нажатия именно в Safari эмуляция не воспроизводит."],
  [7, "install", P, "Потяни экран вверх и вниз.", "Нет «пружины»; нижняя панель не сдвигается.", "Прокрутка у самой страницы запрещена, панель при прокрутке не сдвинулась. Реакцию Safari на жест видно только на телефоне."],
  [8, "install", P, "Поверни телефон боком и запиши, что видишь.", "Панель не уезжает под вырез и полоску Home; поведение понятное (запиши его в заметке).", "В боковом положении с подставленными отступами: панель у нижнего края, горизонтальной прокрутки нет, всё содержимое доступно прокруткой."],
  [9, "install", P, "Настройки iPhone → Экран и яркость → Размер текста → максимум; открой приложение.", "Подписи вкладок остаются мелкими, заголовок растёт, ничего не ломается.", "Размер текста задавали подменой основного шрифта (от 17 до 85 пт): заголовок растёт, подписи вкладок нет, ничего не уезжает. Что iPhone правда передаёт этот размер приложению — видно только на телефоне."],
  [10, "install", P, "Универсальный доступ → Дисплей: включи «Уменьшить прозрачность» и «Увеличить контраст».", "Нижняя панель непрозрачная, тексты темнее.", "Оба режима проверены имитацией (для прозрачности подменили правило в стилях): панель непрозрачная, тексты темнее. Что iPhone сам включает эти правила от настроек — только на телефоне."],
  [11, "install", V, "Смени язык iPhone на Українська, потом на Русский; открой приложение.", "Подписи вкладок и тексты переведены, нигде не обрезаны.", "Языки uk и ru: подписи вкладок (Сьогодні/Гра/Рік, Сегодня/Игра/Год), нет обрезки на Today, Play и Year."],
  [12, "install", P, "Включи режим полёта, смахни приложение и открой его заново.", "Приложение открывается без сети и показывает сетку дня.", "Сервер остановили: приложение запустилось из кэша (36 файлов), показало Today с 81 клеткой. Установленное приложение в режиме полёта — только на телефоне."],
  [25, "install", I, "Удали приложение с экрана «Домой» и поставь заново. Тёмная тема: смахни и открой; потом то же в светлой.", "Тёмная: чёрный экран сразу, без белой вспышки. Светлая: серый (#F2F2F7), без чёрной вспышки. Если вспышка осталась — напиши.", "Заставки для светлой и тёмной темы iPhone 16 есть и подключены. Заставку iOS запоминает при установке — видно только на телефоне."],

  [13, "today", P, "Включи VoiceOver и заполняй клетки сетки по одной.", "«N cells left» озвучивается только на отметках (кратно 10 и последние 5), а не на каждую цифру; после решения не остаётся «1 cell left».", "Текст озвучки на 51 ходе: ровно 10 объявлений на нужных числах, после решения пусто. Как это звучит голосом — только на телефоне."],
  [17, "today", P, "Реши день; потом сотри данные сайта (Настройки → Safari → Дополнительно → Данные сайтов) или удали приложение; открой заново.", "Прогресс вернулся с сервера, а устройство осталось прежним при перезапуске. Полная чистка = новое устройство, данные недоступны (так и задумано).", "Когда стёрты дни на устройстве, они вернулись с сервера, код устройства прежний. Настоящую чистку в Safari и ответ «хранилище защищено» (в эмуляции — нет) видно только на телефоне."],
  [18, "today", V, "В Grid ∞ реши день до последней клетки; повтори, коснувшись экрана во время «полёта»; потом включи «Уменьшить движение».", "Последняя клетка «летит» в Grid ∞; касание сразу показывает итог; при «Уменьшить движение» вместо полёта кольцо.", "Полёт один, после посадки убирается; касание посреди даёт итог сразу; при «Уменьшить движение» полёта нет, появляется кольцо."],
  [19, "today", V, "Оставь Today открытым через полночь и вернись из фона.", "Непочатый вчерашний день сменился на новый. Начатый вчерашний доигрывается — так задумано.", "Подмена часов 23:57 → 00:03: пустой день сменился на новый, начатый остался на месте (по замыслу). Если ждёшь иного — это уже вопрос по замыслу, а не поломка."],
  [20, "today", V, "Начни игру на Today, сверни приложение и вернись; ещё раз — смахни и открой.", "Цифры, заметки и таймер на месте; таймер не идёт, пока приложение свёрнуто.", "Свёрнутость и полный перезапуск страницы: цифры и заметки восстановились, таймер в фоне не шёл, ввод после возврата работает."],
  [21, "today", I, "Поиграй в Grid ∞ и посмотри карточку дня.", "Приятное ощущение, ничего не раздражает. Запиши впечатления.", "Это оценка на глаз — только владелец."],
  [22, "today", V, "Включи режим полёта, реши день, выключи режим.", "Прогресс уходит на сервер сам, без действий (можно проверить с другого браузера).", "Без сети день на сервере не появился, карточка показана локально; после возврата сети ушёл сам за доли секунды."],

  [14, "play", V, "Если есть возможность, с крупным текстом на украинском или русском посмотри ряд кнопок «Заметки / Отменить / Стереть».", "Кнопки одной высоты, подписи не обрезаны.", "uk и ru при ширине 320 и 393 пт, текст обычный, крупный и очень крупный: кнопки одной высоты и ширины, подписи целиком."],
  [15, "play", V, "Выбери клетку с неверной цифрой (светлая и тёмная тема).", "Видны и индиговое кольцо выбора, и красно-коричневая рамка ошибки.", "В обеих темах: кольцо индиго внутри, рамка сургучного цвета 2 пт снаружи, цифра тоже сургучная."],
  [16, "play", P, "Играй пальцем: ставь цифры, заметки, отмену; сверни приложение на пару секунд.", "Попадаешь по клеткам и клавишам уверенно; таймер не идёт, пока приложение свёрнуто; движения приятные. Запиши, если мелко.", "Клетка 39 пт, клавиша 36×56 пт (меньше 44 пт по рекомендациям Apple — владелец уже решил оставить, вопрос закрыт), кнопки 115×46 пт; цифры, заметки, отмена и таймер работают. Ощущение пальцем — только на телефоне."],

  [23, "year", P, "Открой Year, тапни по месяцу и по дню; включи VoiceOver, потом «Уменьшить прозрачность» / «Увеличить контраст».", "Заголовок ниже выреза, панель не перекрывает легенду; подписи месяцев и дней читаются словами; тап по месяцу и дню удобный.", "С подставленными отступами: заголовок ниже выреза, легенда над панелью, шит месяца — диалог, ячейка дня 46 пт, подписи словами, при «уменьшить прозрачность» панель непрозрачная. Озвучка и удобство тапа — только на телефоне."],
  [24, "year", P, "Размер текста сделай крупным и открой Year.", "Подписи месяцев и легенда растут, переносятся читаемо, легенда не уходит под нижнюю панель.", "Размер задавали подменой основного шрифта (до самого крупного): подписи растут, прокрутки вбок нет, легенда над панелью. Что iPhone передаёт тот же размер — видно только на телефоне."],
  [26, "year", V, "Year → тапни прошлый непройденный день → «Play this day’s puzzle»; реши его.", "Сетка открывается и играется; решённый день в Year остаётся пропуском (late).", "Кнопка есть, сетка открывается, после решения карточка с пометкой «Played after the day…», «‹ Year» возвращает, день в Year остался пропуском."],
  [27, "year", V, "Начни архивный день, выйди и вернись: «Finish this puzzle».", "Продолжаешь с того же места.", "Ранее поставленные цифры на месте, после повторного выхода и возврата — тоже, новые сохранены."],
  [28, "year", P, "На архивном дне посмотри кнопку «‹ Year» (тянись большим пальцем).", "Кнопка достижима и не залезает под вырез / Dynamic Island.", "С подставленным вырезом: кнопка 68×44 пт, ниже выреза, не за краем. Удобство большим пальцем — только на телефоне."],
  [29, "year", P, "Включи VoiceOver на архивном дне и на карточке результата.", "Читается «solved that day» и остальные подписи понятно.", "Текст пометки на карточке архивного дня проверен. Как он озвучивается голосом — только на телефоне."],
  [30, "year", V, "Архивный день: светлая и тёмная тема, крупный текст, «Уменьшить движение», «Увеличить контраст».", "Ничего не обрезано и не ломается ни в одном режиме.", "Пройдено 8 режимов (светлая, тёмная, крупный текст, без движения, контраст, forced colors, uk и ru) на игре и на карточке: нет прокрутки вбок и обрезанного текста."],
  [31, "year", V, "Режим полёта: открой архивный день, реши, выключи режим полёта.", "День открывается и играется без сети; прогресс уходит на сервер после включения сети.", "Без сети день открылся, решён; после возврата сети решённый день ушёл на сервер сам за доли секунды."],
  [32, "year", V, "Язык Українська / Русский: посмотри архив и «solved that day».", "Тексты без обрезки.", "uk и ru при 320 пт и при очень крупном тексте: подписи, «‹ Рік»/«‹ Год», карточка — целиком."],
  [33, "year", V, "Открой адрес с датой раньше первого дня игры (…/#/day/ГГГГ-ММ-ДД).", "Показано «недоступно», как для будущей даты.", "Дата до первого дня и будущая дата дают «недоступно» без сетки; сам первый день не блокируется."],

  [34, "settings", V, "Настройки → «Создать ключ восстановления».", "Ключ показан один раз, «Скопировать» работает, читается группами, не обрезается; без «Я сохранил ключ» уход предупреждает.", "Восемь групп по 4 знака, ключ нигде не сохраняется на устройстве, после выхода не восстанавливается на экране, при самом крупном тексте не обрезан. Реальный буфер — см. пункт 38."],
  [35, "settings", P, "Сохрани ключ в «Заметки»/«Пароли», сотри данные сайта, открой приложение → «У меня есть ключ» → вставь ключ.", "Прогресс вернулся.", "Два отдельных браузерных профиля: ключ создан на первом, введён на втором — день и Grid ∞ вернулись, счётчик устройств 2. Реальные «Заметки/Пароли» и стирание данных iOS — только на телефоне."],
  [36, "settings", V, "Перевыпусти ключ; потом «Отвязать это устройство» и «Удалить ключ…».", "Старый ключ перестаёт работать; перед каждым действием подтверждение; данные на телефоне остаются.", "Старый ключ после перевыпуска даёт отказ, новый работает; отвязка и удаление просят подтверждение, данные на месте, в том числе после перезапуска. Окно перевыпуска честно говорит: новый ключ заменяет старый, уже подключённые устройства остаются подключёнными (PD-88)."],
  [37, "settings", P, "«У меня есть ключ»: тапни поле, вставь ключ из Заметок.", "Клавиатура не закрывает кнопку «Восстановить»; экран не увеличивается; автозамена не портит ввод; вставка работает.", "Шрифт поля 17 пт (iOS не увеличивает), автозамена выключена, грязная вставка (строчные, пробелы, l/o вместо 1/0) исправляется, окно с клавиатурой имитировали: кнопка видна. Настоящая клавиатура и вставка из Заметок — только на телефоне."],
  [38, "settings", I, "Создай ключ, нажми «Скопировать» в установленном приложении и вставь в «Заметки».", "Ключ вставляется целиком; плашка «Скопировано» держится около 2 секунд.", "Проверено лишь, что приложение просит скопировать верный ключ и показывает плашку (в эмуляции она держалась около 2,7 с при задуманных 2,2 с). Попадание в настоящий буфер — только на телефоне."],
  [39, "settings", V, "Покажи ключ, не сохраняя; нажми «‹ Today».", "Появляется шит «Вы не сохранили ключ». (Часть про свайп от края устарела — смотри пункт 46.)", "Кнопка «‹ Today» при показанном ключе показывает шит."],
  [40, "settings", P, "Включи VoiceOver в Настройках: ключ, окна подтверждения, ошибки.", "Группы ключа читаются «Группа n из 8: …»; окна озвучиваются как диалоги; ошибки (неверный ключ, нет сети) объявляются.", "Подписи групп, роли диалогов, фокус и сигналы об ошибках на месте. Как они звучат голосом — только на телефоне."],
  [41, "settings", P, "Размер текста — максимум; открой Настройки со всеми окнами; посмотри низ экрана.", "Плашки ключа в один столбец, ничего не обрезано; «‹ Today» и кнопки не залезают под вырез и полоску Home.", "С подставленным вырезом и самым крупным текстом: плашки в столбец, ничего не обрезано, кнопки выше полоски Home. Настоящие отступы iPhone — только на телефоне."],
  [42, "settings", P, "Включи «Уменьшить движение», «Уменьшить прозрачность», «Увеличить контраст», тёмную тему; открой Настройки и окна.", "Окна без анимации подъёма, непрозрачные; границы блоков и кнопок видны.", "Все режимы проверены имитацией (прозрачность — подменой правила в стилях): окна без подъёма, непрозрачные, границы видны. Что iPhone сам включает правила от настроек — только на телефоне."],
  [43, "settings", V, "Язык Українська / Русский: посмотри Настройки, окна и ошибки.", "Тексты без обрезки.", "uk и ru при 17 и 23 пт во всех состояниях и окнах: ничего не обрезано, нет прокрутки вбок."],
  [44, "settings", P, "Режим полёта → открой Настройки из приложения; потом включи сеть и нажми «Повторить». Покажи ключ и попробуй закрыть/обновить приложение.", "Состояние понятно, «Повторить» работает после включения сети; при показанном ключе закрытие предупреждает — запиши, как ведёт себя iOS.", "Настройки открылись из кэша без сети, сообщение понятное, «Повторить» снова работает; закрытие страницы при показанном ключе перехватывается, без ключа — нет. Поведение iOS при смахивании — только на телефоне."],
  [45, "settings", P, "На двух устройствах (или телефон + компьютер): создай ключ на одном, введи на другом; потом «Отвязать» и «Перевыпустить».", "Данные слились; «Отвязать» и «Перевыпустить» ведут себя так, как описано в окнах: после перевыпуска другое устройство остаётся подключённым, старый ключ не работает.", "Два отдельных профиля: ключ создан, введён, данные слились, счётчик устройств обновился. Два настоящих устройства — только вы."],
  [46, "settings", P, "Покажи ключ, не сохраняй; свайпни от левого края (и нажми «назад»).", "Шит «Вы не сохранили ключ» (Остаться/Уйти), а не тихий уход; без ключа свайп свободен. Смахивание приложения не перехватывается — это известно.", "Нажатие вкладки, «назад», правка адреса, «Остаться», «Уйти», «‹ Today»: везде шит и верный итог; без ключа уход свободен. Настоящий свайп от края в установленном приложении — только на телефоне."],

  [47, "ink", V, "Today до первого хода: найди строку «Ink mode» между полем и клавишами, открой правило; то же в Play → настройка сетки.", "Строка в зазоре между полем и панелью; окно правила «Play in ink»; после первого хода строка исчезает; Undo нет, вместо ластика «Erase notes».", "Строка 361×46 пт между полем и панелью, окно-диалог с четырьмя правилами, «Not now» ничего не включает, «Play in ink» включает; после первого хода строки нет, и после перезапуска тоже; Undo нет, есть «Erase notes»; то же в Play."],
  [48, "ink", P, "В чернильном режиме поставь неверную цифру, потом с «Уменьшить движение».", "Появляется пятно со срезанным углом и сразу верная цифра; неверная исчезает не слишком быстро; пятно видно под углом и на солнце; при «Уменьшить движение» пятно без расползания.", "Пятно и срез угла есть, верная цифра сразу, неверная видна ~0,3 с, озвучка «Wrong digit…» есть, пятно закрыто для ввода; в тёмной теме, при контрасте и forced colors пятно читается; без движения только проявляется. Скорость на ощупь и читаемость на солнце — только вы."],
  [49, "timelapse", P, "Реши чернильный день, нажми «Watch your solve»: смотри девять стадий, запусти кнопкой, поводи ползунком; включи VoiceOver.", "Девять стадий читаются; анимация идёт только после «Start»; кнопки и ползунок удобны пальцем и под VoiceOver.", "Девять стадий, без движения до «Start», счёт ходов игрока верный (51), пауза/шаг/ползунок/скорость/повтор работают, кнопки не меньше 44 пт, при «Уменьшить движение» плеер пошаговый, uk/ru при крупном тексте без обрезки. Читаемость на iPhone, жест ползунком и VoiceOver — только на телефоне."],
  [50, "timelapse", P, "На карточке дня нажми «Share»: сохрани в «Фото» или отправь; потом то же в тёмной теме.", "Системный лист открывается с картинкой 1080×1350 (светлая, без цифр); разница размеров квадратов читается; в тёмной теме картинка всё равно светлая.", "Картинка PNG 1080×1350, светлая, без цифр, в тёмной теме байт в байт та же; «Share» один раз вызывает системную отправку с файлом, без неё скачивает файл. Сам лист iOS и сохранение в «Фото» — только на телефоне."],
  [51, "timelapse", I, "Посмотри картинку-отпечаток и положение кнопки «Share» на iPhone.", "Отступы и положение приятны; если нет — напиши, подгоним.", "Макет картинки сверен с файлом (поля 76 px, подпись внизу). Оценка на глаз — только вы."],
  [52, "play", I, "Открой файл design/pd81-motion-variants.html на телефоне (AirDrop → Файлы → Safari). Включи в iPhone «Универсальный доступ → Движение → Уменьшить движение» и нажми «Повторить» у любой демо-анимации.", "С включённым «Уменьшить движение» демо-анимации не прыгают и не едут — остаётся мягкая смена цвета; без него — полные движения. Это нужно для выбора варианта анимаций (PD-81), в приложении этих анимаций пока нет.", "Расчёт calc() с переменной внутри scale()/translateY() в @keyframes работает одинаково в Chromium и Playwright-webkit (при выключенном движении преобразование единичное). Работает ли так же в настоящем iOS Safari — доказать нельзя, только на телефоне."],
];

const plural = (n) => (n % 10 === 1 && n % 100 !== 11 ? "пункт" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "пункта" : "пунктов");
const total = ITEMS.length;
const nV = ITEMS.filter((x) => x[2] === V).length;
const nP = ITEMS.filter((x) => x[2] === P).length;
const nI = ITEMS.filter((x) => x[2] === I).length;
const nLeft = nP + nI;
if (total !== 52) throw new Error("ожидалось 52 пунктов, найдено " + total);
const ids = new Set(ITEMS.map((x) => x[0]));
for (let i = 1; i <= 52; i++) if (!ids.has(i)) throw new Error("нет пункта " + i);

const data = ITEMS.map(([id, group, status, doIt, expect, checked]) => ({ id, group, status, doIt, expect, checked }));

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<title>Pundoku: проверка на iPhone</title>
<style>
:root {
  color-scheme: light dark;
  --bg: #F2F2F7; --card: #FFFFFF; --text: #1C1C1E; --sub: #48484A; --line: #C6C6CC;
  --ink: #3B48B0; --on-ink: #FFFFFF; --chip-v: #DDF0E0; --chip-v-t: #14532D; --chip-p: #FFF1CC; --chip-p-t: #6B4A00; --chip-i: #E3E6FA; --chip-i-t: #232C7A;
  --warn-bg: #FBE3E0; --warn-t: #7A1E16;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000; --card: #1C1C1E; --text: #F2F2F7; --sub: #C7C7CC; --line: #48484A;
    --ink: #8C96FF; --on-ink: #0B0B20; --chip-v: #173A22; --chip-v-t: #A5E3B5; --chip-p: #43330A; --chip-p-t: #F5D98A; --chip-i: #262B5C; --chip-i-t: #C5CBFF;
    --warn-bg: #4A1D19; --warn-t: #FFB4AB;
  }
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--text);
  font: 17px/1.45 -apple-system, system-ui, "SF Pro Text", Helvetica, Arial, sans-serif;
  padding: 0 max(16px, env(safe-area-inset-right)) calc(32px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  overflow-wrap: anywhere;
}
header { padding-top: calc(16px + env(safe-area-inset-top)); }
h1 { font-size: 26px; line-height: 1.2; margin: 0 0 8px; }
h2 { font-size: 20px; line-height: 1.25; margin: 28px 0 10px; }
p { margin: 0 0 10px; }
a { color: var(--ink); text-underline-offset: 3px; }
.lead { color: var(--sub); }
.bar {
  position: sticky; top: 0; z-index: 5; margin: 12px -16px 0; padding: 10px 16px; background: var(--bg);
  border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  padding-top: calc(10px + env(safe-area-inset-top));
}
.count { font-weight: 700; font-size: 18px; }
button, summary { font: inherit; }
.btn {
  min-height: 48px; padding: 10px 18px; border-radius: 12px; border: 0; background: var(--ink); color: var(--on-ink);
  font-weight: 600; font-size: 17px; cursor: pointer;
}
.btn.sec { background: transparent; color: var(--ink); border: 1.5px solid var(--ink); }
.card { background: var(--card); border-radius: 14px; padding: 14px 16px; margin: 0 0 12px; border: 1px solid var(--line); }
.card.done-card { opacity: 0.8; }
.card.checked { border-color: var(--ink); }
.head { display: flex; gap: 10px; align-items: flex-start; margin-bottom: 8px; flex-wrap: wrap; }
.num { font-weight: 700; font-size: 17px; background: var(--ink); color: var(--on-ink); border-radius: 10px; min-width: 44px; min-height: 32px; padding: 3px 8px; text-align: center; }
.chip { display: inline-block; font-size: 16px; font-weight: 600; padding: 3px 10px; border-radius: 999px; line-height: 1.3; }
.chip.v { background: var(--chip-v); color: var(--chip-v-t); }
.chip.p { background: var(--chip-p); color: var(--chip-p-t); }
.chip.i { background: var(--chip-i); color: var(--chip-i-t); }
.lbl { font-weight: 700; display: block; font-size: 16px; color: var(--sub); margin-top: 8px; }
.team { background: var(--bg); border-radius: 10px; padding: 8px 12px; margin: 10px 0; font-size: 16px; color: var(--sub); }
.warn { background: var(--warn-bg); color: var(--warn-t); border-radius: 10px; padding: 8px 12px; margin: 10px 0; font-size: 16px; }
.chk { display: flex; align-items: center; gap: 12px; min-height: 48px; margin: 8px 0 4px; cursor: pointer; font-weight: 600; }
.chk input { width: 28px; height: 28px; flex: none; accent-color: var(--ink); margin: 0; }
textarea {
  width: 100%; min-height: 72px; font: inherit; font-size: 17px; color: var(--text); background: var(--bg);
  border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; resize: vertical;
}
details.group { margin: 18px 0; }
details.group > summary {
  list-style: none; cursor: pointer; min-height: 52px; display: flex; align-items: center; gap: 10px;
  background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 10px 16px; font-weight: 700; font-size: 18px;
}
details.group > summary::-webkit-details-marker { display: none; }
details.group > summary::before { content: "▸"; color: var(--ink); }
details.group[open] > summary::before { content: "▾"; }
details.group > .inner { margin-top: 12px; }
.sub-h { font-size: 18px; margin: 22px 0 8px; font-weight: 700; }
#result { display: none; margin-top: 12px; }
#result.show { display: block; }
#msg { min-height: 24px; font-weight: 600; margin: 8px 0 0; }
.legend { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0 0; }
.small { font-size: 16px; color: var(--sub); }
</style>
</head>
<body>
<header>
  <h1>Pundoku: проверка на iPhone</h1>
  <p>Открой <a href="https://pundoku.pp.ua">https://pundoku.pp.ua</a> в Safari и установи на экран «Домой» (пункт 1) — остальные пункты лучше проверять в установленном приложении.</p>
  <p class="lead">Команда уже проверила ${nV} из ${total} пунктов эмуляцией iPhone 16 в браузерном движке WebKit. Тебе осталось только то, что эмуляция не покрывает — ${nLeft} ${plural(nLeft)}: ${nI} целиком только на телефоне и ${nP}, где команда проверила часть, а остальное видно лишь на телефоне. У таких пунктов написано, что именно уже проверено.</p>
  <div class="legend">
    <span class="chip v">проверено командой (webkit-эмуляция)</span>
    <span class="chip p">частично</span>
    <span class="chip i">только на реальном iPhone</span>
  </div>
  <p class="small" style="margin-top:10px">Отметки и заметки сохраняются на этом телефоне. Закрывать страницу можно в любой момент.</p>
</header>

<div class="bar" role="region" aria-label="Прогресс">
  <span class="count" id="count" aria-live="polite">0 из ${nLeft}</span>
  <button class="btn" id="copy" type="button">Скопировать результат</button>
</div>
<p id="msg" role="status"></p>
<div id="result">
  <p class="small">Если кнопка не смогла скопировать, выдели текст ниже (нажми и удерживай) и выбери «Скопировать».</p>
  <textarea id="out" readonly rows="10" aria-label="Результат проверки"></textarea>
</div>

<main id="main"></main>

<script>
(function () {
  "use strict";
  var ITEMS = ${JSON.stringify(data)};
  var GROUPS = ${JSON.stringify(GROUPS)};
  var KEY = "pundoku-ios-checklist-v1";
  var STATUS = { v: "проверено командой (webkit-эмуляция)", p: "частично", i: "только на реальном iPhone" };
  var state = { checks: {}, notes: {} };
  var memoryOnly = false;
  try { var raw = localStorage.getItem(KEY); if (raw) { var p = JSON.parse(raw); state.checks = p.checks || {}; state.notes = p.notes || {}; } } catch (e) { memoryOnly = true; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { memoryOnly = true; } }

  var byId = {};
  ITEMS.forEach(function (it) { byId[it.id] = it; });
  var groupName = {};
  GROUPS.forEach(function (g) { groupName[g[0]] = g[1]; });
  function required(it) { return it.status !== "v"; }

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function card(it) {
    var c = el("article", "card" + (required(it) ? "" : " done-card"));
    c.id = "item-" + it.id;
    var head = el("div", "head");
    head.appendChild(el("span", "num", String(it.id)));
    head.appendChild(el("span", "chip " + it.status, STATUS[it.status]));
    c.appendChild(head);
    c.appendChild(el("span", "lbl", "Что сделать"));
    c.appendChild(el("p", null, it.doIt));
    c.appendChild(el("span", "lbl", "Что должно получиться"));
    c.appendChild(el("p", null, it.expect));
    var team = el("div", it.id === 36 ? "warn" : "team");
    team.appendChild(el("strong", null, it.status === "v" ? "Команда проверила: " : it.status === "p" ? "Уже проверено командой, осталась часть: " : "Что видно в эмуляции: "));
    team.appendChild(document.createTextNode(it.checked));
    c.appendChild(team);
    var lab = el("label", "chk");
    var cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state.checks[it.id];
    cb.setAttribute("data-id", it.id);
    lab.appendChild(cb);
    lab.appendChild(el("span", null, required(it) ? "Проверил, всё как должно быть" : "Проверил сам (необязательно)"));
    c.appendChild(lab);
    if (cb.checked) c.classList.add("checked");
    cb.addEventListener("change", function () {
      if (cb.checked) state.checks[it.id] = true; else delete state.checks[it.id];
      c.classList.toggle("checked", cb.checked);
      save(); update();
    });
    var ta = document.createElement("textarea");
    ta.placeholder = "Заметка: что увидел, что не так";
    ta.setAttribute("aria-label", "Заметка к пункту " + it.id);
    ta.value = state.notes[it.id] || "";
    ta.addEventListener("input", function () {
      var v = ta.value.trim();
      if (v) state.notes[it.id] = ta.value; else delete state.notes[it.id];
      save();
    });
    c.appendChild(ta);
    return c;
  }

  var main = document.getElementById("main");
  GROUPS.forEach(function (g) {
    var items = ITEMS.filter(function (it) { return it.group === g[0] && required(it); });
    if (!items.length) return;
    main.appendChild(el("h2", null, g[1]));
    items.forEach(function (it) { main.appendChild(card(it)); });
  });

  var doneItems = ITEMS.filter(function (it) { return !required(it); });
  var det = el("details", "group");
  det.id = "done-list";
  det.appendChild(el("summary", null, "Проверено командой: " + doneItems.length + " пунктов (необязательно)"));
  var inner = el("div", "inner");
  inner.appendChild(el("p", "small", "Эти пункты команда уже прогнала эмуляцией iPhone 16 (WebKit). Можно ничего здесь не делать. Если захочешь проверить сам — отметь и напиши заметку."));
  GROUPS.forEach(function (g) {
    var items = doneItems.filter(function (it) { return it.group === g[0]; });
    if (!items.length) return;
    inner.appendChild(el("div", "sub-h", g[1]));
    items.forEach(function (it) { inner.appendChild(card(it)); });
  });
  det.appendChild(inner);
  main.appendChild(det);

  var countEl = document.getElementById("count");
  function update() {
    var req = ITEMS.filter(required);
    var n = req.filter(function (it) { return state.checks[it.id]; }).length;
    countEl.textContent = n + " из " + req.length;
  }
  update();

  function buildReport() {
    var req = ITEMS.filter(required);
    var done = req.filter(function (it) { return state.checks[it.id]; });
    var open = req.filter(function (it) { return !state.checks[it.id]; });
    var lines = [];
    lines.push("Pundoku, проверка на iPhone: пройдено " + done.length + " из " + req.length);
    lines.push("");
    lines.push("Не пройдено (" + open.length + "):");
    if (!open.length) lines.push("  нет");
    open.forEach(function (it) {
      lines.push("  " + it.id + ". [" + groupName[it.group] + "] " + it.doIt);
      var note = (state.notes[it.id] || "").trim();
      if (note) lines.push("     Заметка: " + note.replace(/\\n+/g, " "));
    });
    var withNotes = ITEMS.filter(function (it) { return (state.notes[it.id] || "").trim() && (state.checks[it.id] || !required(it)); });
    lines.push("");
    lines.push("Заметки к остальным пунктам (" + withNotes.length + "):");
    if (!withNotes.length) lines.push("  нет");
    withNotes.forEach(function (it) {
      lines.push("  " + it.id + ". [" + groupName[it.group] + "] " + it.doIt);
      lines.push("     Заметка: " + (state.notes[it.id] || "").trim().replace(/\\n+/g, " "));
    });
    return lines.join("\\n");
  }

  var msg = document.getElementById("msg");
  var result = document.getElementById("result");
  var out = document.getElementById("out");
  function selectOut() {
    out.focus();
    out.select();
    try { out.setSelectionRange(0, out.value.length); } catch (e) {}
  }
  function legacyCopy() {
    try { selectOut(); return !!document.execCommand && document.execCommand("copy"); } catch (e) { return false; }
  }
  document.getElementById("copy").addEventListener("click", function () {
    var text = buildReport();
    out.value = text;
    result.classList.add("show");
    function ok() { msg.textContent = "Скопировано. Вставь в сообщение."; }
    function fallback() {
      if (legacyCopy()) ok();
      else { selectOut(); msg.textContent = "Не удалось скопировать само. Текст выделен ниже: нажми «Скопировать» в появившемся меню."; }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok, fallback);
    } else {
      fallback();
    }
  });
  if (memoryOnly) msg.textContent = "Браузер не даёт сохранять отметки между запусками: пройди за один раз и скопируй результат.";
})();
</script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`записано ${OUT}: пунктов ${total}, проверено командой ${nV}, частично ${nP}, только iPhone ${nI}, осталось владельцу ${nLeft}`);
