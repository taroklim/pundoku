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

- `generate({ difficulty, seed, maxAttempts? }) → Puzzle` — детерминированно по seed.
- `dailySeed(date, difficulty) → string` (`'2026-09-29/medium'`) и
  `dailyPuzzle(date, difficulty)` — фолбэк сетки дня, seed = дата.
- `GenerationError` — класс сложности не достигнут за `maxAttempts` (по умолчанию 100; на
  практике хватает единиц попыток).
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

**Детерминизм.** Seed-строка хэшируется в состояние xoshiro128\*\* (`prng.ts`), `Math.random`
не используется. Одна строка → байт-в-байт та же `mission` на любой платформе; тесты держат
снапшоты для `2026-09-29` и `pundoku`. Любое изменение генератора/решателя/порядка техник
меняет сетки для всех seed — это ломает «сетку дня» у тех, кто играл по фолбэку, поэтому
такие изменения версионируются осознанно.

## Производительность (Node 24, Apple Silicon, ненагруженная машина)

- `solve`/`countSolutions`: < 1 мс на сетку.
- `generate`: easy ≈ 3 мс, medium ≈ 20 мс, hard ≈ 60 мс, expert ≈ 10 мс (среднее по 40 seed;
  пики до ~200 мс). Smoke-тест: expert < 3 с.
- `techniqueForCell` для всех 81 клеток hard-сетки ≈ 15 мс.
- Полный `pnpm test` (включая 200×4 сеток в `generator.heavy.test.ts`) ≈ 20–30 с; под
  сильной нагрузкой машины дольше — heavy-тест проверяет корректность, не время.

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
