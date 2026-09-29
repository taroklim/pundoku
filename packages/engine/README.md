# @pundoku/engine

Генератор и решатель классического судоку 9×9 с логом техник и метриками карточки дня.
Чистый ES2022/TypeScript, **0 runtime-зависимостей**, без DOM и Node API — одинаково
работает в браузере (Play, фолбэк Today) и на сервере (`apps/api`). Все данные —
сериализуемые в JSON структуры, все функции чистые. Лицензия MIT.

```sh
pnpm --filter @pundoku/engine test        # vitest, включая «тяжёлый» прогон 200×4 сеток
pnpm --filter @pundoku/engine typecheck
pnpm --filter @pundoku/engine build       # dist/ (ESM + .d.ts)
```

## API (`src/index.ts`)

Полный список экспортов (всё, что есть в `src/index.ts`; ничего сверх этого публичным не считается):

| Группа | Экспорты |
| --- | --- |
| Типы данных | `Cell`, `CellValue`, `Digit`, `Grid`, `GridInput`, `Difficulty`, `Technique`, `TechniqueOrBeyond`, `Puzzle`, `Elimination`, `Step`, `HumanSolveResult` |
| Типы лога | `Move`, `MoveKind`, `MoveLog`, `MoveLogSummary`, `SolvingStyle` |
| Типы опций | `HumanSolveOptions`, `GenerateOptions` |
| Сетка (`grid.ts`) | `GRID_SIZE`, `ROW_OF`, `COL_OF`, `BOX_OF`, `UNITS`, `PEERS`, `emptyGrid`, `parseGrid`, `formatGrid`, `toGrid`, `isValidGrid`, `conflicts`, `candidates` |
| Решатель (`solver.ts`) | `solve`, `countSolutions`, `hasUniqueSolution` |
| Human-решатель (`human.ts`) | `humanSolve`, `techniqueForCell`, `rateDifficulty`, `techniquesUsed`, `techniqueTier`, `difficultyForTechnique`, `maxTechnique`, `TECHNIQUE_ORDER` |
| Генератор (`generator.ts`) | `generate`, `dailySeed`, `dailyPuzzle`, `GenerationError`, `DEFAULT_MAX_ATTEMPTS` |
| PRNG (`prng.ts`) | `Rng` — `new Rng(seed: string)`, `nextU32()`, `int(n)` (в `[0, n)`), `shuffle(arr)` (Фишер–Йейтс на месте) |
| Лог ходов (`movelog.ts`) | `createMoveLog`, `appendMove`, `heatmap`, `summary`, `solvingStyle` |
| Константы | `DIFFICULTIES` — `['easy', 'medium', 'hard', 'expert']` |

Константы геометрии — `Uint8Array`/массивы `Uint8Array` (`ROW_OF[cell]`, `UNITS[i]`, `PEERS[cell]`);
`GRID_SIZE = 81`; `TECHNIQUE_ORDER` — техники от дешёвой к дорогой.

### Типы

| Тип | Что это |
| --- | --- |
| `Digit` | `1..9` |
| `CellValue` | `0 \| Digit` (0 — пусто) |
| `Cell` | индекс клетки `0..80` (`row * 9 + col`) |
| `Grid` | `readonly CellValue[]`, 81 значение |
| `GridInput` | `Grid \| string` — все функции принимают и массив, и строку из 81 символа (`0`/`.` — пусто) |
| `Difficulty` | `'easy' \| 'medium' \| 'hard' \| 'expert'` |
| `Technique` | `'naked_single' \| 'hidden_single' \| 'locked_candidates' \| 'naked_pair' \| 'hidden_pair'` |
| `TechniqueOrBeyond` | `Technique \| 'beyond'` — `beyond` = нужно что-то сверх реализованных техник |
| `Puzzle` | `{ mission, givens, solution, difficulty, seed, techniques }` — `mission`/`solution` строки по 81 символу, `givens` — то же, что `mission`, массивом (контракт с `apps/api`) |
| `Step` | `{ technique, cell?, digit?, eliminations?: {cell, digit}[], cells?, explanation? }` |
| `Move` / `MoveLog` | ход игрока и append-only лог ходов (см. ниже) |

### Сетка и валидация (`grid.ts`)

