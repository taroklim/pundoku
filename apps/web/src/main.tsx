import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/play.css";
import "./styles/today.css";
import { App } from "./App";
import { startSync } from "./sync/runtime";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

// Устройство и снапшот (PD-14) стартуют в фоне: игра от них не зависит.
startSync();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
