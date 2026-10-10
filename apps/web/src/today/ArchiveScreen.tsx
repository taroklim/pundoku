import { useMemo } from "react";
import type { HelpBlockId } from "../help/blocks";
import type { TabId } from "../shell/tabs";
import { archiveStore } from "./dayStore";
import { DayView } from "./TodayScreen";

/**
 * Архив (PD-33): игра прошлой даты. Тот же экран, что Today (`DayView`: поле, панель, карточка результата), но
 * на отдельном `archiveStore` — сегодняшний день и Grid ∞ не затрагиваются. Маршрут `#/day/YYYY-MM-DD`,
 * «‹ Year» возвращает на карточку этого дня в Year; открытый из «Продолжить» хаба Play — «‹ Play» обратно в Play (PD-282).
 */
export function ArchiveScreen({
  date,
  onBack,
  backTo = "year",
  onOpenHelp,
}: {
  date: string;
  onBack: () => void;
  /** Куда ведёт «‹» — подпись кнопки (PD-282). */
  backTo?: TabId;
  onOpenHelp?: (block: HelpBlockId) => void;
}) {
  const archive = useMemo(() => ({ date, onBack, backTo }), [date, onBack, backTo]);
  return <DayView store={archiveStore} archive={archive} onOpenHelp={onOpenHelp} />;
}
