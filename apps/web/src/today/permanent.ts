/**
 * Модель постоянной (бесконечной) сетки — Grid ∞ (PD-12). Чистые функции, без DOM/сети.
 *
 * Концепция (`07-concept-draft.md`, «Идея владельца»): у сетки с самого начала скрытое решение;
 * игрок управляет ПОЗИЦИЕЙ — клеткой последнего хода в решённой сетке дня, а цифра берётся из
 * скрытого решения. Подсказки копятся день за днём; сетка становится однозначно решаемой примерно
 * после 20–25 клеток.
 *
 * РЕШЕНИЯ DEVELOPER'А (концепция их не фиксирует; ждут подтверждения PM/владельца):
 * - Скрытое решение: `generate({ difficulty: "easy", seed: "grid-inf/<installSeed>/<index>" }).solution`
 *   — детерминированно от `installSeed` (случайный на установку) и номера сетки; ≈4 мс.
 * - Позиция: клетка последнего хода лога дня. Если она в Grid ∞ уже открыта — ближайшая свободная
 *   по расстоянию Манхэттена, при равенстве — с меньшим индексом (детерминированно).
 * - «Решаемость»: `countSolutions(подсказки, 2) === 1` — показывается тихо («now solvable», решение
 *   PM из концепта: скрытие противоречит Provide clear feedback).
 * - Один «улёт» на дату: повторное приземление той же даты — no-op.
 * - Бесконечность: `nextGrid` — следующий индекс с пустым набором клеток. UI решения Grid ∞ в
 *   PD-12 нет (экрана нет в утверждённом макете), поэтому «каждая следующая требует больше открытых
 *   клеток» пока нигде не применяется — открытый вопрос.
 */
import { countSolutions, generate } from "@pundoku/engine";

export const CELL_COUNT = 81;

export interface PermanentGridState {
  /** Случайное значение установки; PD-14 синхронизирует его с сервером вместе со снапшотом. */
  readonly installSeed: string;
  /** Номер сетки (0 — первая). */
  readonly index: number;
  /** Открытые клетки по порядку прилёта. */
  readonly cells: readonly { readonly cell: number; readonly date: string }[];
}

export interface Landing {
  readonly state: PermanentGridState;
  readonly cell: number;
  readonly digit: number;
}

export const initialPermanent = (installSeed: string): PermanentGridState => ({ installSeed, index: 0, cells: [] });

export function newInstallSeed(): string {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return `inf-${a[0]!.toString(16)}${a[1]!.toString(16)}`;
}

const solutionCache = new Map<string, readonly number[]>();

/** Скрытое решение сетки (кэшируется — на экране оно нужно на каждый показ). */
export function hiddenSolution(state: Pick<PermanentGridState, "installSeed" | "index">): readonly number[] {
  const seed = `grid-inf/${state.installSeed}/${state.index}`;
  let s = solutionCache.get(seed);
  if (!s) {
    s = [...generate({ difficulty: "easy", seed }).solution].map(Number);
    solutionCache.set(seed, s);
  }
  return s;
}

/** Открытые клетки как сетка 81 (0 — пусто). */
export function cluesOf(state: PermanentGridState): number[] {
  const sol = hiddenSolution(state);
  const out = new Array<number>(CELL_COUNT).fill(0);
  for (const { cell } of state.cells) out[cell] = sol[cell] as number;
  return out;
}

const dist = (a: number, b: number): number =>
  Math.abs(Math.floor(a / 9) - Math.floor(b / 9)) + Math.abs((a % 9) - (b % 9));

/** Куда сядет клетка: желаемая, а если занята — ближайшая свободная; `null` — свободных нет. */
export function landingCell(state: PermanentGridState, preferred: number): number | null {
  const taken = new Set(state.cells.map((c) => c.cell));
  if (!taken.has(preferred)) return preferred;
  let best: number | null = null;
  for (let i = 0; i < CELL_COUNT; i++) {
    if (taken.has(i)) continue;
    if (best === null || dist(i, preferred) < dist(best, preferred)) best = i;
  }
  return best;
}

/** Приземлить клетку дня. `null` — уже приземлялась за эту дату либо свободных клеток нет. */
export function landDay(state: PermanentGridState, date: string, preferred: number): Landing | null {
  if (state.cells.some((c) => c.date === date)) return null;
  const cell = landingCell(state, preferred);
  if (cell === null) return null;
  return { state: { ...state, cells: [...state.cells, { cell, date }] }, cell, digit: hiddenSolution(state)[cell] as number };
}

/** Сетка уже однозначно решаема по открытым клеткам? */
export function isSolvable(state: PermanentGridState): boolean {
  if (state.cells.length < 17) return false; // меньше 17 подсказок единственного решения не бывает
  return countSolutions(cluesOf(state).join(""), 2) === 1;
}

/** Следующая сетка (после того, как игрок решил текущую). */
export const nextGrid = (state: PermanentGridState): PermanentGridState => ({
  installSeed: state.installSeed,
  index: state.index + 1,
  cells: [],
});
