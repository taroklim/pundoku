import { useEffect, useState } from "react";
import { localDate } from "../today/dayResolver";
import type { DayProgress } from "../today/repository";
import { sync } from "../sync/runtime";
import { readFirstUse } from "./firstUse";
import { YearScreen } from "./YearScreen";

/**
 * Вкладка Year: читает прогресс из `ProgressRepository` (IndexedDB, PD-14) — НЕ из `moveLog` и не из
 * горячего кэша ходов. Перечитывает данные при открытии и когда пришёл снапшот с сервера
 * (`subscribeRemote`: после чистки хранилища на устройстве год возвращается сам).
 */
export function YearTab({
  onOpenToday,
  onPlayDay,
  initialDate,
  onInitialDateConsumed,
}: {
  onOpenToday: () => void;
  onPlayDay: (date: string) => void;
  initialDate?: string | null;
  onInitialDateConsumed?: () => void;
}) {
  const [days, setDays] = useState<DayProgress[] | null>(null);
  const [firstUse, setFirstUse] = useState<string | null>(null);
  const [today, setToday] = useState(() => localDate());

  useEffect(() => {
    let alive = true;
    const load = () => {
      setToday(localDate());
      void Promise.all([sync.repository.listDays(), readFirstUse(sync.repository)])
        .then(([list, first]) => {
          if (!alive) return;
          setDays(list);
          setFirstUse(first);
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
  }, []);

  return (
    <YearScreen
      days={days}
      firstUse={firstUse}
      today={today}
      onOpenToday={onOpenToday}
      onPlayDay={onPlayDay}
      initialDate={initialDate}
      onInitialDateConsumed={onInitialDateConsumed}
    />
  );
}