- `parseGrid(str)`, `formatGrid(grid)`, `toGrid(input)`, `emptyGrid()`.
- `isValidGrid(input)` — 81 значение 0..9 без конфликтов (решаемость не проверяет).
- `conflicts(input) → Cell[]` — все клетки, участвующие в дубликате по строке/столбцу/блоку.
- `candidates(input, cell) → Digit[]` — цифры, не встречающиеся у соседей; для занятой клетки `[]`.
- Геометрия: `ROW_OF`, `COL_OF`, `BOX_OF`, `UNITS` (27 юнитов), `PEERS` (20 соседей).

### Решатель на единственность (`solver.ts`)

Бит-масочный backtracking с выбором клетки с минимумом кандидатов. Любая валидная 9×9 —
доли миллисекунды.

- `solve(input) → Grid | null`.
- `countSolutions(input, limit = 2) → number` — 0 / 1 / ≥ 2 (останавливается на `limit`).
- `hasUniqueSolution(input)`.

### Human-style решатель (`human.ts`)

- `humanSolve(input, { maxTechnique? }) → { solved, steps, grid, contradiction }` — применяет
  техники от дешёвой к дорогой (`TECHNIQUE_ORDER`), каждый шаг в `steps`. `solved === false` —
  застрял (нужна техника сверх реализованных) либо сетка противоречива.
- `techniqueForCell(input, cell) → TechniqueOrBeyond` — минимальный ярус техник, которым клетка
  выводится в текущем состоянии сетки (ярусы подключаются по очереди: если хватает naked
  singles — `naked_single`, если нужны ещё hidden singles — `hidden_single`, и т. д.). Если клетка
  уже заполнена — оценивается как пустая, так что можно вызывать и до, и после хода игрока.
  Это метрика «применённая техника» карточки дня (отчёт 05 §2 п. 4).
- `rateDifficulty(input) → Difficulty`, `techniquesUsed(input)`, `techniqueTier(t)`,
  `difficultyForTechnique(t)`, `maxTechnique(list)`.

### Генератор (`generator.ts`)

- `generate({ difficulty, seed, maxAttempts? }) → Puzzle` — детерминированно по seed;
  `maxAttempts` по умолчанию `DEFAULT_MAX_ATTEMPTS` = 300.
- `dailySeed(date, difficulty) → string` (`'2026-09-29/medium'`) и
  `dailyPuzzle(date, difficulty)` — фолбэк сетки дня.
  **Единая seed-конвенция сетки дня:** и сервер (`apps/api`), и офлайн-клиент получают фолбэк
  только через `dailyPuzzle(date, difficulty)` (или `generate({ seed: dailySeed(date, difficulty) })`).
  Seed вручную не собирать: `generate({ seed: '2026-09-29' })` — это ДРУГАЯ сетка, и клиент без
  сети разошёлся бы с закэшированной сервером. Дата валидируется (`RangeError` на `2026-02-30`).
  Сложность фолбэка на сервере — `DAILY_FALLBACK_DIFFICULTY` (по умолчанию `hard`), клиент обязан
  брать ту же (её отдаёт `GET /api/daily/:date` в поле `difficulty`).
- `GenerationError` — класс сложности не достигнут за `maxAttempts` (по умолчанию 300; медиана —
  единицы попыток, максимум по замеру — десятки, см. «Попытки и время генерации»).
- `Rng` — PRNG xoshiro128\*\* от строкового seed (экспортирован для тестов/отладки).

### Лог ходов и карточка дня (`movelog.ts`)

`Move = { t, cell, kind: 'place' | 'erase' | 'note_add' | 'note_remove' | 'undo', digit?, correct?, technique? }`,
`t` — мс от старта, не убывает. `createMoveLog()`, `appendMove(log, move)` (возвращает новый лог).

- `heatmap(log, { mission, solution? }) → (number | null)[]` — момент финального правильного
  заполнения каждой клетки, нормированный к длительности (0..1); `null` — подсказка либо клетка
  так и не заполнена правильно. `correct` берётся из хода, иначе сверяется с `solution`.
- `summary(log) → { durationMs, clean, corrections, mistakes, maxTechnique, firstCell, placements, evenness, intervalVariance }`
  — `corrections` = erase + undo + перезапись поставленной цифры; `mistakes` = постановки с
  `correct === false`; `clean` = ни того, ни другого; `evenness` = коэффициент вариации
  интервалов между постановками (0 — ровно), `intervalVariance` — их дисперсия в мс².
