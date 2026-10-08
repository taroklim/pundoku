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
import type { Accusation, Blot, Digit, InkRules, Move, MoveLog, TechniqueOrBeyond } from "@pundoku/engine";
import { INK_RULES, appendMove, blotsOf, createMoveLog, inkAllows, techniqueForCell } from "@pundoku/engine";

export const CELLS = 81;

/** Запись стека undo: состояние клетки до действия (цифра + заметки целиком). */
export interface UndoEntry {
  readonly cell: number;
  readonly prevValue: number;
  readonly prevNotes: number;
  /** Для информационного поля `digit` undo-хода. */
  readonly digit?: Digit;
  /**
   * PD-119: другие клетки, которые тот же ход тронул, — `[клетка, заметки до хода]`. Это автоочистка соседей при постановке
   * цифры и «Fill candidates». Откат одним `undo` возвращает и основную клетку, и эти. Только клиентское: в лог ходов не
   * попадает (ход там один — `place` либо одна служебная `note_add`), так что движок и снапшот остаются совместимыми.
   */
  readonly also?: readonly (readonly [number, number])[];
  /** PD-119: запись — «Fill candidates» (откат не переводит выбор на `cell`: это просто первая затронутая клетка). */
  readonly fill?: true;
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
   * Чернильный режим (PD-71): включён на входе до первой цифры и после неё неизменен (`setInkMode`; заметки не в счёт, PD-121/C3).
   * Поле опциональное: `undefined`/`false` — обычная партия (старые записи читаются как раньше).
   */
  readonly ink?: boolean;
  /**
   * Глифы (PD-194, план режимов §3): партия показывается знаками вместо цифр (`glyphs.tsx`). Только рендер — правила, лог и
   * решение те же. Ставится на старте партии режима `glyphs` и не меняется. Только `true` (у обычной партии поля нет —
   * старые записи читаются как раньше), по прецеденту `ink`.
   */
  readonly glyphs?: true;
  /**
   * Мелодия (PD-201, план режимов §4): партия со звуком (нота на постановку, арпеджио юнита, мелодия пути на карточке). Правила,
   * лог и решение те же, что у Классики. Ставится на старте партии режима `melody` и не меняется. Только `true`, по прецеденту
   * `glyphs`.
   */
  readonly melody?: true;
  /**
   * Фонарь (PD-208, план режимов §5): свои цифры и заметки видны только в свете выбранной клетки (строка + столбец + блок,
   * `litCells` движка), остальное в тени. Только рендер — правила, лог, подсказки и решение те же, что у Классики. Ставится на
   * старте партии режима `lantern` и не меняется. Только `true`, по прецеденту `glyphs`/`melody`.
   */
  readonly lantern?: true;
  /**
   * Лог восстановлен из `heat` записи снапшота (`sync/schema.ts › logFromHeat`), а не сыгран: нужен
   * карточке дня, но не настоящий ход партии — не уходит в `moveLog` снапшота и не годится для Таймлапса
   * (PD-70). Отсутствует у настоящих партий.
   */
  readonly logSynthetic?: true;
  /**
   * PD-139: журнал результативных подсказок партии — `t` (мс тихого времени, шкала `log[].t`) и клетка, куда подсказка
   * вела (`null` — не называла: ошибка/вычёркивание без постановки). Нужен Таймлапсу (засечки на шкале) и карточке (полая
   * середина клетки тепловой карты). Это НЕ ход: в `log` движка подсказки не пишутся, `heatmap/summary` их не видят.
   * Опционально: старые записи и дни без подсказок — без поля.
   */
  readonly hintLog?: readonly HintEvent[];
  /**
   * Лжец (PD-171, план режимов §1.2): секрет партии — какая подсказка лжёт. `mission[liar.liarCell]` до поимки — ложная
   * цифра `liarDigit`, после верного обвинения — истинная `trueDigit` (доска «досчитывается»). **Ответ:** до поимки ни одно
   * поле отсюда не уходит в UI/DOM/aria/логи — UI читает только производные `liar.ts` (поймана ли, оправданные клетки).
   * Поле есть только у партий Лжеца; у остальных его нет (старые записи читаются как раньше).
   */
  readonly liar?: LiarSecret;
  /** Лжец: обвинения партии по порядку (`Accusation` движка, `moveIndex = log.length` в момент обвинения). Не ходы лога. */
  readonly accusations?: readonly Accusation[];
}

/** Секрет партии Лжеца (`LiarPuzzle` движка без того, что уже есть в `PlayState`). */
export interface LiarSecret {
  readonly liarCell: number;
  readonly liarDigit: Digit;
  readonly trueDigit: Digit;
  /** Честная сетка (81 символ): `mission` без лжеца. */
  readonly honestMission: string;
}

