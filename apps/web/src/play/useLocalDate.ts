/**
 * PD-262: «сегодня» (`localDate()`, та же граница суток, что у Лжеца дня и Today) для экрана, который может провисеть открытым
 * через полночь. Перечитывается таймером к следующей локальной полуночи и при возврате в приложение (`visibilitychange`):
 * в фоне iOS таймеры спят, так что утренний возврат ловит только событие видимости (как вкладка Year).
 */
import { useEffect, useState } from "react";
import { localDate } from "../today/dayResolver";

/** Сколько ждать до следующей локальной полуночи (+1 с запаса, чтобы `localDate()` уже показывала новый день). */
function msToMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime() + 1000;
}

export function useLocalDate(): string {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      setToday(localDate());
      clearTimeout(timer);
      timer = setTimeout(update, msToMidnight(new Date()));
    };
    update();
    const onVisible = () => {
      if (document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return today;
}
