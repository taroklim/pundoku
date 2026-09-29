import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { PlayScreen } from "./play/PlayScreen";
import { Placeholder } from "./screens/Placeholder";
import { panelDomId, tabDomId, TabBar } from "./shell/TabBar";
import { useTab } from "./shell/tabs";

/** Каркас (PD-10): три вкладки Today · Play · Year, стеклянный таб-бар, тема по системе. Play — PD-11. */
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
          tabIndex={0}
        >
          {tab === "play" ? <PlayScreen /> : <Placeholder tab={tab} />}
        </div>
      </main>
      <TabBar active={tab} onSelect={setTab} />
    </div>
  );
}
