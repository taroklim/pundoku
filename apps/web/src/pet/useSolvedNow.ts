import { useState } from "react";

/**
 * PD-260: «решили только что» — на этом экране фаза перешла «playing → solved» (а не решённый день подгрузился, не победа с
 * другого устройства и не скрытая вкладка: `enabled = false` в момент перехода). Держится, пока фаза «solved»; новая партия
 * сбрасывает. По нему карточка результата один раз играет посадку кляксы (макет PD-223 B «Решил день»).
 * Производное состояние от предыдущего рендера (без эффекта): флаг готов в том же рендере, где сменилась фаза.
 */
export function useSolvedNow(phase: string, enabled: boolean): boolean {
  const [s, setS] = useState({ phase, now: false });
  if (s.phase !== phase) {
    const next = { phase, now: phase === "solved" && s.phase === "playing" && enabled };
    setS(next);
    return next.now;
  }
  return s.now;
}
