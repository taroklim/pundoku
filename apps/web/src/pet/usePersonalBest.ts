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
  return usePersonalBestState(enabled, listDays, day).best;
}

/**
 * То же + `ready`: рекорд для ЭТОЙ даты уже посчитан (или считать нечего). PD-260: карточка не показывает кляксу, пока ответа
 * нет, — иначе посадка «решили сейчас» начиналась бы как «доволен» и перезапускалась «удивлён» (WebKit читает историю дольше
 * задержки посадки). Готовность держится по дате: обновление партии того же дня кляксу не прячет.
 */
export function usePersonalBestState(
  enabled: boolean,
  listDays: () => Promise<DayProgress[]>,
  day: SolvedDayKey | null,
): { readonly best: boolean; readonly ready: boolean } {
  const [st, setSt] = useState<{ best: boolean; date: string | null }>({ best: false, date: null });
  const date = day?.date ?? null;
  const play = day?.play ?? null;
  const difficulty = day?.difficulty ?? null;
  const assisted = day?.assisted === true;
  const hints = day?.hints;
  useEffect(() => {
    if (!enabled || date === null || play === null) {
      setSt({ best: false, date: null });
      return;
    }
    let alive = true;
    void listDays().then(
      (all) => {
        if (!alive) return;
        const saved = all.find((d) => d.date === date && d.solved);
        // Ещё не записан — значит, решён только что: момент решения — сейчас (PD-197: не начало даты дня).
        const self: PetHistoryDay = saved ?? { date, difficulty, play, assisted, hints, solved: true, solvedAt: new Date().toISOString() };
        setSt({ best: personalBestOf(self, all), date });
      },
      // История не прочиталась — рекорда не знаем: клякса по партии (не прятать её навсегда).
      () => alive && setSt({ best: false, date }),
    );
    return () => {
      alive = false;
    };
  }, [enabled, listDays, date, play, difficulty, assisted, hints]);
  return { best: st.best, ready: !enabled || date === null || play === null || st.date === date };
}
