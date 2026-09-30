/**
 * Чистая логика партии Play (PD-11): ввод цифр/заметок, стирание, undo, остатки, «cells left».
 * Без DOM и React — тестируется в node (`logic.test.ts`).
 *
 * Клиент ведёт `MoveLog` движка (`@pundoku/engine`, README «Контракт undo») на каждый ход:
 * place / erase / note_add / note_remove / undo с таймингами. Стек undo клиента зеркалит стек
 * движка один в один: каждое залогированное действие — ровно одна запись стека; `undo` пишется
 * в лог только когда есть что отменять (иначе движок сделал бы no-op, а клиент — ничего).
 * Стирание пустой клетки и ввод в заданную клетку (given) — не действия: не логируются.
 */
import type { Digit, Move, MoveLog, TechniqueOrBeyond } from "@pundoku/engine";
import { appendMove, createMoveLog, techniqueForCell } from "@pundoku/engine";

export const CELLS = 81;

/** Запись стека undo: состояние клетки до действия (цифра + заметки целиком). */
interface UndoEntry {
  readonly cell: number;
  readonly prevValue: number;
  readonly prevNotes: number;
  /** Для информационного поля `digit` undo-хода. */
  readonly digit?: Digit;
}

export interface PlayState {
  /** Заданные клетки (givens), 0 — пусто. */
  readonly mission: readonly number[];
  readonly solution: readonly number[];
  /** Цифры игрока (0 — пусто); в заданных клетках всегда 0. */
  readonly values: readonly number[];
  /** Заметки клетки — битовая маска, бит `d` = цифра `d` (1..9). */
  readonly notes: readonly number[];
  readonly log: MoveLog;
  readonly undoStack: readonly UndoEntry[];
  readonly solved: boolean;
  /**
   * Лог восстановлен из `heat` записи снапшота (`sync/schema.ts › logFromHeat`), а не сыгран: нужен
   * карточке дня, но не настоящий ход партии — не уходит в `moveLog` снапшота и не годится для Таймлапса
   * (PD-70). Отсутствует у настоящих партий.
   */
  readonly logSynthetic?: true;
}

export function createPlay(puzzle: { mission: string; solution: string }): PlayState {
  const mission = [...puzzle.mission].map((ch) => (ch >= "1" && ch <= "9" ? Number(ch) : 0));
  const solution = [...puzzle.solution].map(Number);
  if (mission.length !== CELLS || solution.length !== CELLS) throw new RangeError("Puzzle must have 81 cells");
  return {
    mission,
    solution,
    values: new Array<number>(CELLS).fill(0),
    notes: new Array<number>(CELLS).fill(0),
    log: createMoveLog(),
    undoStack: [],
    solved: false,
  };
}

export const isGiven = (s: PlayState, cell: number): boolean => s.mission[cell] !== 0;

/** Цифра клетки — заданная или игрока; 0 — пусто. */
export const digitAt = (s: PlayState, cell: number): number => s.mission[cell] || s.values[cell] || 0;

/** Игрок поставил цифру, не совпавшую с решением (подсветка ошибки — «сургуч»). */
export const isWrong = (s: PlayState, cell: number): boolean => {
  const v = s.values[cell] ?? 0;
  return v !== 0 && v !== s.solution[cell];
};

export const notesOf = (mask: number): number[] => {
  const out: number[] = [];
  for (let d = 1; d <= 9; d++) if (mask & (1 << d)) out.push(d);
  return out;
};

const isCorrectAt = (s: PlayState, cell: number): boolean => digitAt(s, cell) === s.solution[cell];

/**
 * Сколько клеток ещё не стоят на своём месте. Неверная цифра считается «осталась»:
 * ошибки подсвечиваются сразу, и «0 cells left» при нерешённой сетке был бы ложью.
 */
export function cellsLeft(s: PlayState): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (!isCorrectAt(s, i)) n++;
  return n;
}

