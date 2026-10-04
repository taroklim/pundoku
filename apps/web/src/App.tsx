import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpScreen } from "./help/HelpScreen";
import { PlayScreen } from "./play/PlayScreen";
import { playStore } from "./play/store";
import { recoveryStore } from "./recovery/runtime";
import { BACK_LABEL, SettingsScreen } from "./recovery/SettingsScreen";
import { ArchiveScreen } from "./today/ArchiveScreen";
import { dayStore } from "./today/dayStore";
import { TodayScreen } from "./today/TodayScreen";
import { useDynamicTypeFlag } from "./shell/dynamicType";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import { TabActiveContext, useTabSlide } from "./shell/tabSlide";
import type { HelpBlockId } from "./help/blocks";
import type { TabId } from "./shell/tabs";
import { leaveHelp, leaveSettings, TAB_IDS, useRoute } from "./shell/tabs";
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
  useDynamicTypeFlag();
  const settings = route.settings === true;
  const help = route.help ?? null;
  const pushed = settings || help !== null;
  // Пока ключ показан и не подтверждён, уход с Settings (вкладка, «‹ …») идёт через action sheet «Ключ ещё не сохранён».
  // PD-123: «‹» ведёт на вкладку-источник; тап по ней самой в таб-баре — тот же «назад» (не новая запись истории).
  const setTab = (next: TabId) => {
    // PD-144: повторный тап по ВЫБРАННОЙ вкладке Play — на хаб (привычка iOS: второе нажатие возвращает вкладку к корню).
    if (next === "play" && tab === "play" && !settings && help === null) return playStore.reselect();
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

  // Экран поверх стопки вкладок (Settings/справка/архив): вход M10 (fadeRise) только при навигации, не при первом показе.
  const overlay = pushed || archiveDate !== null;
  const panelKey = settings ? "settings" : help ? "help" : archiveDate ? `day-${archiveDate}` : tab;
  const [shownKey, setShownKey] = useState(panelKey);
  const [navigated, setNavigated] = useState(false);
  if (shownKey !== panelKey) {
    setShownKey(panelKey);
    setNavigated(true);
  }

  // PD-161: три панели вкладок смонтированы постоянно после первого посещения (ленивый первый маунт) — переход слайдом
  // показывает два экрана сразу, а состояние экрана (прокрутка, выбор клетки, раскрытые блоки) больше не теряется.
  const [visited, setVisited] = useState<ReadonlySet<TabId>>(() => new Set([tab]));
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));
  const stackRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const prewarm = useTabSlide(stackRef, pillRef, tab, overlay);

  // Layout-эффект, не обычный: `lang` задаёт переносы (`hyphens: auto`) и поэтому раскладку текста. Обычный эффект родителя идёт
  // ПОСЛЕ эффектов детей — справка успевала прокрутиться к блоку по раскладке с lang="en", а потом текст перекладывался (WebKit),
  // и заголовок блока уезжал вверх на 2–20 px.
  useLayoutEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  const screenOf = (id: TabId) =>
    id === "play" ? (
      <PlayScreen onOpenSettings={() => go({ settings: true })} onOpenHelp={openHelp} onOpenToday={() => setTab("today")} />
    ) : id === "today" ? (
      <TodayScreen onOpenSettings={() => go({ settings: true })} onOpenHelp={openHelp} />
    ) : (
      <YearTab
        onOpenSettings={() => go({ settings: true })}
        onOpenToday={() => setTab("today")}
        onPlayDay={playDay}
        // Year не потребляет `initialDate`, пока скрыт (md §6.1.4).
        initialDate={tab === "year" && !overlay ? route.yearDate : null}
        onInitialDateConsumed={() => go({ tab: "year" })}
      />
    );

  return (
    <div className="shell">
      {/* Пока открыт экран поверх, стопка вкладок под ним скрыта и inert, но НЕ размонтирована (md §6.1.5). */}
      <main ref={stackRef} className={overlay ? "stack covered" : "stack"} inert={overlay}>
        {TAB_IDS.filter((id) => visited.has(id)).map((id) => {
          const active = id === tab && !overlay;
          return (
            <div
              key={id}
              data-tab={id}
              // Своя прокрутка у каждой панели (`.scroll`): позиция Today/Year переживает смену вкладки, а правило
              // `.scroll:has(.play-fit, .play-hub)` срабатывает только для своей панели.
              className={id === tab ? "scroll tab-pane" : "scroll tab-pane off"}
              role="tabpanel"
              // У архива роль панели Year берёт экран поверх — id не дублируем.
              id={id === "year" && archiveDate !== null ? undefined : panelDomId(id)}
              aria-labelledby={tabDomId(id)}
              aria-hidden={!active}
              inert={!active}
            >
              <div className="panel">
                {/* PD-146: сбой вкладки не роняет приложение; экран сбоя сбрасывается, когда с вкладки уходят (PD-161). */}
                <ErrorBoundary scope="tab" active={active}>
                  <TabActiveContext.Provider value={active}>{screenOf(id)}</TabActiveContext.Provider>
                </ErrorBoundary>
              </div>
            </div>
          );
        })}
      </main>
      {overlay && (
        <div
          className="scroll push-layer"
          // Settings и справка — экраны поверх вкладки, а не её содержимое: роль панели только у архива (он живёт на Year).
          role={archiveDate !== null && !pushed ? "tabpanel" : undefined}
          id={archiveDate !== null && !pushed ? panelDomId("year") : undefined}
          aria-labelledby={archiveDate !== null && !pushed ? tabDomId("year") : undefined}
        >
          <div key={panelKey} className={navigated ? "panel enter" : "panel"}>
            <ErrorBoundary scope="tab">
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
              ) : null}
            </ErrorBoundary>
          </div>
        </div>
      )}
      <TabBar active={tab} onSelect={setTab} onPrewarm={prewarm} pillRef={pillRef} />
    </div>
  );
}
