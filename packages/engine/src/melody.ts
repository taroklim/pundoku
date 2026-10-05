/**
 * Мелодия сетки (PD-201, план режимов релиза 2 §4): данные для звука, без звука и UI.
 *
 * - `unitsCompletedBy(grid, cell)` — какие строка/столбец/блок закрыты постановкой в `cell` (все 9 клеток
 *   заполнены), с порядком клеток для арпеджио;
 * - `melodyOf(log, puzzle, opts?)` — «мелодия пути»: ноты итоговых собственных постановок в порядке пути плюс
 *   арпеджио закрытых юнитов, во времени таймлапса (паузы сжаты так же, `t` совпадает с кадрами `timelapseFrames`
 *   при тех же опциях).
 *
 * Отображение цифры в высоту ноты — на стороне приложения (web). Чистые функции, детерминированы.
 *
 * **Правило undo/исправлений.** Звучат только *итоговые* собственные постановки: для каждой клетки игрока — та
 * постановка, которая стоит в клетке к концу лога (после всех `undo`, `erase`, перезаписей; семантика — та же, что у
 * таймлапса и «Контракта undo»). Нота звучит в момент хода, поставившего эту цифру; ноты идут по возрастанию индекса
 * хода. Отменённые, стёртые и перезаписанные цифры не звучат вовсе. Чернильный режим: клякса не звучит, звучит её
 * авто-замена (это итоговая постановка клетки). Юнит «закрывается» в мелодии на итоговой постановке, последней по пути
 * среди его пустых клеток (подсказки заполнены с начала): реплей итоговых постановок по порядку на исходной сетке.
 */
import { assertCell, BOX_OF, COL_OF, ROW_OF, toGrid, UNITS } from "./grid.js";
import { finalPlacements, playbackTimes } from "./timelapse.js";
import type { Cell, CellValue, Digit, GridInput, MoveLog } from "./types.js";

export type MelodyUnitKind = "row" | "col" | "box";

/** Юнит, закрытый постановкой. */
export interface CompletedUnit {
  readonly kind: MelodyUnitKind;
  /** Номер юнита 0..8 (строка сверху вниз, столбец слева направо, блок по строкам). */
  readonly index: number;
  /**
   * 9 клеток юнита в порядке арпеджио: по порядку чтения (строка — слева направо, столбец — сверху вниз,
   * блок — по строкам слева направо).
   */
  readonly cells: readonly Cell[];
}

/**
 * Юниты (строка, столбец, блок — в этом порядке), которые содержат `cell` и полностью заполнены в `grid`.
 * Пустая `cell` ничего не закрывает — `[]`. Корректность цифр не проверяется (это делает вызывающий: в мелодии
 * пути сетка к этому моменту верна).
 *
 * @throws {RangeError} `cell` вне 0..80; некорректная `grid`.
 */
export function unitsCompletedBy(grid: GridInput, cell: Cell): CompletedUnit[] {
  assertCell(cell);
  const g = toGrid(grid);
  if (g[cell] === 0) return [];
  const candidates: [MelodyUnitKind, number, number][] = [
    ["row", ROW_OF[cell]!, ROW_OF[cell]!],
    ["col", COL_OF[cell]!, 9 + COL_OF[cell]!],
    ["box", BOX_OF[cell]!, 18 + BOX_OF[cell]!],
  ];
  const out: CompletedUnit[] = [];
  for (const [kind, index, u] of candidates) {
    const cells = [...UNITS[u]!];
    if (cells.every((c) => g[c] !== 0)) out.push({ kind, index, cells });
  }
  return out;
}

/** Нота итоговой постановки. */
export interface MelodyNote {
  /** Время в шкале воспроизведения таймлапса, мс (тот же `t`, что у кадра этого хода). */
  readonly t: number;
  readonly kind: "note";
  /** Цифра 1..9 (высота ноты выбирается в приложении). */
  readonly digit: number;
  readonly cell: Cell;
}

/** Арпеджио юнита, закрытого постановкой (сразу после её ноты, тот же `t`). */
export interface MelodyUnit {
  readonly t: number;
  readonly kind: "unit";
  /** Цифра постановки, закрывшей юнит. */
  readonly digit: number;
  /** Клетка постановки, закрывшей юнит. */
  readonly cell: Cell;
  readonly unit: MelodyUnitKind;
  readonly index: number;
  /** 9 клеток в порядке арпеджио (см. {@link CompletedUnit.cells}). */
  readonly cells: readonly Cell[];
  /** Цифры этих клеток в том же порядке. */
  readonly digits: readonly number[];
}

export type MelodyEvent = MelodyNote | MelodyUnit;

export interface MelodyOptions {
  /** Как в `TimelapseOptions.maxGapMs` (по умолчанию `DEFAULT_MAX_GAP_MS`). */
  readonly maxGapMs?: number;
  /** Как в `TimelapseOptions.durationMs`: последний ход лога ровно в `durationMs`. */
  readonly durationMs?: number;
  /** Как в `TimelapseOptions.speed`. */
  readonly speed?: number;
  /**
   * Лог синтетический — восстановлен приложением из тепловой карты, потому что настоящий `moveLog` не влез в бюджет
   * снапшота (`logFromHeat`, `play.logSynthetic`). Порядок клеток в нём есть, но пути (правок, ритма) нет — мелодии нет.
   */
  readonly synthetic?: boolean;
}

/**
 * «Мелодия пути» решённой партии. Возвращает `null` — «мелодии нет» (кнопку в UI скрыть), если:
 * лога нет (`null`/`undefined` — урезан бюджетом снапшота), лог синтетический (`opts.synthetic`), лог пуст, либо к
 * концу лога сетка не заполнена целиком верными цифрами (лог неполон — это не путь решения).
 *
 * Иначе — события по времени: на каждую итоговую постановку нота (`kind: 'note'`), за ней с тем же `t` — арпеджио
 * каждого юнита, который она закрыла (`kind: 'unit'`, строка → столбец → блок). Правило undo/исправлений — в шапке
 * модуля. Время — шкала таймлапса (`timelapseFrames` с теми же `maxGapMs`/`durationMs`/`speed`).
 *
 * @throws {RangeError} клетка хода вне 0..80; некорректные `maxGapMs`/`speed`/`durationMs`.
 */
export function melodyOf(
  log: MoveLog | null | undefined,
  puzzle: { mission: GridInput; solution?: GridInput },
  opts: MelodyOptions = {},
): MelodyEvent[] | null {
  if (log === null || log === undefined || opts.synthetic === true || log.length === 0) return null;
  const times = playbackTimes(log, opts);
  const placements = finalPlacements(log, puzzle);
  const grid: CellValue[] = [...toGrid(puzzle.mission)];
  const empty = grid.filter((v) => v === 0).length;
  if (empty === 0 || placements.length !== empty || placements.some((p) => !p.ok)) return null;

  const events: MelodyEvent[] = [];
  for (const p of placements) {
    const t = times[p.index]!;
    grid[p.cell] = p.digit as Digit;
    events.push({ t, kind: "note", digit: p.digit, cell: p.cell });
    for (const u of unitsCompletedBy(grid, p.cell)) {
      events.push({ t, kind: "unit", digit: p.digit, cell: p.cell, unit: u.kind, index: u.index, cells: u.cells, digits: u.cells.map((c) => grid[c]!) });
    }
  }
  return events;
}
