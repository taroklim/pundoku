export type DailySourceKind = "sudoku.com" | "generator";

/** Строка кэша daily_puzzles. `solution` наружу не отдаётся — только для verify. */
export interface DailyPuzzle {
  date: string;
  mission: string;
  solution: string;
  difficulty: string;
  winRate: number | null;
  source: DailySourceKind;
  sourceId: string | null;
  fetchedAt: Date;
}

export type NewDailyPuzzle = Omit<DailyPuzzle, "fetchedAt">;

export interface DailyPuzzleRepo {
  find(date: string): Promise<DailyPuzzle | null>;
  /** Вставляет, если даты ещё нет; при гонке возвращает уже сохранённую строку. */
  insertIfAbsent(puzzle: NewDailyPuzzle): Promise<DailyPuzzle>;
}

/** Результат обращения к внешнему источнику сетки дня. */
export type SourceResult =
  | { kind: "ok"; puzzle: { id: string; mission: string; solution: string; difficulty: string; winRate: number | null } }
  /** Источник ответил «на эту дату ничего нет» (Sudoku.com: 204 на даты дальше завтра). */
  | { kind: "not_available" }
  | { kind: "error"; reason: string };

export interface DailyPuzzleSource {
  fetch(date: string): Promise<SourceResult>;
}

/** Генератор для фолбэка. Реализация — адаптер к @pundoku/engine (generator.ts). */
export interface PuzzleGenerator {
  generate(seed: string, difficulty: string): Promise<{ mission: string; solution: string }>;
}

/** Публичный ответ GET /api/daily/:date — без solution. */
export interface DailyPuzzleResponse {
  date: string;
  mission: string;
  difficulty: string;
  winRate?: number;
  source: DailySourceKind;
}

export const MISSION_RE = /^[0-9]{81}$/;
export const SOLUTION_RE = /^[1-9]{81}$/;