- `solvingStyle(log) → 'scanner' | 'blocker' | 'snake' | 'sniper'` — по долям пар соседних
  постановок: та же/следующая цифра (сканер) → примыкающие клетки (змейка) → тот же блок
  (блочник) → рядом, ≤ 2 (змейка) → иначе снайпер; порог 0.5, при < 4 постановках — снайпер.
  Подробности в JSDoc.

### Контракт undo

`undo` — ход лога `{ t, cell, kind: 'undo' }`, отменяющий **последнее ещё не отменённое действие**
(`place` / `erase` / `note_add` / `note_remove`). Модель — стек без redo:

- Что именно отменяется, определяет движок по стеку; `cell`/`digit` самого `undo`-хода
  информационные (клиент может писать сюда откатываемую клетку) и на результат **не влияют**.
- `undo` при пустом стеке (нечего отменять) — no-op, но `t` такого хода входит в `durationMs`.
- Отменённое действие выпадает из метрик, как будто его не было (кроме `corrections` и
  `mistakes`, см. ниже). `undo` сам никогда не попадает в `placements`.
- Повторные `undo` идут вглубь стека: n подряд `undo` откатывают n последних действий.
  Redo нет — отменённое действие можно только совершить заново новым ходом.

**Влияние на метрики:**

| Метрика | Правило |
| --- | --- |
| `corrections` | стирание непустой клетки **+1**; перезапись уже поставленной цифры **+1**; `undo` постановки **+1** (и снимает её собственную «перезапись»: если постановка сама была перезаписью, суммарно она остаётся одной правкой); `undo` стирания **снимает его +1** (итог 0); `undo` заметок (`note_add`/`note_remove`) и `undo` при пустом стеке — 0. Стирание пустой клетки — 0. |
| `clean` | `corrections === 0 && mistakes === 0` |
| `mistakes` | «липкие»: постановка с `correct === false` считается, даже если её потом отменили (ошибка была сделана) |
| `placements`, `firstCell`, `maxTechnique`, `evenness`, `intervalVariance` | только по **действующим** (не отменённым) постановкам |
| `durationMs` | `t` последнего хода лога — включая `undo` и заметки |
| `heatmap` | итоговое состояние клеток после воспроизведения: отмена стирания возвращает **исходный** момент заполнения, отмена постановки возвращает предыдущее состояние клетки (перезаписанная цифра с её временем или пусто) |
| `solvingStyle` | только по действующим постановкам |

**Цепочки** (клетка пустая, `t` растёт, все постановки верные; `c` = `corrections`):

| Лог | `c` | `clean` | `placements` | `heatmap[cell]` |
| --- | --- | --- | --- | --- |
| `place, undo` | 1 | нет | 0 | `null` |
| `place, erase` | 1 | нет | 1 | `null` |
| `place, erase, undo` | **0** | **да** | 1 | момент исходной постановки |
| `place, erase, undo, undo` | 1 | нет | 0 | `null` (второй `undo` снял саму постановку) |
| `place(5), place(6)` (перезапись) | 1 | нет | 2 | момент второй постановки |
| `place(5), place(6), undo` | 1 | нет | 1 | момент первой постановки (цифра 5 возвращена) |
| `place(5), place(6), undo, undo` | 2 | нет | 0 | `null` |
| `note_add, undo` | 0 | да | 0 | `null` |
| `place(другая клетка), note_add, undo` | 0 | да | 1 | — |
| `undo` (лог пуст) | 0 | да | 0 | `null` |
| `place(wrong), undo` | 1 | нет (`mistakes` = 1, липкая) | 0 | `null` |
| `erase` пустой клетки, `undo` | 0 | да | 0 | `null` |

Все строки таблицы проверены тестами в `movelog.test.ts`.

## Как определяется сложность

Не числом подсказок, а **набором техник, которые понадобились human-style решателю**
(дешёвая применяется первой; ярлык — по самой дорогой):

| Сложность | Самая дорогая техника |
| --- | --- |
| easy | naked single / hidden single |
| medium | locked candidates (pointing + claiming) |
| hard | naked pair / hidden pair |
| expert | решатель застрял (`'beyond'`) — сетка требует X-Wing и выше; решение добивается backtracking'ом |

Генератор: случайная полная сетка (backtracking с перемешанным порядком цифр) → вычитание
клеток в случайном порядке; удаление принимается, только если решение остаётся единственным
и (для easy/medium/hard) сетка всё ещё решается техниками не дороже потолка класса.
Вычитание останавливается, когда подсказок ≤ порога класса (easy 38, medium 32, hard 28,
expert 26) и сложность попала в класс; иначе — новая попытка с той же PRNG-последовательностью.
Симметрия не накладывается. Типичные размеры: easy ≈ 38 подсказок, medium/hard/expert ≈ 26.

