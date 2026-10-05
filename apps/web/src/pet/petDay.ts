/**
 * Сводка дня для питомца (PD-180): web-записи (`PlayState`/`DayProgress` + `LiarInfo`) → `PetDay` движка → `petMood`.
 * Правило настроения живёт в движке (`packages/engine/src/pet.ts`); здесь только чтение записей и «личный рекорд».
 * Ничего не пишет: настроение выводится заново при каждом показе, схема снапшота не меняется.
 */
import { isPersonalBest, petMood, summary } from "@pundoku/engine";
import type { Difficulty, PetDay, PetMood } from "@pundoku/engine";
import { hintCount } from "../play/hintCard";
import { blotCellSet } from "../play/inkCard";
import type { PlayState } from "../play/logic";
import type { LiarInfo } from "../play/savedPlay";
import type { DayProgress } from "../today/repository";

export interface PetContext {
  /** Счётчик подсказок записи (`DayProgress.hints`); иначе — по журналу партии. */
  readonly hints?: number;
  /** День помечен «с помощью» (старые записи без счётчика) — считается за одну подсказку. */
  readonly assisted?: boolean;
  /** Лжец этой партии/даты. */
  readonly liar?: LiarInfo | null;
  /** Время партии — личный рекорд своей сложности (`personalBestOf`). */
  readonly personalBest?: boolean;
}

/** Сводка по партии (решённой или нет). */
export function petDayOfPlay(play: PlayState, solved: boolean, ctx: PetContext = {}): PetDay {
  const sum = summary(play.log);
  const hints = Math.max(hintCount(play, ctx.hints), ctx.assisted === true ? 1 : 0);
  return {
    solved,
    corrections: sum.corrections,
    blots: blotCellSet(play).size,
    hints,
    ink: play.ink === true,
    liarFirstTry: ctx.liar?.caught === true && ctx.liar.firstTry,
    personalBest: ctx.personalBest === true,
  };
}

/** Поля записи дня, нужные для «личного рекорда». */
export type PetHistoryDay = Pick<DayProgress, "date" | "solved" | "difficulty" | "assisted" | "hints" | "solvedAt" | "play">;

/** Время решённого дня, мс — то же, что строка «Time» карточки (`summary.durationMs`). */
const timeOf = (d: PetHistoryDay): number => summary(d.play.log).durationMs;

/** `a` решён раньше `b`: по моменту решения, если он есть у обоих, иначе по дате дня. */
function solvedBefore(a: PetHistoryDay, b: PetHistoryDay): boolean {
  if (a.solvedAt && b.solvedAt) return a.solvedAt < b.solvedAt;
  return a.date < b.date;
}

/**
 * Личный рекорд времени «для класса» = сложности ежедневной сетки. Сравнивается с днями той же сложности, решёнными РАНЬШЕ
 * (рекорд остаётся рекордом в Year и после того, как его побили) и без подсказок (рекорд с помощью — не рекорд). День без
 * сложности (`null`) или с подсказкой рекордом не бывает; первое решение сложности — тоже (см. `isPersonalBest`).
 */
export function personalBestOf(day: PetHistoryDay, all: Iterable<PetHistoryDay>): boolean {
  if (!day.solved || day.difficulty === null || day.assisted || (day.hints ?? 0) > 0) return false;
  const cls: Difficulty = day.difficulty;
  const prev: number[] = [];
  for (const d of all) {
    if (d.date === day.date || !d.solved || d.difficulty !== cls || d.assisted || (d.hints ?? 0) > 0) continue;
    if (solvedBefore(d, day)) prev.push(timeOf(d));
  }
  return isPersonalBest(timeOf(day), prev);
}

/**
 * Настроение дня в листе Year — правило (PD-180, PD-191):
 * - Лжец даты пойман с первого обвинения → удивлён (событие дня; даже если классическая сетка не решена или не начата).
 * - Есть запись ежедневной (классической) сетки → настроение по ней, как раньше (не решена → спит).
 * - Классики нет, но Лжец даты пойман (не с первого обвинения) → день сыгран: доволен. В `LiarInfo` нет правок/подсказок
 *   партии Лжеца (только ложные обвинения — это не правки), поэтому «устал» по Лжецу здесь не выводится.
 * - Классики нет, Лжец не начат или начат, но не пойман → спит.
 */
export function dayPetMood(progress: DayProgress | undefined, liar: LiarInfo | null, all: Iterable<PetHistoryDay>): PetMood {
  if (liar?.caught === true && liar.firstTry) return petMood({ solved: true, corrections: 0, liarFirstTry: true });
  if (!progress) return petMood(liar?.caught === true ? { solved: true, corrections: 0 } : null);
  return petMood(
    petDayOfPlay(progress.play, progress.solved, {
      hints: progress.hints,
      assisted: progress.assisted,
      personalBest: personalBestOf(progress, all),
    }),
  );
}
