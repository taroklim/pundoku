/**
 * Таймлапс своего прохождения (PD-70): есть ли у дня цельный лог и как получить кадры.
 * Без UI — экран ждёт утверждённый макет. Формат/бюджет хранения — `docs/pd-70-timelapse-data.md`.
 */
import type { MoveLog, Timelapse, TimelapseOptions } from "@pundoku/engine";
import { solve, timelapseFrames } from "@pundoku/engine";
import { decodeMoveLog } from "../sync/codec";
import type { DayRecord } from "../sync/schema";
import type { DayProgress } from "../today/repository";

/**
 * Лог «цельный»: воспроизводится в решённую сетку (финальный кадр = решение), то есть не обрезан и не повреждён.
 * Синтетический лог (`logFromHeat`) эту проверку проходит — он ставит каждую клетку верной цифрой, — поэтому его
 * отсекает отдельный флаг `PlayState.logSynthetic`, а не эта проверка.
 */
function replaysToSolution(log: MoveLog, mission: string, solution: string): boolean {
  try {
    if (!Array.isArray(log) || log.length === 0) return false;
    const last = timelapseFrames(log, { mission, solution }).frames.at(-1);
    return last !== undefined && last.values.join("") === solution;
  } catch {
    return false; // повреждённый лог (клетка вне 0..80, `null`-ход…) — не таймлапс, а не падение экрана
  }
}

/** У решённого дня локально есть настоящий цельный лог ходов — Таймлапс возможен. */
export function hasTimelapse(p: Pick<DayProgress, "solved" | "mission" | "play">): boolean {
  if (!p.solved || p.play.logSynthetic === true) return false;
  return replaysToSolution(p.play.log, p.mission, p.play.solution.join(""));
}

/**
 * У записи снапшота есть `moveLog`, воспроизводящийся в решение. Запись без `moveLog` (урезана бюджетом/413 либо
 * пришла без него) — нет: из `heat` настоящий таймлапс не собрать.
 */
export function recordHasTimelapse(rec: DayRecord): boolean {
  if (rec.status !== "solved" || rec.moveLog === undefined) return false;
  const log = decodeMoveLog(rec.moveLog);
  const solution = log === null ? null : solve(rec.mission);
  return log !== null && solution !== null && replaysToSolution(log, rec.mission, solution.join(""));
}

/**
 * Кадры таймлапса дня или `null`, если цельного (или воспроизводимого) лога нет. Чернильная партия (`2:`-лог с
 * `Move.blot`) — обычный таймлапс: кляксы видны кадрами (`frame.blot`, клетка в `wrong`), авто-замена — следующим кадром.
 * Некорректные `opts` (`speed ≤ 0` и т. п.) по-прежнему бросают `RangeError` — это ошибка вызывающего, не данных.
 */
export function timelapseOf(p: Pick<DayProgress, "solved" | "mission" | "play">, opts?: TimelapseOptions): Timelapse | null {
  if (!hasTimelapse(p)) return null;
  return timelapseFrames(p.play.log, { mission: p.mission, solution: p.play.solution.join("") }, opts);
}
