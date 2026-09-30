/**
 * Лог ходов игрока и метрики карточки дня (отчёт 05 §2).
 */
import { BOX_OF, COL_OF, GRID_SIZE, ROW_OF, assertCell, toGrid } from "./grid.js";
import { maxTechnique } from "./human.js";
import type { Cell, GridInput, Move, MoveLog, MoveLogSummary, SolvingStyle } from "./types.js";

export function createMoveLog(): MoveLog {
  return [];
}

/**
 * Добавляет ход, возвращая новый лог (исходный не меняется).
 * @throws {RangeError} если `t` убывает или клетка вне 0..80.
 */
export function appendMove(log: MoveLog, move: Move): MoveLog {
  assertCell(move.cell);
  const last = log[log.length - 1];
  if (last && move.t < last.t) throw new RangeError(`Move time ${move.t} is before previous ${last.t}`);
  if (move.t < 0) throw new RangeError(`Move time must be >= 0, got ${move.t}`);
  return [...log, move];
}

interface CellEntry {
  readonly t: number;
  readonly ok: boolean;
  /** Клетка — клякса Чернильного режима (неверная цифра с `blot`) либо её авто-замена. */
  readonly blot?: boolean;
}

interface Replayed {
  readonly cells: (CellEntry | null)[];
  readonly corrections: number;
  readonly effective: Move[];
}

interface StackItem {
  readonly index: number;
  readonly move: Move;
  /** Состояние клетки до действия. */
  readonly prev: CellEntry | null;
  /** Сколько правок действие добавило само по себе (перезапись / стирание). */
  readonly ownCorrections: number;
}

/**
 * Воспроизведение лога с учётом `undo` (контракт — README пакета, «Контракт undo»).
 *
 * `undo` отменяет **последнее ещё не отменённое** действие (place / erase / note_add /
 * note_remove) — стек без redo; `cell`/`digit` самого undo-хода информационные и на результат
 * не влияют. Undo при пустом стеке — no-op.
 *
 * Возвращает:
 * - `cells` — итоговое состояние клеток: момент и правильность действующей постановки либо null;
 * - `corrections` — правки по правилам контракта;
 * - `effective` — ходы, оставшиеся в силе (без undo-ходов и без отменённых ходов).
 */
function replay(log: MoveLog, okOf: (m: Move) => boolean): Replayed {
  const cells: (CellEntry | null)[] = new Array<CellEntry | null>(GRID_SIZE).fill(null);
  const stack: StackItem[] = [];
  const cancelled = new Set<number>();
  let corrections = 0;

  log.forEach((m, index) => {
    switch (m.kind) {
      case "place": {
        const prev = cells[m.cell]!;
        // Чернила (PD-71): клякса = ровно одна правка; её авто-замена верной цифрой (`blot` поверх клетки-
        // кляксы) новой правки не добавляет — иначе счёт при `autoReplaceBlot` true/false расходился бы.
        const blotMistake = m.blot === true && m.correct === false;
        const resolvesBlot = m.blot === true && !blotMistake && prev?.blot === true;
        const own = resolvesBlot ? 0 : (prev === null ? 0 : 1) + (blotMistake ? 1 : 0);
        corrections += own;
        cells[m.cell] = { t: m.t, ok: okOf(m), ...(blotMistake || resolvesBlot ? { blot: true } : {}) };
        stack.push({ index, move: m, prev, ownCorrections: own });
        break;
      }
      case "erase": {
        const prev = cells[m.cell]!;
        const own = prev === null ? 0 : 1;
        corrections += own;
        cells[m.cell] = null;
        stack.push({ index, move: m, prev, ownCorrections: own });
        break;
      }
      case "note_add":
      case "note_remove":
        stack.push({ index, move: m, prev: cells[m.cell]!, ownCorrections: 0 });
        break;
      case "undo": {
        const top = stack.pop();
        if (top === undefined) break;
        cancelled.add(top.index);
        if (top.move.kind === "place") {
          // Снятие постановки — правка (+1), а собственная правка «перезаписи» отменяется.
          cells[top.move.cell] = top.prev;
          corrections += 1 - top.ownCorrections;
        } else if (top.move.kind === "erase") {
          // Отмена стирания возвращает цифру и снимает правку стирания: итог 0.
          cells[top.move.cell] = top.prev;
          corrections -= top.ownCorrections;
        }
        break;
      }
    }
  });

  const effective = log.filter((m, i) => m.kind !== "undo" && !cancelled.has(i));
  return { cells, corrections, effective };
}

/**
 * Тепловая карта пути: для каждой клетки — момент её финального правильного заполнения,
 * нормированный к длительности партии (0 — старт, 1 — последний ход лога). `null` — подсказка
 * (given) либо клетка так и не была заполнена правильно (в конце пуста или неверна).
 *
 * `correct` берётся из хода; если поле не проставлено — сверяется с `solution`
 * (если решение передано), иначе ход считается правильным.
 *
 * `undo` учитывается по контракту: отмена стирания возвращает исходный момент заполнения,
 * отмена постановки возвращает предыдущее состояние клетки (перезаписанная цифра или пусто).
 */
