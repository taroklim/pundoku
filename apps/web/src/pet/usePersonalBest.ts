import type { Difficulty } from "@pundoku/engine";
import { useEffect, useState } from "react";
import type { PlayState } from "../play/logic";
import type { DayProgress } from "../today/repository";
import { personalBestOf } from "./petDay";
import type { PetHistoryDay } from "./petDay";

export interface SolvedDayKey {
  readonly date: string;
  readonly difficulty: Difficulty | null;
  readonly play: PlayState;
  readonly assisted: boolean;
  readonly hints?: number;
}

/**
 * PD-180: «личный рекорд» решённого дня для питомца на карточке Today/архива. Историю читает только когда питомец включён
 * (выкл — ни одного чтения хранилища). Запись самого дня берётся из хранилища (там `solvedAt`), а пока она не записана —
 * из снапшота экрана (момент решения — сейчас).
 */
export function usePersonalBest(enabled: boolean, listDays: () => Promise<DayProgress[]>, day: SolvedDayKey | null): boolean {
  const [best, setBest] = useState(false);
  const date = day?.date ?? null;
  const play = day?.play ?? null;
  const difficulty = day?.difficulty ?? null;
  const assisted = day?.assisted === true;
  const hints = day?.hints;
  useEffect(() => {
    if (!enabled || date === null || play === null) {
      setBest(false);
      return;
    }
    let alive = true;
    void listDays().then((all) => {
      if (!alive) return;
      const saved = all.find((d) => d.date === date && d.solved);
      // Ещё не записан — значит, решён только что: момент решения — сейчас (PD-197: не начало даты дня).
      const self: PetHistoryDay = saved ?? { date, difficulty, play, assisted, hints, solved: true, solvedAt: new Date().toISOString() };
      setBest(personalBestOf(self, all));
    });
    return () => {
      alive = false;
    };
  }, [enabled, listDays, date, play, difficulty, assisted, hints]);
  return best;
}
