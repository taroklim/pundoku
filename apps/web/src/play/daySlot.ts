/**
 * Слот «Головоломка дня» в «Продолжить» хаба Play (PD-144). Слот ДНЯ живёт отдельно от слота своей сетки: его хранит
 * стор Today (`days` в IndexedDB, запись на каждый ход), а хаб его только ЧИТАЕТ — ни одной записи, ни одного
 * обращения к игре дня здесь нет, поэтому хаб не может затереть день (и наоборот).
 *
 * Источник данных: если стор Today уже держит идущую партию (приложение открывали на Today) — берём её живое состояние;
 * иначе читаем запись сегодняшнего дня из хранилища (приложение открылось сразу на Play). Незавершённым день считается,
 * когда он не решён и в нём есть прогресс (ход или подсказка): открытый, но нетронутый день продолжать нечего.
 */
import type { Difficulty } from "@pundoku/engine";
import { useEffect, useState } from "react";
import { sync as syncRuntime } from "../sync/runtime";
import { dayStore } from "../today/dayStore";
import { localDate } from "../today/dayResolver";
import type { DayProgress, ProgressRepository } from "../today/repository";
import { sanitizeDays } from "../today/repository";
import type { PlayState } from "./logic";
import { cellsLeft } from "./logic";

/** Сводка незавершённой игры для строки «Продолжить». */
export interface SlotSummary {
  /** `null` — сложность дня движку неизвестна (подпись без неё). */
  readonly difficulty: Difficulty | null;
  /** Сколько клеток осталось (по поставленным цифрам, как «N cells left» на экране партии). */
  readonly left: number;
  readonly elapsedMs: number;
  readonly ink: boolean;
}

/** Что нужно хабу от Today: живое состояние стора (если он уже загружен) и запись из хранилища. */
export interface DaySlotSource {
  readonly store: {
    readonly subscribe: (fn: () => void) => () => void;
    readonly getSnapshot: () => { readonly phase: string; readonly play: PlayState | null; readonly difficulty: Difficulty; readonly difficultyKnown: boolean; readonly hints?: number };
    readonly getElapsedMs: () => number;
  };
  readonly repo: Pick<ProgressRepository, "getDay">;
  readonly now: () => Date;
}

/** Один объект на всё приложение: хук зависит от `source`, новый объект на каждый рендер зациклил бы эффект. */
export const DEFAULT_DAY_SLOT_SOURCE: DaySlotSource = { store: dayStore, repo: syncRuntime.repository, now: () => new Date() };

const isSettled = (source: DaySlotSource): boolean => {
  const phase = source.store.getSnapshot().phase;
  return phase === "playing" || phase === "solved";
};

const hasProgress = (play: PlayState, hints: number | undefined): boolean => play.log.length > 0 || (hints ?? 0) > 0;

/** Сводка из записи дня; `null` — продолжать нечего (решён, нетронут или запись нечитаема). */
export function summaryFromRecord(record: DayProgress | null): SlotSummary | null {
  if (!record) return null;
  const [ok] = sanitizeDays([record], "daySlot");
  if (!ok || ok.solved || ok.play.solved || !hasProgress(ok.play, ok.hints)) return null;
  return { difficulty: ok.difficulty, left: cellsLeft(ok.play), elapsedMs: ok.elapsedMs, ink: ok.play.ink === true };
}

/** Сводка из живого состояния стора Today (`null` — день не идёт, решён, нетронут или ещё грузится). */
export function summaryFromStore(source: DaySlotSource): SlotSummary | null {
  const s = source.store.getSnapshot();
  if (s.phase !== "playing" || !s.play || !hasProgress(s.play, s.hints)) return null;
  return { difficulty: s.difficultyKnown ? s.difficulty : null, left: cellsLeft(s.play), elapsedMs: source.store.getElapsedMs(), ink: s.play.ink === true };
}

/** Живая сводка слота дня: перечитывается при монтировании хаба и при каждом изменении стора Today. */
export function useDaySlot(source: DaySlotSource = DEFAULT_DAY_SLOT_SOURCE): SlotSummary | null {
  const [summary, setSummary] = useState<SlotSummary | null>(() => summaryFromStore(source));
  useEffect(() => {
    let alive = true;
    // Стор уже ведёт партию (phase playing/solved) — он главнее записи: запись может отстать на тик.
    setSummary(summaryFromStore(source));
    if (!isSettled(source)) {
      void source.repo
        .getDay(localDate(source.now()))
        .then((record) => {
          if (alive) setSummary(summaryFromRecord(record));
        })
        .catch(() => undefined); // нечитаемое хранилище — просто нет слота, хаб не падает
    }
    const off = source.store.subscribe(() => {
      // Пока стор грузится (`loading`), его «нет партии» не должно затирать то, что прочитано из хранилища.
      if (alive && isSettled(source)) setSummary(summaryFromStore(source));
    });
    return () => {
      alive = false;
      off();
    };
  }, [source]);
  return summary;
}
