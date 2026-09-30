import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PlayScreen } from "./play/PlayScreen";
import { recoveryStore } from "./recovery/runtime";
import { SettingsScreen } from "./recovery/SettingsScreen";
import { ArchiveScreen } from "./today/ArchiveScreen";
import { dayStore } from "./today/dayStore";
import { TodayScreen } from "./today/TodayScreen";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import type { TabId } from "./shell/tabs";
import { leaveSettings, useRoute } from "./shell/tabs";
import { YearTab } from "./year/YearTab";

/**
 * Каркас (PD-10): три вкладки Today · Play · Year, стеклянный таб-бар, тема по системе. Play — PD-11, Today — PD-12,
 * Year — PD-25. Архив (PD-33) — маршрут `#/day/YYYY-MM-DD` на вкладке Year: игра прошлого дня без затрагивания Today.
 */
export function App() {
  const { i18n } = useTranslation();
  // Браузерное «назад»/edge-swipe/правка адреса при показанном ключе — тот же шит «Ключ ещё не сохранён» (PD-57).
  const [route, go] = useRoute((proceed) => recoveryStore.guardLeave(proceed));
  const { tab, archiveDate } = route;
  const settings = route.settings === true;
  // Пока ключ показан и не подтверждён, уход с Settings (вкладка, «‹ Today») идёт через action sheet «Ключ ещё не сохранён».
  const setTab = (next: TabId) => {
    if (!settings) return go({ tab: next });
    recoveryStore.requestLeave(() => (next === "today" ? leaveSettings(go) : go({ tab: next })));
  };

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
          key={settings ? "settings" : archiveDate ? `day-${archiveDate}` : tab}
          className="panel"
          role="tabpanel"
          id={panelDomId(tab)}
          aria-labelledby={tabDomId(tab)}
          // На всех вкладках внутри есть кнопки/клетки — лишняя остановка Tab на оболочке не нужна.
        >
          {settings ? (
            <SettingsScreen store={recoveryStore} onBack={() => recoveryStore.requestLeave(() => leaveSettings(go))} />
          ) : archiveDate ? (
            <ArchiveScreen date={archiveDate} onBack={() => go({ yearDay: archiveDate })} />
          ) : tab === "play" ? (
            <PlayScreen />
          ) : tab === "today" ? (
            <TodayScreen onOpenSettings={() => go({ settings: true })} />
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
