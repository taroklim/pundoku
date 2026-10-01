// @vitest-environment jsdom
// PD-60: проводка guard перехвата ухода с Settings в App (PD-57): `useRoute(guard)` вызывает `recoveryStore.guardLeave`,
// а «‹ Today»/вкладки из Settings идут через `recoveryStore.requestLeave`.
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const store = vi.hoisted(() => ({
  held: false,
  guardLeave: vi.fn<(proceed: () => void) => boolean>(),
  requestLeave: vi.fn<(proceed: () => void) => void>(),
}));
vi.mock("./recovery/runtime", () => ({ recoveryStore: store }));
vi.mock("./play/PlayScreen", () => ({ PlayScreen: () => <p>play</p> }));
vi.mock("./today/TodayScreen", () => ({ TodayScreen: () => <p>today</p> }));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", () => ({ YearTab: () => <p>year</p> }));
vi.mock("./recovery/SettingsScreen", () => ({
  SettingsScreen: ({ onBack }: { onBack: () => void }) => (
    <button type="button" data-testid="settings-back" onClick={onBack}>
      settings
    </button>
  ),
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const panelText = () => host.querySelector('[role="tabpanel"]')!.textContent;
const tabs = () => host.querySelectorAll<HTMLElement>('[role="tab"]');

beforeEach(() => {
  store.held = false;
  store.guardLeave.mockReset().mockImplementation(() => store.held);
  // Как настоящий стор: уход идёт сразу, если шит не держит.
  store.requestLeave.mockReset().mockImplementation((proceed) => {
    if (!store.held) proceed();
  });
  window.history.replaceState(null, "", "#/today");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const openSettings = async () => {
  await act(async () => root.render(<App />));
  await act(async () => window.history.pushState({ pdSettings: true }, "", "#/settings"));
  await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
  expect(host.querySelector('[data-testid="settings-back"]')).not.toBeNull();
};

describe("App: проводка guard ухода с Settings (PD-57/PD-60)", () => {
  it("правка адреса при показанном ключе: App передаёт guardLeave в useRoute, Settings остаётся, адрес возвращается", async () => {
    await openSettings();
    store.held = true;
    await act(async () => {
      window.location.hash = "#/year";
    });
    await settle();
    expect(store.guardLeave).toHaveBeenCalled();
    expect(host.querySelector('[data-testid="settings-back"]')).not.toBeNull();
    expect(window.location.hash).toBe("#/settings");
  });

  it("ключ не показан: тот же переход проходит без перехвата", async () => {
    await openSettings();
    await act(async () => {
      window.location.hash = "#/year";
    });
    await settle();
    expect(store.guardLeave).toHaveBeenCalled();
    expect(panelText()).toBe("year");
  });

  it("«‹ Today» и вкладки из Settings идут через requestLeave; пока шит держит — уход не происходит", async () => {
    await openSettings();
    store.held = true;
    await act(async () => host.querySelector<HTMLElement>('[data-testid="settings-back"]')!.click());
    expect(store.requestLeave).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-testid="settings-back"]')).not.toBeNull();
    await act(async () => tabs()[2]!.click()); // вкладка Year
    expect(store.requestLeave).toHaveBeenCalledTimes(2);
    expect(host.querySelector('[data-testid="settings-back"]')).not.toBeNull();
    // шит закрыт «Leave» (ключ стёрт): вкладка отрабатывает
    store.held = false;
    await act(async () => tabs()[2]!.click());
    expect(panelText()).toBe("year");
  });
});
