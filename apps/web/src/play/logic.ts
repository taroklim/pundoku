/**
 * Чистая логика партии Play (PD-11): ввод цифр/заметок, стирание, undo, остатки, «cells left».
 * Без DOM и React — тестируется в node (`logic.test.ts`).
 *
 * Клиент ведёт `MoveLog` движка (`@pundoku/engine`, README «Контракт undo») на каждый ход:
 * place / erase / note_add / note_remove / undo с таймингами. Стек undo клиента зеркалит стек
 * движка один в один: каждое залогированное действие — ровно одна запись стека; `undo` пишется
 * в лог только когда есть что отменять (иначе движок сделал бы no-op, а клиент — ничего).
 * Стирание пустой клетки и ввод в заданную клетку (given) — не действия: не логируются.
 *
 * Чернильный режим (PD-71): `PlayState.ink`. Правила — `@pundoku/engine` `ink.ts` (`INK_RULES`, `inkAllows`),
 * здесь только их применение к состоянию; docs/pd-71-ink-rules.md. В ink-партии `undo` и стирание цифр —
 * no-op (отвергаются самой логикой, не только UI), заполненная клетка заблокирована, ошибка — клякса.
 */
import type { Blot, Digit, InkRules, Move, MoveLog, TechniqueOrBeyond } from "@pundoku/engine";
import { INK_RULES, appendMove, blotsOf, createMoveLog, inkAllows, techniqueForCell } from "@pundoku/engine";

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
   * Чернильный режим (PD-71): включён на входе до первого хода и после первого хода неизменен (`setInkMode`).
   * Поле опциональное: `undefined`/`false` — обычная партия (старые записи читаются как раньше).
   */
  readonly ink?: boolean;
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
 * Клетка «закрыта»: верна либо (ink) заполнена — в ink-партии неверная цифра в клетке бывает только кляксой,
 * оставленной при `autoReplaceBlot = false`; такая клетка считается закрытой, иначе партия не завершилась бы.
 * Не зависит от текущего флага правил: состояние, сохранённое при другом значении флага, остаётся корректным.
 */
const isSettled = (s: PlayState, cell: number): boolean =>
  isCorrectAt(s, cell) || (s.ink === true && (s.values[cell] ?? 0) !== 0);

export const isInk = (s: PlayState): boolean => s.ink === true;

/** Кляксы партии (пусто у обычной партии) — из лога, единственного источника. */
export const blotsIn = (s: PlayState): Blot[] => blotsOf(s.log);

/** Клетка — клякса (ink): в ней стояла неверная цифра. */
export const isBlotCell = (s: PlayState, cell: number): boolean => s.ink === true && s.log.some((m) => m.cell === cell && m.blot === true);

/**
 * Включить/выключить Чернильный режим. Допустимо только пока в логе нет ни одного хода (включая заметки) и
 * партия не решена; после первого хода режим не меняется ни в какую сторону. Иначе возвращает `s` как есть.
 * Разрешён ли режим для этого экрана (архив) — решает хранилище (`GameStore.setInk`), не логика.
 */
export function setInkMode(s: PlayState, on: boolean): PlayState {
  if (s.log.length > 0 || s.solved || isInk(s) === on) return s;
  if (!on) {
    const rest = { ...s };
    delete rest.ink;
    return rest;
  }
  return { ...s, ink: true };
}

/**
 * Сколько клеток ещё не стоят на своём месте. Неверная цифра считается «осталась»:
 * ошибки подсвечиваются сразу, и «0 cells left» при нерешённой сетке был бы ложью.
 */
export function cellsLeft(s: PlayState): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (!isSettled(s, i)) n++;
  return n;
}

