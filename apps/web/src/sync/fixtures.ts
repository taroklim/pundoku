/** Общие данные для тестов синхронизации: настоящие партии движка (не заглушки логов). */
import { dailyPuzzle } from "@pundoku/engine";
import { createPlay, enterDigit, eraseCell, firstOpenCell } from "../play/logic";
import type { PlayState } from "../play/logic";
import type { DayProgress } from "../today/repository";
import type { DayRecord } from "./schema";
import { dayRecordFromProgress } from "./schema";

export const NOW = new Date(2026, 8, 29, 12, 0);

/** Партия дня: `moves` — сколько клеток поставить (по умолчанию все), `withFix` — одна ошибка и исправление. */
export function playOf(date: string, opts: { moves?: number; withFix?: boolean; difficulty?: "easy" | "medium" } = {}): PlayState {
  const p = dailyPuzzle(date, opts.difficulty ?? "easy");
  let play = createPlay(p);
  let t = 1000;
  const empty = play.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  const target = opts.moves ?? empty.length;
  if (opts.withFix && empty.length > 0) {
    const cell = empty[0]!;
    const wrong = (play.solution[cell]! % 9) + 1;
    play = enterDigit(play, cell, wrong, (t += 700));
    play = eraseCell(play, cell, (t += 500));
  }
  for (const cell of empty.slice(0, target)) {
    play = enterDigit(play, cell, play.solution[cell]!, (t += 900 + (cell % 7) * 100));
  }
  void firstOpenCell;
  return play;
}

export function progressOf(
  date: string,
  opts: { solved?: boolean; withFix?: boolean; moves?: number; solvedAt?: string; late?: boolean; source?: "sudoku.com" | "generator" | "client" } = {},
): DayProgress {
  const solved = opts.solved ?? true;
  const play = playOf(date, { ...(opts.moves !== undefined ? { moves: opts.moves } : {}), ...(opts.withFix ? { withFix: true } : {}) });
  return {
    date,
    mission: play.mission.join(""),
    difficulty: "easy",
    source: opts.source ?? "sudoku.com",
    winRate: 61.4,
    play,
    elapsedMs: play.log.length ? play.log[play.log.length - 1]!.t : 0,
    solved: solved && play.solved,
    serverVerified: null,
    verification: "server",
    solvedAt: solved ? (opts.solvedAt ?? `${date}T10:00:00.000Z`) : null,
    late: opts.late ?? false,
    assisted: false,
  };
}

export function recordOf(date: string, opts: Parameters<typeof progressOf>[1] = {}): DayRecord {
  const rec = dayRecordFromProgress(progressOf(date, opts), NOW);
  if (!rec) throw new Error("empty record");
  return rec;
}
