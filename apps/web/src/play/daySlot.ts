/**
 * Слот «Головоломка дня» в «Продолжить» хаба Play (PD-144). Слот ДНЯ живёт отдельно от слота своей сетки: его хранит
 * стор Today (`days` в IndexedDB, запись на каждый ход), а хаб его только ЧИТАЕТ — ни одной записи, ни одного
 * обращения к игре дня здесь нет, поэтому хаб не может затереть день (и наоборот).
 *
 * Источник данных: если стор Today уже держит идущую партию (приложение открывали на Today) — берём её живое состояние;
 * иначе читаем запись сегодняшнего дня из хранилища (приложение открылось сразу на Play). Незавершённым день считается,
 * когда он не решён и в нём есть прогресс (ход или подсказка): открытый, но нетронутый день продолжать нечего.
 *
 * PD-275: незавершённый день ПРОШЛОЙ даты (начат вечером, приложение перезапущено утром — стор Today уже грузит сегодняшний)
 * не пропадает, как у Лжеца дня (PD-217): если ни стор, ни запись сегодняшнего дня продолжать нечего, слот берёт самый поздний
 * незавершённый день из хранилища (`listDays`). Порядок, как у Лжеца: живая партия стора → сегодняшний → самый поздний прошлый;
 * строка одна, остальные ждут. Для даты, которую ведёт стор, правда — стор (запись может отстать на тик). Открывается такой
 * день там, где его можно доиграть (App › continueDay: стор Today, если он держит эту дату, иначе архив).
 */
import type { Difficulty } from "@pundoku/engine";
import { useEffect, useRef, useState } from "react";
import { sync as syncRuntime } from "../sync/runtime";
import { dayStore } from "../today/dayStore";
import { localDate } from "../today/dayResolver";
import type { DayProgress, ProgressRepository, SyncStorage } from "../today/repository";
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
  /**
   * PD-262: день головоломки (`YYYY-MM-DD`) — только у игр дня (день Today, Лжец дня). Не сегодняшний — строка «Продолжить»
   * подписывает его датой. Нет — подпись без даты (слоты режимов, старые данные).
   */
  readonly date?: string;
}

/** Что нужно хабу от Today: живое состояние стора (если он уже загружен) и запись из хранилища. */
export interface DaySlotSource {
  readonly store: {
    readonly subscribe: (fn: () => void) => () => void;
    readonly getSnapshot: () => { readonly phase: string; readonly date?: string; readonly play: PlayState | null; readonly difficulty: Difficulty; readonly difficultyKnown: boolean; readonly hints?: number };
    readonly getElapsedMs: () => number;
  };
  /** `listDays` (необязателен) — найти незавершённый день прошлой даты (PD-275); нет — только сегодняшний, как до PD-275. */
  readonly repo: Pick<ProgressRepository, "getDay"> & Partial<Pick<SyncStorage, "listDays">>;
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
  return { difficulty: ok.difficulty, left: cellsLeft(ok.play), elapsedMs: ok.elapsedMs, ink: ok.play.ink === true, date: ok.date };
}

/** Сводка из живого состояния стора Today (`null` — день не идёт, решён, нетронут или ещё грузится). */
export function summaryFromStore(source: DaySlotSource): SlotSummary | null {
  const s = source.store.getSnapshot();
  if (s.phase !== "playing" || !s.play || !hasProgress(s.play, s.hints)) return null;
  // PD-262: после полуночи стор держит вчерашнюю начатую партию (`refresh` не меняет день с ходами) — её дата идёт в подпись.
  const summary: SlotSummary = { difficulty: s.difficultyKnown ? s.difficulty : null, left: cellsLeft(s.play), elapsedMs: source.store.getElapsedMs(), ink: s.play.ink === true };
  return s.date ? { ...summary, date: s.date } : summary;
}

/**
 * PD-275: незавершённый день из хранилища — сегодняшний, иначе самый поздний прошлый; `exclude` — дата, которую ведёт стор
 * Today (о ней судит он). Хранилище без `listDays` — только запись сегодняшнего дня (как до PD-275). PD-283: даты позже
 * `today` пропускаются.
 */
export async function summaryFromRepo(source: DaySlotSource, today: string, exclude: string | null): Promise<SlotSummary | null> {
  const list = source.repo.listDays;
  if (!list) return exclude === today ? null : summaryFromRecord(await source.repo.getDay(today));
  let best: SlotSummary | null = null;
  for (const record of await list.call(source.repo)) {
    if (!record || record.date === exclude) continue;
    const s = summaryFromRecord(record);
    // PD-283: день «из будущего» (часы отвели назад, сменили пояс на запад) не продолжаем — архив его не откроет; запись не
    // трогаем, строка вернётся, когда наступит её дата.
    if (!s?.date || s.date > today) continue;
    if (best === null || s.date === today || (best.date !== today && s.date > best.date!)) best = s;
  }
  return best;
}

/**
 * Живая сводка слота дня: перечитывается при монтировании хаба, при каждом изменении стора Today и при смене `refresh`
 * (PD-275: хаб передаёт «сегодня» и видимость вкладки — день, доигранный в архиве, или наступившие сутки перечитываются при
 * возврате на хаб).
 */
export function useDaySlot(source: DaySlotSource = DEFAULT_DAY_SLOT_SOURCE, refresh?: string): SlotSummary | null {
  const [summary, setSummary] = useState<SlotSummary | null>(() => summaryFromStore(source));
  const current = useRef(summary);
  current.current = summary;
  useEffect(() => {
    let alive = true;
    let seq = 0;
    let lastKey: string | null = null;
    const update = () => {
      const live = summaryFromStore(source);
      const s = source.store.getSnapshot();
      const settled = isSettled(source);
      if (live) {
        seq++; // запоздавшее чтение хранилища не затрёт живую партию
        lastKey = null;
        setSummary(live);
        return;
      }
      // Стор — правда о своей дате (нет даты в снапшоте — сегодняшней): его день решён/нетронут — строка этого дня уходит
      // сразу, не дожидаясь чтения.
      const today = localDate(source.now());
      const exclude = settled ? (s.date ?? today) : null;
      const key = `${s.phase}|${exclude ?? ""}`;
      if (key === lastKey) return; // ход/выбор клетки без смены дня — хранилище не перечитываем
      lastKey = key;
      if (exclude !== null && current.current && (current.current.date === exclude || current.current.date === undefined)) setSummary(null);
      const mine = ++seq;
      void summaryFromRepo(source, today, exclude)
        .then((found) => {
          if (alive && mine === seq) setSummary(found);
        })
        .catch(() => undefined); // нечитаемое хранилище — просто нет слота, хаб не падает
    };
    update();
    const off = source.store.subscribe(() => {
      // Пока стор грузится (`loading`), его «нет партии» не должно затирать то, что прочитано из хранилища.
      if (alive && isSettled(source)) update();
    });
    return () => {
      alive = false;
      off();
    };
  }, [source, refresh]);
  return summary;
}
