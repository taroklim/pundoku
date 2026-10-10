import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { HelpScreen } from "./help/HelpScreen";
import { PlayScreen } from "./play/PlayScreen";
import { playStore } from "./play/store";
import { recoveryStore } from "./recovery/runtime";
import { BACK_LABEL, SettingsScreen } from "./recovery/SettingsScreen";
import { ArchiveScreen } from "./today/ArchiveScreen";
import { localDate } from "./today/dayResolver";
import { dayStore } from "./today/dayStore";
import { TodayScreen } from "./today/TodayScreen";
import { deskStore, SIDEBAR_ID, useDeskLayout, useSidebarView } from "./shell/desk";
import { useDynamicTypeFlag } from "./shell/dynamicType";
import { isStandalone, useEdgeBack } from "./shell/edgeBack";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { useEscapeBack } from "./shell/escapeBack";
import { PortalHostContext } from "./shell/portalHost";
import { Sidebar } from "./shell/Sidebar";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import { TabActiveContext, useTabSlide } from "./shell/tabSlide";
import type { HelpBlockId } from "./help/blocks";
import type { ModeId } from "./play/modes";
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
  const { tab, archiveDate, archiveFrom } = route;
  useDynamicTypeFlag();
  const settings = route.settings === true;
  const help = route.help ?? null;
  const pushed = settings || help !== null;
  // Пока ключ показан и не подтверждён, уход с Settings (вкладка, «‹ …») идёт через action sheet «Ключ ещё не сохранён».
  // PD-123: «‹» ведёт на вкладку-источник; тап по ней самой в таб-баре — тот же «назад» (не новая запись истории).
  // `then` — что сделать после перехода (PD-266: сайдбар открывает ещё и режим/хаб Play); с Settings — только после guard'а.
  const navigate = (next: TabId, then?: () => void) => {
    if (help !== null) {
      if (next === tab && help.via === "tab") leaveHelp(go);
      else go({ tab: next });
      return then?.();
    }
    if (!settings) {
      go({ tab: next });
      return then?.();
    }
    recoveryStore.requestLeave(() => {
      if (next === tab) leaveSettings(go);
      else go({ tab: next });
      then?.();
    });
  };
  const setTab = (next: TabId) => {
    // PD-144: повторный тап по ВЫБРАННОЙ вкладке Play — на хаб (привычка iOS: второе нажатие возвращает вкладку к корню).
    if (next === "play" && tab === "play" && !settings && help === null) return playStore.reselect();
    navigate(next);
  };
  const openHelp = (block: HelpBlockId | null) => go({ help: block });

  // PD-266: десктоп C — сайдбар вместо таб-бара (от 1100 × 680 CSS px; на телефоне — прежняя оболочка). PD-268: компакт C
  // (альбомное окно ниже 1100 × 680 — ноутбук при 125/150 %) — та же раскладка, сайдбар скрыт и показывается поверх контента.
  const desk = useDeskLayout();
  const { hidden: sideHidden, compact } = useSidebarView();
  useCompactSidebar(desk && compact && !sideHidden);
  // PD-267: шиты, меню и тост в раскладке с сайдбаром — в слое окна внутри `.shell.desk` (контент-область, не поверх сайдбара).
  const [deskLayer, setDeskLayer] = useState<HTMLDivElement | null>(null);
  // Пункт сайдбара — место назначения, а не вкладка «как оставили»: Play всегда ведёт на хаб (как повторный тап по вкладке),
  // режим — на свою незаконченную партию или, если её нет, на страницу режима (хаб Play → страница режима, макет C).
  const sideTab = (next: TabId) => {
    // PD-268: на компакте сайдбар поверх контента — выбор пункта его убирает (как всплывающая панель).
    deskStore.setCompactOpen(false);
    if (next !== "play") return setTab(next);
    navigate("play", () => {
      deskStore.showModePage(null);
      playStore.reselect();
    });
  };
  const sideMode = (mode: ModeId) => {
    deskStore.setCompactOpen(false);
    navigate("play", () => {
      const s = playStore.getSnapshot();
      // Партия этого режима уже на доске (идёт, грузится или решена) — оставить как есть.
      if (!s.hub && s.mode === mode && !s.daily) return deskStore.showModePage(null);
      playStore.toHub();
      deskStore.showModePage(playStore.open(mode) ? null : mode);
    });
  };
  // PD-232 (г): Esc на Settings/справке — то же, что «‹» (архив решает сам: в партии Esc снимает выбор, а не уводит).
  useEscapeBack(pushed, () => (help !== null ? leaveHelp(go) : recoveryStore.requestLeave(() => leaveSettings(go))));

  // «Play this day's puzzle» / «Finish this puzzle» из карточки дня Year. Вчерашний день, начатый на Today и не
  // доигранный к полуночи, остаётся в сторе Today (у него ходы): открывать его ещё и в архиве значило бы вести одну
  // запись дня из двух сторов — отправляем на Today.
  const playDay = (date: string) => {
    const s = dayStore.getSnapshot();
    if (s.date === date && s.phase === "playing" && s.play !== null && s.play.log.length > 0) setTab("today");
    else go({ archive: date });
  };

  // PD-275: строка дня в «Продолжить» хаба Play. Сегодняшний день (или прошлый, который стор Today ещё держит — полночь на
  // открытом приложении) — вкладка Today; прошлый, найденный в хранилище после перезапуска (стор Today уже на сегодняшнем), —
  // архив этой даты: та же запись, та же сетка, сегодняшний день на Today не вытесняется. Одна запись — один стор.
  const continueDay = (date?: string) => {
    const s = dayStore.getSnapshot();
    if (!date || date === localDate() || (s.date === date && s.phase === "playing")) setTab("today");
    else go({ archive: date, from: "play" }); // PD-282: «‹ Play» — обратно в хаб, а не в Year
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
  // PD-232 (б), аудит PD-228 п. 10: Settings, справка и архив делят один прокручиваемый слой `.push-layer`, и scrollTop
  // переезжал с экрана на экран — справка, открытая из низа Settings, оказывалась прокручена в самый низ. Позиция каждого экрана
  // слоя — своя: справка всегда с начала (ссылка на блок докручивает сама, HelpScreen), возврат на экран слоя — к его прежней
  // позиции, пока слой открыт; закрыли слой — забыли (новый заход в Settings — снова сверху, как было).
  const pushRef = useRef<HTMLDivElement>(null);
  const pushTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const el = pushRef.current;
    if (!el) {
      pushTops.current.clear();
      return;
    }
    const top = panelKey === "help" ? 0 : (pushTops.current.get(panelKey) ?? 0);
    if (el.scrollTop !== top) el.scrollTop = top;
  }, [panelKey, overlay]);
  const stackRef = useRef<HTMLElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  // PD-266: в раскладке с сайдбаром разделы сменяются кроссфейдом (вертикальный список — горизонтальная лента не к месту).
  const prewarm = useTabSlide(stackRef, pillRef, tab, overlay, desk);

  // PD-253: «назад» от левого края на Settings/справке — только в установленном приложении (в Safari-вкладке у системы свой).
  // Ведёт ровно туда же, куда «‹»/Esc; Settings — через guard PD-57 (несохранённый ключ → шит, экран остаётся). После
  // useTabSlide: тот должен увидеть «вкладка уже видна под экраном», до того как жест снимет свои атрибуты.
  const [standalone] = useState(isStandalone);
  const edgeBack = pushed && standalone;
  useEdgeBack(pushRef, stackRef, {
    enabled: edgeBack,
    screen: panelKey,
    peek: settings || help?.via === "tab",
    intercept: () => help === null && recoveryStore.guardLeave(() => leaveSettings(go)),
    onBack: () => (help !== null ? leaveHelp(go) : leaveSettings(go)),
  });

  // Layout-эффект, не обычный: `lang` задаёт переносы (`hyphens: auto`) и поэтому раскладку текста. Обычный эффект родителя идёт
  // ПОСЛЕ эффектов детей — справка успевала прокрутиться к блоку по раскладке с lang="en", а потом текст перекладывался (WebKit),
  // и заголовок блока уезжал вверх на 2–20 px.
  useLayoutEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  // PD-221: колбэки экранов вкладок — стабильные (одни и те же функции весь срок жизни App), но всегда зовут актуальные
  // `go`/`setTab`/`playDay`: иначе каждая смена вкладки давала экранам новые пропсы и React перерисовывал все три экрана
  // до подсветки вкладки и старта слайда.
  const latest = useRef({ go, setTab, playDay, continueDay, openHelp });
  latest.current = { go, setTab, playDay, continueDay, openHelp };
  const actions = useMemo<TabActions>(
    () => ({
      openSettings: () => latest.current.go({ settings: true }),
      openHelp: (block) => latest.current.openHelp(block),
      openToday: () => latest.current.setTab("today"),
      playDay: (date) => latest.current.playDay(date),
      continueDay: (date) => latest.current.continueDay(date),
      yearConsumed: () => latest.current.go({ tab: "year" }),
    }),
    [],
  );

  return (
    <PortalHostContext.Provider value={desk ? deskLayer : null}>
    <div className={desk ? `shell desk${compact ? " compact" : ""}${sideHidden ? " side-off" : ""}` : "shell"}>
      {/* PD-267: кнопка сайдбара — в шапке каждого экрана (TabHeader, навбар Settings/справки), не поверх контента. */}
      {desk && <Sidebar section={pushed ? null : tab} hidden={sideHidden} onSelectTab={sideTab} onSelectMode={sideMode} />}
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
                  <TabActiveContext.Provider value={active}>
                    {/* Year не потребляет `initialDate`, пока скрыт (md §6.1.4). */}
                    <TabScreen id={id} actions={actions} yearDate={id === "year" && tab === "year" && !overlay ? route.yearDate : null} />
                  </TabActiveContext.Provider>
                </ErrorBoundary>
              </div>
            </div>
          );
        })}
      </main>
      {overlay && (
        <div
          ref={pushRef}
          className="scroll push-layer"
          data-edge-back={edgeBack ? "" : undefined}
          onScroll={(e) => pushTops.current.set(panelKey, e.currentTarget.scrollTop)}
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
                <ArchiveScreen
                  date={archiveDate}
                  backTo={archiveFrom ?? "year"}
                  onBack={() => go(archiveFrom ? { tab: archiveFrom } : { yearDay: archiveDate })}
                  onOpenHelp={openHelp}
                />
              ) : null}
            </ErrorBoundary>
          </div>
        </div>
      )}
      {/* На десктопе C таб-бар скрыт стилем (desk.css), а не размонтирован: пилюля и движок слайда живут, пока окно сужают. */}
      <TabBar active={tab} onSelect={setTab} onPrewarm={prewarm} pillRef={pillRef} />
      {desk && <div ref={setDeskLayer} className="desk-layer" data-testid="desk-layer" />}
    </div>
    </PortalHostContext.Provider>
  );
}

