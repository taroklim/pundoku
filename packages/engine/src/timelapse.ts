/**
 * Таймлапс собственного прохождения (PD-70): данные и воспроизведение, без UI и рендера.
 *
 * - `timelapseFrames(log, puzzle, opts?)` — `MoveLog` → последовательность кадров состояния поля
 *   (цифры, опционально заметки) с нормализованным временем воспроизведения;
 * - `timelapseFingerprint(log, puzzle, opts?)` — «отпечаток» прохождения для PNG: на клетку порядок
 *   постановки и нормализованное время 0..1, без цифр решения.
 *
 * Семантика ходов — та же, что у клиента и `movelog.ts` (README, «Контракт undo»): `undo` отменяет
 * последнее ещё не отменённое действие (place / erase / note_add / note_remove) и возвращает клетке цифру
 * и заметки, какими они были до действия; постановка цифры и стирание очищают заметки клетки; ходы в
 * заданных клетках и заметки в клетке с цифрой состояния не меняют (но остаются записью стека — как в
 * движке). Чистые функции, детерминированы.
 */
import { assertCell, GRID_SIZE, toGrid } from "./grid.js";
import type { Cell, GridInput, Move, MoveKind, MoveLog } from "./types.js";

/** Пауза в исходном времени длиннее этого сжимается до него (мс) — разрывы «подумал / отвлёкся». */
export const DEFAULT_MAX_GAP_MS = 3000;

export interface TimelapseOptions {
  /**
   * Сжатие пауз: интервал между ходами (а также от старта до первого хода) длиннее `maxGapMs` считается
   * равным `maxGapMs`. По умолчанию {@link DEFAULT_MAX_GAP_MS}; `Infinity` — не сжимать. Целое/дробное ≥ 0.
   */
  readonly maxGapMs?: number;
  /**
   * Целевая длительность воспроизведения, мс: сжатая шкала времени масштабируется так, чтобы последний ход
   * пришёлся ровно на `durationMs`. Перекрывает `speed`. Если после сжатия весь лог в одном моменте
   * (длительность 0), кадры раскладываются равномерно по индексу хода.
   */
  readonly durationMs?: number;
  /** Скорость воспроизведения относительно сжатого времени (2 = вдвое быстрее), > 0. По умолчанию 1. */
  readonly speed?: number;
  /** Включать заметки в кадры (поле `notes`, и кадры только с изменением заметок). По умолчанию нет. */
  readonly notes?: boolean;
}

export interface TimelapseFrame {
  /** Время кадра в шкале воспроизведения, мс; кадр 0 (пустое поле) — 0; не убывает вдоль `frames`. */
  readonly t: number;
  /** Индекс хода лога, породившего кадр; −1 — начальный кадр. */
  readonly move: number;
  /** Клетка, изменённая ходом (для `undo` — откатываемая клетка по стеку); `null` у начального кадра. */
  readonly cell: Cell | null;
  /** Вид хода лога (`undo` — сам откат); `null` у начального кадра. */
  readonly kind: MoveKind | null;
  /** Поле целиком, 81 значение: подсказки + цифры игрока, 0 — пусто. */
  readonly values: readonly number[];
  /** Заметки клеток — битовые маски, бит `d` = цифра `d` (1..9). Только при `opts.notes`. */
  readonly notes?: readonly number[];
  /** Клетки игрока, в которых сейчас неверная цифра (по `Move.correct`, иначе по решению, иначе верно). */
  readonly wrong: readonly Cell[];
}

export interface Timelapse {
  /** Кадры по порядку: начальный + по одному на каждый ход, изменивший видимое состояние. */
  readonly frames: readonly TimelapseFrame[];
  /** Длительность воспроизведения, мс (время последнего хода лога; 0 у пустого лога). */
  readonly durationMs: number;
  /** Длительность исходной партии, мс (`t` последнего хода лога; 0 у пустого лога). */
  readonly sourceDurationMs: number;
}

export interface FingerprintOptions {
  /** Как в {@link TimelapseOptions.maxGapMs}. */
  readonly maxGapMs?: number;
}

/** Отпечаток клетки игрока, заполненной верно к концу лога. */
export interface FingerprintCell {
  /** Порядок финальной постановки среди всех таких клеток: 0 — первая, `placed − 1` — последняя. */
  readonly order: number;
  /** Момент финальной постановки в сжатом времени, нормированный 0..1 (0 — старт, 1 — последний ход). */
  readonly t: number;
  /** Сколько раз в клетку ставили цифру за партию (включая отменённые и перезаписанные); 1 — с первого раза. */
  readonly attempts: number;
}

