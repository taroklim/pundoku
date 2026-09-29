import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PlayScreen } from "./play/PlayScreen";
import { Placeholder } from "./screens/Placeholder";
import { TodayScreen } from "./today/TodayScreen";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import { useTab } from "./shell/tabs";

/** Каркас (PD-10): три вкладки Today · Play · Year, стеклянный таб-бар, тема по системе. Play — PD-11, Today — PD-12. */
export function App() {
  const { i18n } = useTranslation();
  const [tab, setTab] = useTab();

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage ?? "en";
  }, [i18n.resolvedLanguage]);

  return (
    <div className="shell">
      <main className="scroll">
        <div
          key={tab}
          className="panel"
          role="tabpanel"
          id={panelDomId(tab)}
          aria-labelledby={tabDomId(tab)}
          // Панель без фокусируемого содержимого (заглушки) — сама точка табуляции (APG);
          // на Play/Today внутри есть клетки/кнопки, лишняя остановка на оболочке не нужна.
          tabIndex={tab === "play" || tab === "today" ? undefined : 0}
        >
          {tab === "play" ? <PlayScreen /> : tab === "today" ? <TodayScreen /> : <Placeholder tab={tab} />}
        </div>
      </main>
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}
