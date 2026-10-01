// @vitest-environment jsdom
// M10 (PD-89): панель вкладки получает вход (`panel enter`) только после навигации, не при первом показе.
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

vi.mock("./play/PlayScreen", () => ({ PlayScreen: () => <p>play</p> }));
vi.mock("./today/TodayScreen", () => ({ TodayScreen: () => <p>today</p> }));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", () => ({ YearTab: () => <p>year</p> }));
vi.mock("./recovery/SettingsScreen", () => ({ SettingsScreen: () => <p>settings</p> }));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  window.location.hash = "#/today";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const panel = () => host.querySelector<HTMLElement>('[role="tabpanel"]')!;

describe("M10: вход панели вкладки", () => {
  it("первый показ при запуске не анимируется, после смены вкладки — fadeRise (класс enter)", () => {
    act(() => root.render(<App />));
    expect(panel().textContent).toBe("today");
    expect(panel().className).toBe("panel");
    const tabs = host.querySelectorAll<HTMLElement>('[role="tab"]');
    act(() => tabs[2]!.click());
    expect(panel().textContent).toBe("year");
    expect(panel().classList.contains("enter")).toBe(true);
  });
});