export interface TimelapseFingerprint {
  /** 81 клетка в порядке строк; `null` — подсказка либо клетка не заполнена верно к концу лога. */
  readonly cells: readonly (FingerprintCell | null)[];
  /** Сколько клеток заполнено верно (= число не-`null` в `cells`). */
  readonly placed: number;
}

interface Entry {
  readonly digit: number;
  readonly ok: boolean;
  /** Индекс хода лога, которым поставлена цифра. */
  readonly index: number;
}

interface CellState {
  entry: Entry | null;
  notes: number;
}

interface StackItem {
  readonly cell: Cell;
  readonly prev: CellState;
}

function checkGap(maxGapMs: number | undefined): number {
  const v = maxGapMs ?? DEFAULT_MAX_GAP_MS;
  if (typeof v !== "number" || Number.isNaN(v) || v < 0) throw new RangeError(`maxGapMs must be >= 0, got ${String(maxGapMs)}`);
  return v;
}

/** Сжатое время каждого хода (мс от старта, нарастающим итогом): паузы режутся по `maxGapMs`, убывание `t` — в ноль. */
function compressedTimes(log: MoveLog, maxGapMs: number): number[] {
  const out: number[] = [];
  let prevT = 0;
  let acc = 0;
  for (const m of log) {
    const t = Number.isFinite(m.t) ? Math.max(m.t, prevT) : prevT;
    acc += Math.min(t - prevT, maxGapMs);
    prevT = t;
    out.push(acc);
  }
  return out;
}

interface Sim {
  readonly mission: readonly number[];
  readonly cells: CellState[];
  readonly attempts: number[];
}

/**
 * Прогон лога. `onChange(index, cell, sim)` вызывается после каждого хода, изменившего состояние клетки
 * (цифру/верность, а при `withNotes` — и заметки).
 */
function simulate(
  log: MoveLog,
  puzzle: { mission: GridInput; solution?: GridInput },
  withNotes: boolean,
  onChange: (index: number, cell: Cell, move: Move, sim: Sim) => void,
): Sim {
  const mission = toGrid(puzzle.mission);
  const solution = puzzle.solution === undefined ? null : toGrid(puzzle.solution);
  const sim: Sim = {
    mission,
    cells: Array.from({ length: GRID_SIZE }, (): CellState => ({ entry: null, notes: 0 })),
    attempts: new Array<number>(GRID_SIZE).fill(0),
  };
  const stack: StackItem[] = [];

  log.forEach((m, index) => {
    assertCell(m.cell);
    let cell = m.cell;
    const st = sim.cells[cell]!;
    if (m.kind === "undo") {
      const top = stack.pop();
      if (top === undefined) return; // нечего отменять — no-op
      cell = top.cell;
      const cur = sim.cells[cell]!;
      const before = { ...cur };
      cur.entry = top.prev.entry;
      cur.notes = top.prev.notes;
      if (visiblyDiffers(before, cur, withNotes)) onChange(index, cell, m, sim);
      return;
    }
    const before = { ...st };
    stack.push({ cell, prev: before });
    if (mission[cell] !== 0) return; // подсказку не меняют
    switch (m.kind) {
      case "place": {
        if (m.digit === undefined) return;
        const ok = m.correct ?? (solution !== null ? solution[cell] === m.digit : true);
        st.entry = { digit: m.digit, ok, index };
        st.notes = 0;
        sim.attempts[cell]!++;
        break;
      }
      case "erase":
        st.entry = null;
        st.notes = 0;
        break;
      case "note_add":
      case "note_remove": {
        if (m.digit === undefined || st.entry !== null) return; // заметка в клетке с цифрой не действует
        st.notes = m.kind === "note_add" ? st.notes | (1 << m.digit) : st.notes & ~(1 << m.digit);
        break;
      }
    }
    if (visiblyDiffers(before, st, withNotes)) onChange(index, cell, m, sim);
  });
  return sim;
}

function visiblyDiffers(a: CellState, b: CellState, withNotes: boolean): boolean {
  const ea = a.entry;
  const eb = b.entry;
  if (ea?.digit !== eb?.digit || ea?.ok !== eb?.ok) return true;
  return withNotes && a.notes !== b.notes;
}

/**
 * Кадры таймлапса по логу ходов.
 *
 * Время: сначала паузы длиннее `maxGapMs` сжимаются (в т. ч. от старта до первого хода), затем шкала
 * масштабируется по `durationMs` (последний ход ровно в `durationMs`) либо делится на `speed`. Убывающее
 * или нечисловое `t` в логе трактуется как «не раньше предыдущего» (лог читается, а не отклоняется).
 * Кадр создаётся на каждый ход, изменивший видимое состояние: `undo` даёт кадр отката, `erase` пустой клетки,
 * `undo` без стека, ходы в подсказках и (без `opts.notes`) заметки — не дают; их время в шкале сохраняется.
 * Неверные цифры попадают в кадры и в `wrong`. Пустой лог — один начальный кадр.
 *
 * @throws {RangeError} клетка хода вне 0..80; некорректные `maxGapMs`/`speed`/`durationMs`.
 */
