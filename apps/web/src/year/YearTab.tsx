import { useEffect, useState } from "react";
import type { LiarInfo } from "../play/savedPlay";
import { LIAR_DAY_PREFIX, liarInfoOf, parseSavedLiarDay } from "../play/savedPlay";
import { localDate } from "../today/dayResolver";
import type { DayProgress } from "../today/repository";
import { useTabActive } from "../shell/tabSlide";
import { sync } from "../sync/runtime";
import { readFirstUse } from "./firstUse";
import { YearScreen } from "./YearScreen";

/**
 * Вкладка Year: читает прогресс из `ProgressRepository` (IndexedDB, PD-14) — НЕ из `moveLog` и не из
 * горячего кэша ходов. Перечитывает данные при открытии (PD-161: когда вкладка стала активной) и когда пришёл снапшот с сервера
 * (`subscribeRemote`: после чистки хранилища на устройстве год возвращается сам).
 */
export function YearTab({
  onOpenToday,
  onPlayDay,
  initialDate,
  onInitialDateConsumed,
  onOpenSettings,
}: {
  onOpenToday: () => void;
  onPlayDay: (date: string) => void;
  initialDate?: string | null;
  onInitialDateConsumed?: () => void;
  onOpenSettings?: () => void;
}) {
  const [days, setDays] = useState<DayProgress[] | null>(null);
  // PD-171: Лжец дня — вторичная отметка на клетке дня и строка в карточке дня.
  const [liar, setLiar] = useState<ReadonlyMap<string, LiarInfo>>(() => new Map());
  const [firstUse, setFirstUse] = useState<string | null>(null);
  const [today, setToday] = useState(() => localDate());

  // PD-161: вкладка смонтирована постоянно — «при открытии» = когда стала активной; скрытая ничего не слушает.
  const active = useTabActive();
  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => {
      setToday(localDate());
      void Promise.all([sync.repository.listDays(), readFirstUse(sync.repository), (sync.repository.listMeta?.(LIAR_DAY_PREFIX) ?? Promise.resolve([])).catch((): [string, unknown][] => [])])
        .then(([list, first, liarMeta]) => {
          if (!alive) return;
          setDays(list);
          setFirstUse(first);
          setLiar(liarInfoMap(liarMeta));
        })
        .catch(() => {
          // Хранилище недоступно — показываем пустой год, а не вечную загрузку.
          if (alive) setDays((prev) => prev ?? []);
        });
    };
    load();
    const off = sync.hooks.subscribeRemote(load);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      off();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active]);

  return (
    <YearScreen
      days={days}
      firstUse={firstUse}
      liar={liar}
      today={today}
      onOpenToday={onOpenToday}
      onPlayDay={onPlayDay}
      initialDate={initialDate}
      onInitialDateConsumed={onInitialDateConsumed}
      onOpenSettings={onOpenSettings}
    />
  );
}

/** Записи `meta:liar:*` → метрики Лжеца дня по датам (только дни с ходом или обвинением). */
export function liarInfoMap(entries: readonly [string, unknown][]): ReadonlyMap<string, LiarInfo> {
  const out = new Map<string, LiarInfo>();
  for (const [key, value] of entries) {
    const date = key.slice(LIAR_DAY_PREFIX.length);
    const saved = parseSavedLiarDay(value, date);
    if (!saved || (saved.play.log.length === 0 && (saved.play.accusations?.length ?? 0) === 0 && !saved.play.solved)) continue;
    const info = liarInfoOf(saved);
    if (info) out.set(date, info);
  }
  return out;
}