**Детерминизм.** Seed-строка `${seed}\0${difficulty}` (разделитель — символ NUL, в исходнике
записан escape-последовательностью `\0`; менять на пробел/другой символ нельзя — поменяются все сетки)
хэшируется в состояние xoshiro128\*\* (`prng.ts`), `Math.random` не используется. Одна строка → байт-в-байт та же `mission` на любой платформе; тесты держат
снапшоты для `2026-09-29` и `pundoku`. Любое изменение генератора/решателя/порядка техник
меняет сетки для всех seed — это ломает «сетку дня» у тех, кто играл по фолбэку, поэтому
такие изменения версионируются осознанно.

## Попытки и время генерации (замер 2026-09-29)

Генерация — цикл попыток: каждая строит полную сетку и вычитает клетки; если класс сложности не
попал в цель, следующая попытка продолжает тот же PRNG-поток (поэтому детерминизм сохраняется, а
потолок `maxAttempts` не влияет на результат, пока он не исчерпан). Замер `generateWithStats`
(Node 24, Apple Silicon, seed `measure-N`/`measure2-N`; hard — 12 000 seed, остальные — 2000):

| Сложность | Попыток: медиана / p90 / p99 / max | Время: медиана / p99 |
| --- | --- | --- |
| easy | 1 / 1 / 1 / 1 | ≈ 1 мс / ≈ 15 мс |
| medium | 3 / 8 / 16 / 25 | ≈ 15–25 мс / ≈ 165–270 мс |
| hard | **6 / 19 / 37 / 77** (p99.9 = 57) | ≈ 35 мс / ≈ 380 мс |
| expert | 2 / 5 / 9 / 15 | ≈ 10 мс / ≈ 100 мс |

Хвост hard — самый тяжёлый (одиночные seed до ~75 попыток и ~2 с на нагруженной машине). Прежний
потолок 100 был на грани, поэтому дефолт `maxAttempts` поднят до **300** (`DEFAULT_MAX_ATTEMPTS`,
запас ≈ 4× к худшему из замеров). Подъём потолка сетки не меняет: тест `generate — maxAttempts`
проверяет, что seed с 74 попытками (`measure2-811`, hard) даёт ту же сетку при любом потолке ≥ 74
и `GenerationError` при потолке 73, а снапшоты сеток остались прежними. `generateWithStats(options)`
(экспорт модуля `generator.ts`, не `index.ts`) возвращает `{ puzzle, attempts }` для повторения замера.

## Производительность (Node 24, Apple Silicon, ненагруженная машина)

- `solve`/`countSolutions`: < 1 мс на сетку.
- `generate`: среднее по замеру выше — easy ≈ 2 мс, medium ≈ 25–45 мс, hard ≈ 60–110 мс,
  expert ≈ 12–18 мс. Smoke-тест: expert < 3 с.
- `techniqueForCell` для всех 81 клеток hard-сетки ≈ 15 мс.
- Полный `pnpm test` движка (включая 200×4 сеток в `generator.heavy.test.ts`) ≈ 75 с по факту
  (замер QA PD-15; hard-класс — основная доля), под нагрузкой машины дольше — heavy-тест
  проверяет корректность, не время. Таймаут heavy-кейсов — 180 с на класс.

## Лицензии

- Весь код пакета — собственный, MIT. Runtime-зависимостей нет (`sudoku-core` не подключён:
  собственная реализация оказалась проще и даёт полный контроль над логом техник и
  детерминизмом).
- Техники (naked/hidden single, locked candidates, naked/hidden pair) реализованы по их
  общеизвестным описаниям (Wikipedia «Sudoku solving algorithms», sudokuwiki.org и т. п.).
  Код HoDoKu и Sudoku Explainer (GPL) не копировался и не портировался.
- Тестовая сетка `003020600…` — Project Euler #96, сетка 01 (публичный пример).
- PRNG xoshiro128\*\* — алгоритм Блэкмана–Виньи (public domain / CC0), реализация своя.

## Что не реализовано (сознательно)

- X-Wing, Swordfish, XY-Wing, цепочки — вторая волна; сейчас всё сверх пар помечается `'beyond'`.
- Симметричное вычитание клеток.
- Оценка «SE rating»-подобным числом — только классы техник.