export function timelapseFrames(
  log: MoveLog,
  puzzle: { mission: GridInput; solution?: GridInput },
  opts: TimelapseOptions = {},
): Timelapse {
  const maxGap = checkGap(opts.maxGapMs);
  const speed = opts.speed ?? 1;
  if (typeof speed !== "number" || !(speed > 0) || !Number.isFinite(speed)) throw new RangeError(`speed must be > 0, got ${String(opts.speed)}`);
  const target = opts.durationMs;
  if (target !== undefined && (typeof target !== "number" || !Number.isFinite(target) || target < 0)) {
    throw new RangeError(`durationMs must be a finite number >= 0, got ${String(target)}`);
  }
  const withNotes = opts.notes === true;

  const compressed = compressedTimes(log, maxGap);
  const total = compressed.length === 0 ? 0 : compressed[compressed.length - 1]!;
  const n = log.length;
  const playback = compressed.map((c, i) => {
    if (target !== undefined) return total > 0 ? Math.round((c * target) / total) : Math.round((target * (i + 1)) / n);
    return Math.round(c / speed);
  });
  if (target !== undefined && n > 0) playback[n - 1] = Math.round(target);
  const sourceDurationMs = n === 0 ? 0 : Math.max(0, ...log.map((m) => (Number.isFinite(m.t) ? m.t : 0)));

  const snapshot = (sim: Sim): { values: number[]; wrong: Cell[]; notes?: number[] } => {
    const values: number[] = [];
    const wrong: Cell[] = [];
    sim.cells.forEach((s, i) => {
      values.push(sim.mission[i] || s.entry?.digit || 0);
      if (s.entry && !s.entry.ok && sim.mission[i] === 0) wrong.push(i);
    });
    return withNotes ? { values, wrong, notes: sim.cells.map((s) => s.notes) } : { values, wrong };
  };

  const frames: TimelapseFrame[] = [];
  const initial = toGrid(puzzle.mission);
  frames.push({
    t: 0,
    move: -1,
    cell: null,
    kind: null,
    values: [...initial],
    ...(withNotes ? { notes: new Array<number>(GRID_SIZE).fill(0) } : {}),
    wrong: [],
  });
  simulate(log, puzzle, withNotes, (index, cell, move, sim) => {
    frames.push({ t: playback[index]!, move: index, cell, kind: move.kind, ...snapshot(sim) });
  });

  return { frames, durationMs: n === 0 ? 0 : playback[n - 1]!, sourceDurationMs };
}

/**
 * Отпечаток прохождения — данные для PNG (рендер — на стороне приложения): для каждой клетки игрока,
 * верно заполненной к концу лога, порядок финальной постановки, её время и число попыток. Цифры решения
 * не возвращаются. Время нормируется по **сжатой** шкале (паузы длиннее `maxGapMs` режутся, как в
 * таймлапсе), поэтому одна долгая пауза не сжимает всё остальное в один цвет. `null` — подсказка, пустая
 * или неверная к концу клетка (как у `heatmap`).
 *
 * @throws {RangeError} клетка хода вне 0..80; некорректный `maxGapMs`.
 */
export function timelapseFingerprint(
  log: MoveLog,
  puzzle: { mission: GridInput; solution?: GridInput },
  opts: FingerprintOptions = {},
): TimelapseFingerprint {
  const compressed = compressedTimes(log, checkGap(opts.maxGapMs));
  const total = compressed.length === 0 ? 0 : compressed[compressed.length - 1]!;
  const sim = simulate(log, puzzle, false, () => undefined);
  const placed = sim.cells
    .map((s, cell) => ({ s, cell }))
    .filter((x) => x.s.entry !== null && x.s.entry.ok && sim.mission[x.cell] === 0)
    .sort((a, b) => a.s.entry!.index - b.s.entry!.index || a.cell - b.cell);
  const cells: (FingerprintCell | null)[] = new Array<FingerprintCell | null>(GRID_SIZE).fill(null);
  placed.forEach(({ s, cell }, order) => {
    cells[cell] = {
      order,
      t: total === 0 ? 0 : compressed[s.entry!.index]! / total,
      attempts: sim.attempts[cell]!,
    };
  });
  return { cells, placed: placed.length };
}