interface TabActions {
  openSettings: () => void;
  openHelp: (block: HelpBlockId | null) => void;
  openToday: () => void;
  playDay: (date: string) => void;
  continueDay: (date?: string) => void;
  yearConsumed: () => void;
}

/**
 * Экран вкладки в стопке (PD-221). memo: при смене вкладки его пропсы не меняются (колбэки стабильны, `yearDate` есть только
 * у Year на его адресе), поэтому React его не перерисовывает — активность экран получает из TabActiveContext, перерисовываются
 * только её потребители. Свои сторы экраны читают подпиской, от перерисовки родителя они не зависят.
 */
const TabScreen = memo(function TabScreen({ id, actions, yearDate }: { id: TabId; actions: TabActions; yearDate: string | null }) {
  if (id === "play") return <PlayScreen onOpenSettings={actions.openSettings} onOpenHelp={actions.openHelp} onOpenToday={actions.continueDay} />;
  if (id === "today") return <TodayScreen onOpenSettings={actions.openSettings} onOpenHelp={actions.openHelp} />;
  return (
    <YearTab
      onOpenSettings={actions.openSettings}
      onOpenToday={actions.openToday}
      onPlayDay={actions.playDay}
      initialDate={yearDate}
      onInitialDateConsumed={actions.yearConsumed}
    />
  );
});