/** Остаток по цифрам: индекс 1..9 — сколько раз цифра ещё не поставлена верно (индекс 0 не используется). */
export function remaining(s: PlayState): number[] {
  const left = [0, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  for (let i = 0; i < CELLS; i++) {
    if (isCorrectAt(s, i)) left[s.solution[i] as number]!--;
  }
  return left;
}

/** Монотонное время хода: `t` не может убывать вдоль лога. */
function stamp(s: PlayState, t: number): number {
  const last = s.log[s.log.length - 1];
  return Math.max(0, Math.round(t), last ? last.t : 0);
}

function push(s: PlayState, move: Move): MoveLog {
  return appendMove(s.log, move);
}

function withCell(arr: readonly number[], cell: number, v: number): number[] {
  const next = arr.slice();
  next[cell] = v;
  return next;
}

function finish(s: PlayState): PlayState {
  let solved = true;
  for (let i = 0; i < CELLS; i++) {
    if (!isCorrectAt(s, i)) {
      solved = false;
      break;
    }
  }
  return solved === s.solved ? s : { ...s, solved };
}

/** Техника, которой клетка выводилась в момент хода: по givens + верным цифрам игрока. */
function techniqueOf(s: PlayState, cell: number): TechniqueOrBeyond | undefined {
  try {
    const grid = s.mission.map((g, i) => g || (s.values[i] === s.solution[i] ? (s.values[i] as number) : 0)).join("");
    return techniqueForCell(grid, cell);
  } catch {
    return undefined;
  }
}

/** Цифра с панели/клавиатуры (режим цифр): повторное нажатие той же цифры стирает её (как в макете). */
export function enterDigit(s: PlayState, cell: number, digit: number, t: number): PlayState {
  if (s.solved || isGiven(s, cell) || digit < 1 || digit > 9) return s;
  if (s.values[cell] === digit) return eraseCell(s, cell, t);
  const d = digit as Digit;
  const correct = s.solution[cell] === digit;
  const technique = correct ? techniqueOf(s, cell) : undefined;
  const move: Move = {
    t: stamp(s, t),
    cell,
    kind: "place",
    digit: d,
    correct,
    ...(technique ? { technique } : {}),
  };
  const next: PlayState = {
    ...s,
    values: withCell(s.values, cell, digit),
    notes: withCell(s.notes, cell, 0),
    log: push(s, move),
    undoStack: [...s.undoStack, { cell, prevValue: s.values[cell] ?? 0, prevNotes: s.notes[cell] ?? 0, digit: d }],
  };
  return finish(next);
}

/** Заметка (режим карандаша): в клетке с цифрой и в заданной — не действует. */
export function toggleNote(s: PlayState, cell: number, digit: number, t: number): PlayState {
  if (s.solved || isGiven(s, cell) || (s.values[cell] ?? 0) !== 0 || digit < 1 || digit > 9) return s;
  const d = digit as Digit;
  const had = ((s.notes[cell] ?? 0) & (1 << digit)) !== 0;
  const move: Move = { t: stamp(s, t), cell, kind: had ? "note_remove" : "note_add", digit: d };
  return {
    ...s,
    notes: withCell(s.notes, cell, (s.notes[cell] ?? 0) ^ (1 << digit)),
    log: push(s, move),
    undoStack: [...s.undoStack, { cell, prevValue: 0, prevNotes: s.notes[cell] ?? 0, digit: d }],
  };
}

/** Стереть цифру и заметки клетки. Пустая клетка без заметок — не действие. */
export function eraseCell(s: PlayState, cell: number, t: number): PlayState {
  if (s.solved || isGiven(s, cell)) return s;
  const value = s.values[cell] ?? 0;
  const notes = s.notes[cell] ?? 0;
  if (value === 0 && notes === 0) return s;
  return {
    ...s,
    values: withCell(s.values, cell, 0),
    notes: withCell(s.notes, cell, 0),
    log: push(s, { t: stamp(s, t), cell, kind: "erase" }),
    undoStack: [...s.undoStack, { cell, prevValue: value, prevNotes: notes }],
  };
}

/** Отменить последнее действие (стек без redo, как в контракте движка). */
export function undo(s: PlayState, t: number): PlayState {
  const top = s.undoStack[s.undoStack.length - 1];
  if (s.solved || !top) return s;
  const move: Move = { t: stamp(s, t), cell: top.cell, kind: "undo", ...(top.digit ? { digit: top.digit } : {}) };
  return {
    ...s,
    values: withCell(s.values, top.cell, top.prevValue),
    notes: withCell(s.notes, top.cell, top.prevNotes),
    log: push(s, move),
    undoStack: s.undoStack.slice(0, -1),
  };
}

/** Юниты (строка/столбец/блок) клетки, в которых все девять цифр верны — для волны M3. */
export function closedUnits(s: PlayState, cell: number): number[][] {
  const r = Math.floor(cell / 9);
  const c = cell % 9;
  const row: number[] = [];
  const col: number[] = [];
  const box: number[] = [];
  const r0 = r - (r % 3);
  const c0 = c - (c % 3);
  for (let k = 0; k < 9; k++) {
    row.push(r * 9 + k);
    col.push(k * 9 + c);
    box.push((r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3));
  }
  return [row, col, box].filter((u) => u.every((i) => isCorrectAt(s, i)));
}

/** Первая пустая клетка (для стартового выбора), иначе 0. */
export function firstOpenCell(s: PlayState): number {
  const i = s.mission.findIndex((g) => g === 0);
  return i < 0 ? 0 : i;
}