export function heatmap(log: MoveLog, puzzle: { mission: GridInput; solution?: GridInput }): (number | null)[] {
  const mission = toGrid(puzzle.mission);
  const solution = puzzle.solution === undefined ? null : toGrid(puzzle.solution);
  const okOf = (m: Move): boolean =>
    m.correct ?? (solution !== null && m.digit !== undefined ? solution[m.cell] === m.digit : true);
  const { cells } = replay(log, okOf);
  const duration = durationOf(log);
  return cells.map((e, cell) => {
    if (mission[cell] !== 0 || e === null || !e.ok) return null;
    return duration === 0 ? 0 : e.t / duration;
  });
}

/** Авто-замена клетки-кляксы (Чернильный режим): верная цифра с `blot`, поставленная движком, а не игроком. */
function isBlotReplacement(m: Move): boolean {
  return m.blot === true && m.correct !== false;
}

function durationOf(log: MoveLog): number {
  return log.length === 0 ? 0 : log[log.length - 1]!.t;
}

/**
 * Сводка для карточки дня. Правила `undo` — README пакета, «Контракт undo».
 *
 * - `corrections`: стирание непустой клетки +1; перезапись поставленной цифры +1; undo
 *   постановки = +1 (и снимает её собственную «перезапись»); undo стирания снимает его +1;
 *   undo заметок и undo при пустом стеке — 0.
 * - `mistakes` липкие: постановка с `correct === false` считается, даже если её потом отменили.
 * - `placements`, `firstCell`, `maxTechnique`, `evenness` — только по действующим (не отменённым)
 *   постановкам.
 * - `durationMs` — `t` последнего хода лога, включая undo и заметки.
 * - Чернильный режим (PD-71): клякса (`place` с `blot` и `correct: false`) = 1 правка + 1 ошибка, её
 *   авто-замена (`place` с `blot`, `correct: true`) не считается постановкой игрока (`placements`,
 *   `evenness`, `solvingStyle`, `maxTechnique` её игнорируют).
 */
export function summary(log: MoveLog): MoveLogSummary {
  const { corrections, effective } = replay(log, () => true);
  let mistakes = 0;
  for (const m of log) if (m.kind === "place" && m.correct === false) mistakes++;

  let firstCell: Cell | null = null;
  let placements = 0;
  const techniques: NonNullable<Move["technique"]>[] = [];
  const times: number[] = [];
  for (const m of effective) {
    if (m.kind !== "place" || isBlotReplacement(m)) continue; // авто-замена клетки-кляксы — не действие игрока
    placements++;
    times.push(m.t);
    if (firstCell === null) firstCell = m.cell;
    if (m.technique) techniques.push(m.technique);
  }

  let intervalVariance = 0;
  let evenness = 0;
  if (times.length >= 3) {
    const intervals: number[] = [];
    for (let i = 1; i < times.length; i++) intervals.push(times[i]! - times[i - 1]!);
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    intervalVariance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    evenness = mean === 0 ? 0 : Math.sqrt(intervalVariance) / mean;
  }

  return {
    durationMs: durationOf(log),
    clean: corrections === 0 && mistakes === 0,
    corrections,
    mistakes,
    maxTechnique: maxTechnique(techniques),
    firstCell,
    placements,
    evenness,
    intervalVariance,
  };
}

/**
 * Стиль решения — простая эвристика по последовательности постановок (`place`):
 * для каждой пары соседних постановок смотрим, что их связывает, и считаем доли.
 *
 * - `scanner` — та же цифра или следующая по кругу (1→2→…→9→1): игрок идёт по цифрам.
 * - `snake` — следующая клетка примыкает к предыдущей (манхэттенское расстояние 1):
 *   движется географически.
 * - `blocker` — тот же блок 3×3: закрывает блоки.
 * - `snake` (слабый признак) — рядом (расстояние ≤ 2), но без выраженного блока.
 * - `sniper` — иначе: прыжки по доске за самыми лёгкими клетками.
 *
 * Учитываются только действующие постановки (отменённые `undo` не в счёт).
 * Побеждает первая по этому порядку доля ≥ 0.5; при < 4 постановках стиль не
 * определён и возвращается `sniper`.
 */
export function solvingStyle(log: MoveLog): SolvingStyle {
  const places = replay(log, () => true).effective.filter((m) => m.kind === "place" && !isBlotReplacement(m));
  if (places.length < 4) return "sniper";
  let sameDigit = 0;
  let sameBox = 0;
  let adjacent = 0;
  let near = 0;
  const pairs = places.length - 1;
  for (let i = 1; i < places.length; i++) {
    const a = places[i - 1]!;
    const b = places[i]!;
    if (a.digit !== undefined && b.digit !== undefined) {
      if (a.digit === b.digit || (a.digit % 9) + 1 === b.digit) sameDigit++;
    }
    if (BOX_OF[a.cell] === BOX_OF[b.cell]) sameBox++;
    const dist =
      Math.abs(ROW_OF[a.cell]! - ROW_OF[b.cell]!) + Math.abs(COL_OF[a.cell]! - COL_OF[b.cell]!);
    if (dist === 1) adjacent++;
    if (dist <= 2) near++;
  }
  if (sameDigit / pairs >= 0.5) return "scanner";
  if (adjacent / pairs >= 0.5) return "snake";
  if (sameBox / pairs >= 0.5) return "blocker";
  if (near / pairs >= 0.5) return "snake";
  return "sniper";
}