/** Запись журнала подсказок (`PlayState.hintLog`). */
export interface HintEvent {
  readonly t: number;
  readonly cell: number | null;
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

/** PD-194: партия показывается глифами. */
export const isGlyphs = (s: Pick<PlayState, "glyphs">): boolean => s.glyphs === true;

/** PD-194: пометить свежую партию режимом Глифы (до первого хода; решённую и Лжеца не трогаем — режимы не комбинируются). */
export function setGlyphMode(s: PlayState): PlayState {
  if (s.glyphs === true || s.solved || s.liar !== undefined || s.log.length > 0) return s;
  return { ...s, glyphs: true };
}

/** PD-201: партия режима Мелодия (со звуком). */
export const isMelody = (s: Pick<PlayState, "melody">): boolean => s.melody === true;

/** PD-201: пометить свежую партию режимом Мелодия (до первого хода; решённую, Лжеца и Глифы не трогаем — режимы не комбинируются). */
export function setMelodyMode(s: PlayState): PlayState {
  if (s.melody === true || s.solved || s.liar !== undefined || s.glyphs === true || s.log.length > 0) return s;
  return { ...s, melody: true };
}

/** PD-208: партия режима Фонарь. */
export const isLantern = (s: Pick<PlayState, "lantern">): boolean => s.lantern === true;

/** PD-208: пометить свежую партию режимом Фонарь (до первого хода; решённую и другие режимы не трогаем — режимы не комбинируются). */
export function setLanternMode(s: PlayState): PlayState {
  if (s.lantern === true || s.solved || s.liar !== undefined || s.ink === true || s.glyphs === true || s.melody === true || s.log.length > 0) return s;
  return { ...s, lantern: true };
}

/** Кляксы партии (пусто у обычной партии) — из лога, единственного источника. */
export const blotsIn = (s: PlayState): Blot[] => blotsOf(s.log);

/** Клетка — клякса (ink): в ней стояла неверная цифра. */
export const isBlotCell = (s: PlayState, cell: number): boolean => s.ink === true && s.log.some((m) => m.cell === cell && m.blot === true);

/**
 * Поставлена ли в партии хотя бы одна цифра (PD-121, C3). Заметки (`note_*`) и их откат ходом для режима не считаются:
 * чернила обещают «цифра необратима», а пометка карандашом остаётся стираемой и в ink (`allowNotes`), `undo` заметки
 * не добавляет правок (`replay` движка). Любой `place` — даже снятый потом `undo` — закрывает выбор: его следы в логе
 * уже были бы «стёртыми чернилами».
 */
export const hasPlacedDigit = (s: Pick<PlayState, "log">): boolean => s.log.some((m) => m.kind === "place");

/**
 * Включить/выключить Чернильный режим. Допустимо только пока в партии не поставлено ни одной цифры (заметки — не ход
 * для этого выбора, C3) и она не решена; после первой цифры режим не меняется ни в какую сторону. Иначе возвращает `s`
 * как есть. Разрешён ли режим для этого экрана (архив) — решает хранилище (`GameStore.setInk`), не логика.
 */
export function setInkMode(s: PlayState, on: boolean): PlayState {
  // Лжец × Чернила несовместимы (план режимов): клякса по `solution` выдала бы лжеца.
  if (hasPlacedDigit(s) || s.solved || isInk(s) === on || (on && s.liar !== undefined)) return s;
  if (!on) {
    const rest = { ...s };
    delete rest.ink;
    return rest;
  }
  return { ...s, ink: true };
}

/**
 * Сколько клеток ещё пусты (PD-118, решение 6.5): счёт по ПОСТАВЛЕННЫМ цифрам, не по решению — иначе «N cells left»
 * с неверной цифрой выдавал бы подсказку «эта клетка неверна» (оракул), а на полной сетке с ошибкой врал бы.
 * Неверная цифра уменьшает счётчик как любая другая; об ошибке говорит подсветка («сургуч») и фраза «Grid full».
 * «Решено» от счётчика не зависит: его определяет `solved` (`finish`, все клетки верны).
 */
export function cellsLeft(s: PlayState): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (digitAt(s, i) === 0) n++;
  return n;
}

/**
 * Сколько клеток ещё не верны (по решению; в ink заполненная клетка считается закрытой). Это НЕ счётчик экрана
 * (тот — `cellsLeft`, по поставленным цифрам, PD-118), а «сколько осталось довести до верного»: нужен там, где
 * важна правильность, — карточка брошенного дня в Year («N cells filled in correctly»).
 */
export function unsettledCells(s: PlayState): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) if (!isSettled(s, i)) n++;
  return n;
}

