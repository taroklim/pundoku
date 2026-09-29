import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PlayScreen } from "./play/PlayScreen";
import { ArchiveScreen } from "./today/ArchiveScreen";
import { dayStore } from "./today/dayStore";
import { TodayScreen } from "./today/TodayScreen";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import type { TabId } from "./shell/tabs";
import { useRoute } from "./shell/tabs";
import { YearTab } from "./year/YearTab";

/**
 * Каркас (PD-10): три вкладки Today · Play · Year, стеклянный таб-бар, тема по системе. Play — PD-11, Today — PD-12,
 * Year — PD-25. Архив (PD-33) — маршрут `#/day/YYYY-MM-DD` на вкладке Year: игра прошлого дня без затрагивания Today.
 */
export function App() {
  const { i18n } = useTranslation();
  const [route, go] = useRoute();
  const { tab, archiveDate } = route;
  const setTab = (next: TabId) => go({ tab: next });

  // «Play this day's puzzle» / «Finish this puzzle» из карточки дня Year. Вчерашний день, начатый на Today и не
  // доигранный к полуночи, остаётся в сторе Today (у него ходы): открывать его ещё и в архиве значило бы вести одну
  // запись дня из двух сторов — отправляем на Today.
  const playDay = (date: string) => {
    const s = dayStore.getSnapshot();
    if (s.date === date && s.phase === "playing" && s.play !== null && s.play.log.length > 0) setTab("today");
    else go({ archive: date });
  };

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  return (
    <div className="shell">
      <main className="scroll">
        <div
          key={archiveDate ? `day-${archiveDate}` : tab}
          className="panel"
          role="tabpanel"
          id={panelDomId(tab)}
          aria-labelledby={tabDomId(tab)}
          // На всех вкладках внутри есть кнопки/клетки — лишняя остановка Tab на оболочке не нужна.
        >
          {archiveDate ? (
            <ArchiveScreen date={archiveDate} onBack={() => go({ yearDay: archiveDate })} />
          ) : tab === "play" ? (
            <PlayScreen />
          ) : tab === "today" ? (
            <TodayScreen />
          ) : (
            <YearTab
              onOpenToday={() => setTab("today")}
              onPlayDay={playDay}
              initialDate={route.yearDate}
              onInitialDateConsumed={() => go({ tab: "year" })}
            />
          )}
        </div>
      </main>
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}