/** Остаток по цифрам: индекс 1..9 — сколько раз цифра ещё не поставлена верно (индекс 0 не используется). */
export function remaining(s: PlayState): number[] {
  const left = [0, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  for (let i = 0; i < CELLS; i++) {
    if (isSettled(s, i)) left[s.solution[i] as number]!--;
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
    if (!isSettled(s, i)) {
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

/**
 * Цифра с панели/клавиатуры (режим цифр): повторное нажатие той же цифры стирает её (как в макете).
 * Ink: клетка с цифрой заблокирована (и повторное нажатие не стирает); неверная цифра — клякса
 * (`inkBlot`): по `rules.autoReplaceBlot` клетка тут же получает верную цифру.
 */
export function enterDigit(s: PlayState, cell: number, digit: number, t: number, rules: InkRules = INK_RULES): PlayState {
  if (s.solved || isGiven(s, cell) || digit < 1 || digit > 9) return s;
  const ink = s.ink === true;
  if (ink && !inkAllows("place", (s.values[cell] ?? 0) !== 0, rules)) return s;
  if (!ink && s.values[cell] === digit) return eraseCell(s, cell, t);
  const d = digit as Digit;
  const correct = s.solution[cell] === digit;
  if (ink && !correct) return finish(inkBlot(s, cell, d, t, rules));
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
    // В ink undo нет — стек не ведём: кнопка «Отменить» в UI не должна оживать.
    undoStack: ink ? s.undoStack : [...s.undoStack, { cell, prevValue: s.values[cell] ?? 0, prevNotes: s.notes[cell] ?? 0, digit: d }],
  };
  return finish(next);
}

/**
 * Ошибка в ink = клякса (PD-71): ход `place` с `correct: false, blot: true`; при `autoReplaceBlot` сразу
 * (тот же `t`) второй ход — верная цифра с `blot: true`, клетка закрыта правильно. Одна клякса = одна правка
 * (считает движок, `movelog.ts`). Клетка заблокирована, заметки в ней очищены.
 */
function inkBlot(s: PlayState, cell: number, digit: Digit, t: number, rules: InkRules): PlayState {
  const at = stamp(s, t);
  let log = push(s, { t: at, cell, kind: "place", digit, correct: false, blot: true });
  let value: number = digit;
  if (rules.autoReplaceBlot) {
    value = s.solution[cell] as number;
    log = appendMove(log, { t: at, cell, kind: "place", digit: value as Digit, correct: true, blot: true });
  }
  return { ...s, values: withCell(s.values, cell, value), notes: withCell(s.notes, cell, 0), log };
}

/** Заметка (режим карандаша): в клетке с цифрой и в заданной — не действует. */
export function toggleNote(s: PlayState, cell: number, digit: number, t: number, rules: InkRules = INK_RULES): PlayState {
  if (s.solved || isGiven(s, cell) || (s.values[cell] ?? 0) !== 0 || digit < 1 || digit > 9) return s;
  if (s.ink === true && !inkAllows("note_add", false, rules)) return s;
  const d = digit as Digit;
  const had = ((s.notes[cell] ?? 0) & (1 << digit)) !== 0;
  const move: Move = { t: stamp(s, t), cell, kind: had ? "note_remove" : "note_add", digit: d };
  return {
    ...s,
    notes: withCell(s.notes, cell, (s.notes[cell] ?? 0) ^ (1 << digit)),
    log: push(s, move),
    undoStack: s.ink === true ? s.undoStack : [...s.undoStack, { cell, prevValue: 0, prevNotes: s.notes[cell] ?? 0, digit: d }],
  };
}

/**
 * Стереть цифру и заметки клетки. Пустая клетка без заметок — не действие.
 * Ink: цифру стереть нельзя (no-op); заметки пустой клетки — можно.
 */
export function eraseCell(s: PlayState, cell: number, t: number, rules: InkRules = INK_RULES): PlayState {
  if (s.solved || isGiven(s, cell)) return s;
  const value = s.values[cell] ?? 0;
  const notes = s.notes[cell] ?? 0;
  if (value === 0 && notes === 0) return s;
  if (s.ink === true) {
    if (!inkAllows("erase", value !== 0, rules)) return s;
    return {
      ...s,
      notes: withCell(s.notes, cell, 0),
      log: push(s, { t: stamp(s, t), cell, kind: "erase" }),
    };
  }
  return {
    ...s,
    values: withCell(s.values, cell, 0),
    notes: withCell(s.notes, cell, 0),
    log: push(s, { t: stamp(s, t), cell, kind: "erase" }),
    undoStack: [...s.undoStack, { cell, prevValue: value, prevNotes: notes }],
  };
}

/** Отменить последнее действие (стек без redo, как в контракте движка). Ink: отмены нет — no-op. */
export function undo(s: PlayState, t: number, rules: InkRules = INK_RULES): PlayState {
  const top = s.undoStack[s.undoStack.length - 1];
  if (s.solved || !top) return s;
  if (s.ink === true && !inkAllows("undo", false, rules)) return s;
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

/**
 * Волна M3 по закрытым юнитам хода (PD-89): объединение клеток и «шаг» каждой — расстояние от поставленной клетки
 * по юниту наружу (позиция в строке/столбце/блоке; стаггер 26 мс на шаг рисует CSS). Клетка из нескольких юнитов
 * берёт минимальный шаг: волна идёт от поставленной цифры сразу во все собранные стороны.
 */
export function waveOf(units: readonly (readonly number[])[], origin: number): { cells: number[]; steps: number[] } {
  const best = new Map<number, number>();
  for (const unit of units) {
    const oi = unit.indexOf(origin);
    unit.forEach((cell, k) => {
      const d = oi < 0 ? k : Math.abs(k - oi);
      const prev = best.get(cell);
      if (prev === undefined || d < prev) best.set(cell, d);
    });
  }
  const cells = [...best.keys()];
  return { cells, steps: cells.map((c) => best.get(c) as number) };
}

/**
 * M8: клетки закрытой цифры (все девять на месте) в порядке постановки — сначала заданные (по номеру клетки), затем
 * цифры игрока по ходу партии (последний верный `place` в клетке). Ответ идёт от первой поставленной к последней.
 */
export function digitCells(s: PlayState, digit: number): number[] {
  const lastPlace = new Map<number, number>();
  s.log.forEach((m, k) => {
    if (m.kind === "place" && m.digit === digit) lastPlace.set(m.cell, k);
  });
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (s.solution[i] === digit && isSettled(s, i)) out.push(i);
  return out.sort((a, b) => (lastPlace.get(a) ?? -1) - (lastPlace.get(b) ?? -1) || a - b);
}

/** Первая пустая клетка (для стартового выбора), иначе 0. */
export function firstOpenCell(s: PlayState): number {
  const i = s.mission.findIndex((g) => g === 0);
  return i < 0 ? 0 : i;
}