/** Сетка заполнена целиком, но не решена: где-то стоит неверная цифра (PD-117a). */
export const isGridFull = (s: PlayState): boolean => !s.solved && cellsLeft(s) === 0;

/**
 * Остаток по цифрам (PD-118): индекс 1..9 — 9 минус число клеток, где СТОИТ эта цифра (заданные и игрока,
 * верные и неверные); индекс 0 не используется. Не зависит от решения. Не уходит ниже 0: цифра, поставленная
 * в десятый раз (в разные юниты, ошибочно), даёт 0, а не отрицательное число.
 */
export function remaining(s: PlayState): number[] {
  const left = [0, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  for (let i = 0; i < CELLS; i++) {
    const d = digitAt(s, i);
    if (d !== 0 && left[d]! > 0) left[d]!--;
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

/** Пересчитать `solved` (все клетки закрыты). Экспорт — для обвинения Лжеца (`liar.ts`), которое тоже может закончить партию. */
export function finish(s: PlayState): PlayState {
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
 * Цифра с панели/клавиатуры (режим цифр). Повторное нажатие той же цифры в клетке — no-op (PD-115, решение владельца):
 * двойной тап по паду раньше стирал только что поставленную цифру. Стирание — только `eraseCell` (кнопка Erase,
 * Backspace/Delete). Ink: клетка с цифрой заблокирована; неверная цифра — клякса
 * (`inkBlot`): по `rules.autoReplaceBlot` клетка тут же получает верную цифру.
 */
export function enterDigit(
  s: PlayState,
  cell: number,
  digit: number,
  t: number,
  rules: InkRules = INK_RULES,
  /** PD-119: убрать поставленную цифру из заметок клеток той же строки/столбца/блока (одной записью undo). В ink не действует. */
  autoClear = false,
): PlayState {
  if (s.solved || isGiven(s, cell) || digit < 1 || digit > 9) return s;
  const ink = s.ink === true;
  if (ink && !inkAllows("place", (s.values[cell] ?? 0) !== 0, rules)) return s;
  if (s.values[cell] === digit) return s;
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
  // Автоочистка зависит только от того, что стоит на доске, а не от верности цифры: иначе «заметки не тронулись» выдавало бы
  // ошибку (оракул). Верная и неверная цифра чистят соседей одинаково.
  const cleared = autoClear && !ink ? clearPeerNotes(s, cell, digit) : null;
  const next: PlayState = {
    ...s,
    values: withCell(s.values, cell, digit),
    notes: cleared ? cleared.notes : withCell(s.notes, cell, 0),
    log: push(s, move),
    // В ink undo нет — стек не ведём: кнопка «Отменить» в UI не должна оживать.
    undoStack: ink
      ? s.undoStack
      : [
          ...s.undoStack,
          {
            cell,
            prevValue: s.values[cell] ?? 0,
            prevNotes: s.notes[cell] ?? 0,
            digit: d,
            ...(cleared && cleared.also.length > 0 ? { also: cleared.also } : {}),
          },
        ],
  };
  return finish(next);
}

/** Клетки той же строки, столбца и блока, что и `cell` (без неё самой), по возрастанию номера. */
export function peersOf(cell: number): number[] {
  const r = Math.floor(cell / 9);
  const c = cell % 9;
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (i === cell) continue;
    const ir = Math.floor(i / 9);
    const ic = i % 9;
    if (ir === r || ic === c || (Math.floor(ir / 3) === Math.floor(r / 3) && Math.floor(ic / 3) === Math.floor(c / 3))) out.push(i);
  }
  return out;
}

/**
 * Заметки после постановки `digit` в `cell` (PD-119): своя клетка очищена, цифра убрана из заметок соседей. `also` — соседи,
 * чьи заметки реально изменились, с масками ДО хода (для undo). Только пустые клетки игрока: у остальных заметок нет.
 */
function clearPeerNotes(s: PlayState, cell: number, digit: number): { notes: number[]; also: [number, number][] } {
  const notes = withCell(s.notes, cell, 0);
  const also: [number, number][] = [];
  const bit = 1 << digit;
  for (const p of peersOf(cell)) {
    const mask = s.notes[p] ?? 0;
    if (mask & bit) {
      notes[p] = mask & ~bit;
      also.push([p, mask]);
    }
  }
  return { notes, also };
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
  const notes = withCell(s.notes, top.cell, top.prevNotes);
  for (const [c, mask] of top.also ?? []) notes[c] = mask; // PD-119: соседи/заполнение откатываются тем же шагом
  return {
    ...s,
    values: withCell(s.values, top.cell, top.prevValue),
    notes,
    log: push(s, move),
    undoStack: s.undoStack.slice(0, -1),
  };
}

/**
 * Допустимые кандидаты пустой клетки (PD-119): цифры, которых нет в её строке, столбце и блоке — по тому, что СТОИТ на доске
 * (заданные и цифры игрока, верные и неверные). Решение не используется: это не подсказка, а факт о доске. Битовая маска.
 */
export function candidatesOf(s: PlayState, cell: number): number {
  let mask = 0b1111111110;
  for (const p of peersOf(cell)) {
    const d = digitAt(s, p);
    if (d) mask &= ~(1 << d);
  }
  return mask;
}

/** Тупиковые клетки (PD-143 b): пустые, без заметок и без единого допустимого кандидата — «Fill» их пропускает. */
export function deadEndCount(s: PlayState): number {
  let n = 0;
  for (let i = 0; i < CELLS; i++) {
    if (!isGiven(s, i) && (s.values[i] ?? 0) === 0 && (s.notes[i] ?? 0) === 0 && candidatesOf(s, i) === 0) n++;
  }
  return n;
}

/**
 * «Fill candidates» (PD-119): заполнить заметки всеми допустимыми кандидатами в пустых клетках БЕЗ заметок. Клетки, где игрок уже
 * что-то написал, не трогаются — это его работа (в т. ч. намеренно вычеркнутые кандидаты). Одно действие: одна запись undo
 * (откат возвращает все клетки) и один служебный ход `note_add` в логе — он нужен только затем, чтобы стек клиента и стек
 * движка оставались зеркальными (движок заметки в расчёты не берёт). Ink и решённая партия — no-op (подсказок в чернилах нет).
 * Нечего заполнять — возвращает `s`.
 */
export function fillCandidates(s: PlayState, t: number): PlayState {
  if (s.solved || s.ink === true) return s;
  const notes = s.notes.slice();
  const changed: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (isGiven(s, i) || (s.values[i] ?? 0) !== 0 || (s.notes[i] ?? 0) !== 0) continue;
    const mask = candidatesOf(s, i);
    if (mask === 0) continue; // тупик из-за неверных цифр — писать нечего
    notes[i] = mask;
    changed.push(i);
  }
  const first = changed[0];
  if (first === undefined) return s;
  const firstDigit = notesOf(notes[first] ?? 0)[0] as Digit;
  const move: Move = { t: stamp(s, t), cell: first, kind: "note_add", digit: firstDigit };
  return {
    ...s,
    notes,
    log: push(s, move),
    undoStack: [
      ...s.undoStack,
      { cell: first, prevValue: 0, prevNotes: 0, digit: firstDigit, fill: true, also: changed.slice(1).map((c): [number, number] => [c, 0]) },
    ],
  };
}

/** Есть ли что заполнять: не чернила, не решена, и хотя бы одна пустая клетка без заметок имеет кандидатов (пункт «⋯» PD-144). */
export function canFill(s: PlayState): boolean {
  return !s.solved && s.ink !== true && fillCandidates(s, 0) !== s;
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

/**
 * M8 (PD-118): цифра «закрыта» — все девять её клеток стоят верно. Не то же, что остаток 0 на паде: остаток считается
 * по поставленным цифрам (в т.ч. неверным), а ответ M8 — «цифра собрана правильно» — подтверждает только верность.
 */
export const isDigitClosed = (s: PlayState, digit: number): boolean => digitCells(s, digit).length === 9;

/**
 * Первая ПУСТАЯ клетка (не заданная и без цифры игрока; заметки пустоту не отменяют) или `null`, если пустых нет. Раньше
 * искалась первая незаданная клетка: у начатой партии она уже заполнена, и после возврата (перезагрузка) первый же ход
 * стоил два касания (PD-147).
 */
export function firstEmptyCell(s: PlayState): number | null {
  const i = s.mission.findIndex((g, k) => g === 0 && (s.values[k] ?? 0) === 0);
  return i < 0 ? null : i;
}

/** Первая пустая клетка (для стартового выбора новой партии, где пусты все незаданные), иначе 0. */
export function firstOpenCell(s: PlayState): number {
  return firstEmptyCell(s) ?? 0;
}

/**
 * Выбор при возврате в начатую партию (PD-147; одинаков для Play, Today и архива): сохранённая клетка остаётся, только если она
 * ещё пуста (игрок оставил курсор на клетке, где продолжит), иначе — первая пустая; пустых нет (сетка заполнена, но не
 * решена) — выбора нет. Решённая партия ничего не выбирает.
 */
export function resumeSelection(s: PlayState, saved: number | null = null): number | null {
  if (s.solved) return null;
  if (saved !== null && saved >= 0 && saved < CELLS && (s.mission[saved] ?? 1) === 0 && (s.values[saved] ?? 1) === 0) return saved;
  return firstEmptyCell(s);
}
