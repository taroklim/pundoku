import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/play.css";
import "./styles/today.css";
import "./styles/year.css";
import "./styles/settings.css";
import "./styles/ink.css";
import "./styles/timelapse.css";
import "./styles/hint.css";
import "./styles/hub.css";
import "./styles/liar.css";
import "./styles/glyphs.css";
import "./styles/melody.css";
import "./styles/lantern.css";
import "./styles/pet.css";
import "./styles/brand.css";
import "./styles/desk.css";
import "./styles/landscape.css";
import { App } from "./App";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { readRoute } from "./shell/tabs";
import { startSync, sync } from "./sync/runtime";
import { dayStore } from "./today/dayStore";
import { recordFirstUse } from "./year/firstUse";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Устройство и снапшот (PD-14) стартуют в фоне: игра от них не зависит.
startSync();
// Year: дата первого запуска — раньше неё «пропусков» не рисуем (год/firstUse.ts).
void recordFirstUse(sync.repository);

// PD-147: холодный старт на Today — день грузится параллельно с первым рендером (IndexedDB, снапшот и API идут вне основного
// потока), а не после него: раньше загрузка начиналась из эффекта экрана, то есть после рендера и первой отрисовки.
const first = readRoute();
if (first.tab === "today" && first.archiveDate === null && first.settings !== true && first.help === undefined) dayStore.ensureStarted();
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
