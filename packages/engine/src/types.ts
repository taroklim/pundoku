/**
 * Публичные типы движка. Всё сериализуемо в JSON (никаких классов в данных).
 */

/** Цифра судоку. */
export type Digit = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Значение клетки: 0 — пусто, 1..9 — цифра. */
export type CellValue = 0 | Digit;

/** Индекс клетки 0..80 в порядке строк: `row * 9 + col`. */
export type Cell = number;

/** Сетка 9×9 — 81 значение в порядке строк. */
export type Grid = readonly CellValue[];

/**
 * Любое представление сетки, принимаемое публичными функциями: массив из 81 значения
 * или строка из 81 символа (`0` или `.` — пусто, `1`..`9` — цифра).
 */
export type GridInput = Grid | string;

export type Difficulty = "easy" | "medium" | "hard" | "expert";

/** Техники human-style решателя в порядке возрастания стоимости. */
export type Technique =
  | "naked_single"
  | "hidden_single"
  | "locked_candidates"
  | "naked_pair"
  | "hidden_pair";

/** Техника либо маркер «сверх реализованных техник» (решатель застрял). */
export type TechniqueOrBeyond = Technique | "beyond";

export interface Puzzle {
  /** Исходная сетка — 81 символ, `0` = пустая клетка. */
  readonly mission: string;
  /** Единственное решение — 81 цифра. */
  readonly solution: string;
  readonly difficulty: Difficulty;
  /** Seed генератора (для Today — на основе даты). */
  readonly seed: string;
  /**
   * Техники, которые понадобились human-style решателю (в порядке первого применения).
   * Для expert последним идёт `'beyond'` — решатель застрял, добито backtracking'ом.
   */
  readonly techniques: readonly TechniqueOrBeyond[];
}

/** Элиминация кандидата: «цифра `digit` не может стоять в клетке `cell`». */
export interface Elimination {
  readonly cell: Cell;
  readonly digit: Digit;
}

/** Один шаг human-style решателя. */
export interface Step {
  readonly technique: Technique;
  /** Клетка, в которую ставится цифра (singles). */
  readonly cell?: Cell;
  /** Цифра, которая ставится (singles). */
  readonly digit?: Digit;
  /** Кандидаты, которые вычёркиваются (locked candidates, pairs). */
  readonly eliminations?: readonly Elimination[];
  /** Клетки-участники паттерна (пара, линия locked candidates). */
  readonly cells?: readonly Cell[];
  /** Короткое объяснение на английском (локализация — на стороне UI). */
  readonly explanation?: string;
}

export interface HumanSolveResult {
  /** Сетка полностью решена реализованными техниками. */
  readonly solved: boolean;
  readonly steps: readonly Step[];
  /** Состояние сетки после последнего применённого шага. */
  readonly grid: Grid;
  /** Исходная сетка противоречива (клетка без кандидатов) — решения нет. */
  readonly contradiction: boolean;
}

export type MoveKind = "place" | "erase" | "note_add" | "note_remove" | "undo";

/** Ход игрока. */
export interface Move {
  /** Миллисекунды от старта партии; не убывает вдоль лога. */
  readonly t: number;
  readonly cell: Cell;
  readonly kind: MoveKind;
  /** Цифра — для place/note_add/note_remove (и для undo, если известна). */
  readonly digit?: Digit;
  /** Для place: совпала ли цифра с решением. */
  readonly correct?: boolean;
  /** Для place: техника, которой клетка выводилась в момент хода (см. `techniqueForCell`). */
  readonly technique?: TechniqueOrBeyond;
}

/** Append-only лог ходов. Сериализуем в JSON как есть. */
export type MoveLog = readonly Move[];

export type SolvingStyle = "scanner" | "blocker" | "snake" | "sniper";

export interface MoveLogSummary {
  /** Время от старта до последнего хода (мс). */
  readonly durationMs: number;
  /** Ни одной ошибки и ни одной правки. */
  readonly clean: boolean;
  /** Правки: erase, undo и перезапись уже поставленной игроком цифры. */
  readonly corrections: number;
  /** Постановки с `correct === false`. */
  readonly mistakes: number;
  /** Самая дорогая техника среди `Move.technique`; null, если техники не размечены. */
  readonly maxTechnique: TechniqueOrBeyond | null;
  /** Клетка первой постановки; null, если постановок не было. */
  readonly firstCell: Cell | null;
  /** Число постановок (`place`). */
  readonly placements: number;
  /**
   * Ровность: коэффициент вариации интервалов между постановками (σ/μ).
   * 0 — идеально ровно; чем больше, тем сильнее рывки. 0 при < 2 интервалах.
   */
  readonly evenness: number;
  /** Дисперсия интервалов между постановками, мс². */
  readonly intervalVariance: number;
}
