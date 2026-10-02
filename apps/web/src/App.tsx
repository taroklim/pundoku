import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpScreen } from "./help/HelpScreen";
import { PlayScreen } from "./play/PlayScreen";
import { recoveryStore } from "./recovery/runtime";
import { BACK_LABEL, SettingsScreen } from "./recovery/SettingsScreen";
import { ArchiveScreen } from "./today/ArchiveScreen";
import { dayStore } from "./today/dayStore";
import { TodayScreen } from "./today/TodayScreen";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import type { HelpBlockId } from "./help/blocks";
import type { TabId } from "./shell/tabs";
import { leaveHelp, leaveSettings, useRoute } from "./shell/tabs";
import { YearTab } from "./year/YearTab";

/**
 * Каркас (PD-10): три вкладки Today · Play · Year, стеклянный таб-бар, тема по системе. Play — PD-11, Today — PD-12,
 * Year — PD-25. Архив (PD-33) — маршрут `#/day/YYYY-MM-DD` на вкладке Year: игра прошлого дня без затрагивания Today.
 */
export function App() {
  const { t, i18n } = useTranslation();
  // Браузерное «назад»/edge-swipe/правка адреса при показанном ключе — тот же шит «Ключ ещё не сохранён» (PD-57).
  const [route, go] = useRoute((proceed) => recoveryStore.guardLeave(proceed));
  const { tab, archiveDate } = route;
  const settings = route.settings === true;
  const help = route.help ?? null;
  const pushed = settings || help !== null;
  // Пока ключ показан и не подтверждён, уход с Settings (вкладка, «‹ …») идёт через action sheet «Ключ ещё не сохранён».
  // PD-123: «‹» ведёт на вкладку-источник; тап по ней самой в таб-баре — тот же «назад» (не новая запись истории).
  const setTab = (next: TabId) => {
    if (help !== null) return next === tab && help.via === "tab" ? leaveHelp(go) : go({ tab: next });
    if (!settings) return go({ tab: next });
    recoveryStore.requestLeave(() => (next === tab ? leaveSettings(go) : go({ tab: next })));
  };
  const openHelp = (block: HelpBlockId | null) => go({ help: block });

  // «Play this day's puzzle» / «Finish this puzzle» из карточки дня Year. Вчерашний день, начатый на Today и не
  // доигранный к полуночи, остаётся в сторе Today (у него ходы): открывать его ещё и в архиве значило бы вести одну
  // запись дня из двух сторов — отправляем на Today.
  const playDay = (date: string) => {
    const s = dayStore.getSnapshot();
    if (s.date === date && s.phase === "playing" && s.play !== null && s.play.log.length > 0) setTab("today");
    else go({ archive: date });
  };

  // M10: панель кроссфейдится только при смене вкладки/маршрута — первый показ при запуске не анимируется.
  const panelKey = settings ? "settings" : help ? "help" : archiveDate ? `day-${archiveDate}` : tab;
  const [shownKey, setShownKey] = useState(panelKey);
  const [navigated, setNavigated] = useState(false);
  if (shownKey !== panelKey) {
    setShownKey(panelKey);
    setNavigated(true);
  }

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  return (
    <div className="shell">
      <main className="scroll">
        <div
          key={panelKey}
          className={navigated ? "panel enter" : "panel"}
          // Settings и справка — экраны поверх вкладки, а не её содержимое: роль панели только у самих вкладок.
          role={pushed ? undefined : "tabpanel"}
          id={pushed ? undefined : panelDomId(tab)}
          aria-labelledby={pushed ? undefined : tabDomId(tab)}
          // На всех вкладках внутри есть кнопки/клетки — лишняя остановка Tab на оболочке не нужна.
        >
          {help ? (
            <HelpScreen
              block={help.block}
              backName={t(help.via === "settings" ? "settings.title" : `tabs.${tab}`)}
              backLabel={t(help.via === "settings" ? "help.backLabel" : BACK_LABEL[tab])}
              onBack={() => leaveHelp(go)}
            />
          ) : settings ? (
            <SettingsScreen
              store={recoveryStore}
              origin={tab}
              onBack={() => recoveryStore.requestLeave(() => leaveSettings(go))}
              onOpenHelp={() => recoveryStore.requestLeave(() => openHelp(null))}
            />
          ) : archiveDate ? (
            <ArchiveScreen date={archiveDate} onBack={() => go({ yearDay: archiveDate })} onOpenHelp={openHelp} />
          ) : tab === "play" ? (
            <PlayScreen onOpenSettings={() => go({ settings: true })} onOpenHelp={openHelp} />
          ) : tab === "today" ? (
            <TodayScreen onOpenSettings={() => go({ settings: true })} onOpenHelp={openHelp} />
          ) : (
            <YearTab
              onOpenSettings={() => go({ settings: true })}
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
