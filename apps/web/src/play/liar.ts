/**
 * Лжец в web (PD-171, план режимов §1.2): чистая логика партии поверх `PlayState` — обвинение, поимка, что можно
 * показывать. Без DOM и React (тесты — `liar.test.ts`). Движок — `@pundoku/engine` `liar.ts` (`accuse`, `liarSummary`).
 *
 * **Утечки.** Секрет партии (`PlayState.liar`, `solution`) UI не читает НАПРЯМУЮ: всё, что уходит на экран, — производные
 * отсюда, и до поимки они не зависят от того, где лжец: `liarHidden` (каналы ответа закрыты), `acquittedCells` (вердикты
 * уже сделанных обвинений — игрок их и так увидел), `caughtLie` (только после поимки). Проверка ходов до поимки — только
 * по правилам (повторы в юните), не по решению: подсветка ошибок, лесенка подсказок, волны M3/M8 выключены.
 */
import type { Accusation, AccusationVerdict, Digit, LiarSummary } from "@pundoku/engine";
import { accuse, liarSummary } from "@pundoku/engine";
import type { LiarSecret, PlayState } from "./logic";
import { CELLS, createPlay, finish, isGiven } from "./logic";

/** Сетка Лжеца так, как её отдаёт Worker (`LiarPuzzle` без меты). */
export interface LiarPuzzleData {
  readonly mission: string;
  readonly solution: string;
  readonly honestMission: string;
  readonly liarCell: number;
  readonly liarDigit: Digit;
  readonly trueDigit: Digit;
}

/** Новая партия Лжеца: `mission` с ложной подсказкой, решение — честной сетки. */
export function createLiarPlay(p: LiarPuzzleData): PlayState {
  const play = createPlay({ mission: p.mission, solution: p.solution });
  const secret: LiarSecret = { liarCell: p.liarCell, liarDigit: p.liarDigit, trueDigit: p.trueDigit, honestMission: p.honestMission };
  return { ...play, liar: secret, accusations: [] };
}

export const isLiarGame = (s: Pick<PlayState, "liar">): boolean => s.liar !== undefined;

/** Лжец пойман: среди обвинений есть его клетка. */
export function liarCaught(s: Pick<PlayState, "liar" | "accusations">): boolean {
  const liar = s.liar;
  return liar !== undefined && (s.accusations ?? []).some((a) => a.cell === liar.liarCell);
}

/**
 * Каналы ответа закрыты: партия Лжеца и лжец ещё не пойман. Пока так — нет подсветки ошибок по решению, лесенки подсказок,
 * волн «юнит собран верно»/«цифра закрыта», кляксы (Ink запрещён). Решённая партия всегда с пойманным лжецом.
 */
export const liarHidden = (s: Pick<PlayState, "liar" | "accusations">): boolean => isLiarGame(s) && !liarCaught(s);

/** Клетки, которые уже обвиняли (повторно обвинять нельзя). */
export const accusedCells = (s: Pick<PlayState, "accusations">): ReadonlySet<number> => new Set((s.accusations ?? []).map((a) => a.cell));

/** «Оправданные» подсказки — обвинённые, но честные. Вердикт игрок уже видел: это не утечка. */
export function acquittedCells(s: Pick<PlayState, "liar" | "accusations">): ReadonlySet<number> {
  const liar = s.liar;
  if (!liar) return new Set();
  return new Set((s.accusations ?? []).filter((a) => a.cell !== liar.liarCell).map((a) => a.cell));
}

/** Пойманная ложь (клетка и зачёркнутая ложная цифра) — только после поимки; до неё `null`. */
export function caughtLie(s: Pick<PlayState, "liar" | "accusations">): { cell: number; lie: Digit } | null {
  return s.liar && liarCaught(s) ? { cell: s.liar.liarCell, lie: s.liar.liarDigit } : null;
}

/** Неверных обвинений (счётчик на экране и карточке). */
export const wrongAccusations = (s: Pick<PlayState, "liar" | "accusations">): number => acquittedCells(s).size;

/** Можно ли обвинить клетку: партия Лжеца идёт, лжец не пойман, клетка — данная подсказка и её ещё не обвиняли. */
export function canAccuse(s: PlayState, cell: number): boolean {
  if (!isLiarGame(s) || s.solved || liarCaught(s)) return false;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELLS || !isGiven(s, cell)) return false;
  return !accusedCells(s).has(cell);
}

