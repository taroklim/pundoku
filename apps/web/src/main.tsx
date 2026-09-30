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
import { App } from "./App";
import { startSync, sync } from "./sync/runtime";
import { recordFirstUse } from "./year/firstUse";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Устройство и снапшот (PD-14) стартуют в фоне: игра от них не зависит.
startSync();
// Year: дата первого запуска — раньше неё «пропусков» не рисуем (год/firstUse.ts).
void recordFirstUse(sync.repository);

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