/**
 * PD-268: сайдбар поверх контента на компакте — всплывающая панель, не модальная: при показе фокус на выбранном пункте (или
 * первом), Esc убирает её и возвращает фокус на кнопку, клик/касание мимо панели и кнопки — убирает (сам клик проходит дальше,
 * как у сайдбара в узком окне на Mac). Сменилась раскладка (окно расширили до полной) — состояние сбрасывается.
 */
function useCompactSidebar(open: boolean) {
  useEffect(() => {
    if (!open) return;
    // Куда вернуть фокус: кнопка сайдбара на экране. Safari по клику мышью кнопку не фокусирует — тогда ищем видимую кнопку.
    const toggles = [...document.querySelectorAll<HTMLElement>(`[aria-controls="${SIDEBAR_ID}"]`)];
    const opener = toggles.find((el) => el === document.activeElement) ?? toggles.find((el) => el.getClientRects().length > 0 && !el.closest("[inert]")) ?? null;
    const side = document.getElementById(SIDEBAR_ID);
    (side?.querySelector<HTMLElement>('.side-it[aria-current="page"]') ?? side?.querySelector<HTMLElement>(".side-it"))?.focus({ preventScroll: true });
    const close = (refocus: boolean) => {
      deskStore.setCompactOpen(false);
      if (refocus && opener?.isConnected) opener.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest(`#${SIDEBAR_ID}, .side-toggle`)) return;
      close(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // Раньше Esc экрана (назад с Settings, снять выбор клетки): сначала уходит панель.
      e.preventDefault();
      e.stopImmediatePropagation();
      close(true);
    };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);
  // Ушли с компакта (окно расширили, зум вернули) — панель не должна «всплыть» при следующем сужении.
  const { compact } = useSidebarView();
  useEffect(() => {
    if (!compact) deskStore.setCompactOpen(false);
  }, [compact]);
}