/** Итог обвинения для экрана: верно (`liar`) или подсказка честная (`honest`). */
export type AccuseResult = { readonly kind: "liar" | "honest"; readonly cell: number };

/**
 * Обвинить подсказку. Повторное обвинение, обвинение пустой клетки, после поимки или в решённой партии — no-op (`s` как есть).
 * Верно: клетка получает истинную цифру (`mission`), партия может тут же закончиться (`finish`: все клетки уже верны).
 * Неверно: подсказка оправдана, счётчик растёт. Обвинение — не ход: в `log` и стек undo не пишется.
 */
export function accuseCell(s: PlayState, cell: number, t: number): { play: PlayState; result: AccuseResult } | null {
  if (!canAccuse(s, cell) || !s.liar) return null;
  const verdict: AccusationVerdict = accuse({ mission: s.mission.join(""), liarCell: s.liar.liarCell, trueDigit: s.liar.trueDigit }, cell);
  if (verdict.kind === "not_a_given") return null;
  const last = s.log[s.log.length - 1];
  const prev = s.accusations?.[s.accusations.length - 1];
  const at = Math.max(0, Math.round(t), last ? last.t : 0, prev ? prev.t : 0);
  const accusation: Accusation = { t: at, cell: cell, moveIndex: s.log.length };
  const accusations = [...(s.accusations ?? []), accusation];
  if (verdict.kind === "honest") return { play: { ...s, accusations }, result: { kind: "honest", cell } };
  const mission = s.mission.slice();
  mission[cell] = verdict.trueDigit;
  return { play: finish({ ...s, mission, accusations }), result: { kind: "liar", cell } };
}

/**
 * Метрики Лжеца для карточки (`liarSummary` движка). `mission` движку нужна с ложью — восстанавливаем её из секрета
 * (после поимки в `PlayState.mission` уже истинная цифра). `null` — партия не Лжеца.
 */
export function liarSummaryOf(s: PlayState): LiarSummary | null {
  const liar = s.liar;
  if (!liar) return null;
  const mission = s.mission.slice();
  mission[liar.liarCell] = liar.liarDigit;
  return liarSummary({ mission: mission.join(""), liarCell: liar.liarCell, trueDigit: liar.trueDigit }, s.accusations ?? [], s.log);
}

/** Исходная сетка Лжеца (с ложью) — для таймлапса и записи дня, где нужна сетка «как её видел игрок». */
export function liarMission(s: PlayState): string {
  const mission = s.mission.slice();
  if (s.liar) mission[s.liar.liarCell] = s.liar.liarDigit;
  return mission.map((d) => String(d)).join("");
}

/**
 * Слой обвинений для таймлапса (план режимов §1.2: `timelapseFrames` не меняется, слой собирается в web). Обвинение сделано
 * после хода `moveIndex - 1`, поэтому видно с последнего кадра до него (кадр хода `≥ moveIndex - 1`; до первого хода — кадр 0).
 * `catchFrame` — с какого кадра ложь зачёркнута (до него в клетке ложная цифра, как её видел игрок).
 */
export interface LiarTimelapseLayer {
  readonly cell: number;
  readonly lie: number;
  readonly truth: number;
  readonly catchFrame: number | null;
  /** Оправданная клетка → первый кадр, где она уже оправдана. */
  readonly acquitted: ReadonlyMap<number, number>;
}

export function liarTimelapseLayer(s: Pick<PlayState, "liar" | "accusations">, frames: readonly { readonly move: number }[]): LiarTimelapseLayer | null {
  const liar = s.liar;
  if (!liar || frames.length === 0) return null;
  const frameOf = (moveIndex: number): number => {
    const j = frames.findIndex((f) => f.move >= moveIndex - 1);
    return j < 0 ? frames.length - 1 : j;
  };
  let catchFrame: number | null = null;
  const acquitted = new Map<number, number>();
  for (const a of s.accusations ?? []) {
    const j = frameOf(a.moveIndex);
    if (a.cell === liar.liarCell) {
      if (catchFrame === null) catchFrame = j;
    } else if (!acquitted.has(a.cell)) acquitted.set(a.cell, j);
  }
  return { cell: liar.liarCell, lie: liar.liarDigit, truth: liar.trueDigit, catchFrame, acquitted };
}
