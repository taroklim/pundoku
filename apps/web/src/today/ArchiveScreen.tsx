import { useMemo } from "react";
import type { HelpBlockId } from "../help/blocks";
import { archiveStore } from "./dayStore";
import { DayView } from "./TodayScreen";

/**
 * Архив (PD-33): игра прошлой даты. Тот же экран, что Today (`DayView`: поле, панель, карточка результата), но
 * на отдельном `archiveStore` — сегодняшний день и Grid ∞ не затрагиваются. Маршрут `#/day/YYYY-MM-DD`,
 * «‹ Year» возвращает на карточку этого дня в Year.
 */
export function ArchiveScreen({ date, onBack, onOpenHelp }: { date: string; onBack: () => void; onOpenHelp?: (block: HelpBlockId) => void }) {
  const archive = useMemo(() => ({ date, onBack }), [date, onBack]);
  return <DayView store={archiveStore} archive={archive} onOpenHelp={onOpenHelp} />;
}
