// @vitest-environment jsdom
// PD-120/PD-123: проводка App — шестерёнка с каждой вкладки открывает Settings «поверх» неё (подпись «‹» и подсветка
// вкладки — источник), справка открывается из Settings и по ссылке с карточки, «‹» возвращает на то место, откуда пришли.
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const store = vi.hoisted(() => ({
  guardLeave: vi.fn<(proceed: () => void) => boolean>(() => false),
  requestLeave: vi.fn<(proceed: () => void) => void>((proceed) => proceed()),
}));
vi.mock("./recovery/runtime", () => ({ recoveryStore: store }));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));

type Gear = { onOpenSettings?: () => void; onOpenHelp?: (b: "technique" | "grid") => void };
vi.mock("./play/PlayScreen", () => ({
  PlayScreen: ({ onOpenSettings, onOpenHelp }: Gear) => (
    <div>
      <button data-testid="play-gear" onClick={onOpenSettings} />
      <button data-testid="play-help" onClick={() => onOpenHelp?.("technique")} />
    </div>
  ),
}));
vi.mock("./today/TodayScreen", () => ({
  TodayScreen: ({ onOpenSettings, onOpenHelp }: Gear) => (
    <div>
      <button data-testid="today-gear" onClick={onOpenSettings} />
      <button data-testid="today-help" onClick={() => onOpenHelp?.("grid")} />
    </div>
  ),
}));
vi.mock("./year/YearTab", () => ({ YearTab: ({ onOpenSettings }: Gear) => <button data-testid="year-gear" onClick={onOpenSettings} /> }));
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "settings.backLabel", play: "settings.backLabelPlay", year: "settings.backLabelYear" },
  SettingsScreen: ({ onBack, origin, onOpenHelp }: { onBack: () => void; origin: string; onOpenHelp: () => void }) => (
    <div data-testid="settings-screen" data-origin={origin}>
      <button data-testid="settings-back" onClick={onBack} />
      <button data-testid="open-help" onClick={onOpenHelp} />
    </div>
  ),
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const press = async (id: string) => {
  await act(async () => q(id)!.click());
  await settle();
};
const selectedTab = () => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent;

beforeEach(async () => {
  store.requestLeave.mockClear();
  window.history.replaceState(null, "", "#/today");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<App />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("шестерёнка и «назад» на трёх вкладках (PD-123)", () => {
  it.each([
    ["today", "Today"],
    ["play", "Play"],
    ["year", "Year"],
  ])("с вкладки %s: Settings знает источник, таб подсвечен, «назад» возвращает на неё", async (tab, label) => {
    await act(async () => void (window.location.hash = `#/${tab}`));
    await settle();
    await press(`${tab}-gear`);
    expect(q("settings-screen")!.getAttribute("data-origin")).toBe(tab);
    expect(selectedTab()).toContain(label);
    expect(host.querySelector('[role="tabpanel"]:not([aria-hidden="true"])')).toBeNull(); // Settings — экран поверх вкладки, не её панель
    await press("settings-back");
    expect(q("settings-screen")).toBeNull();
    expect(window.location.hash).toBe(`#/${tab}`);
    expect(q(`${tab}-gear`)).not.toBeNull();
  });

  it("тап по вкладке-источнику в таб-баре из Settings = «назад»; по другой — переключает вкладку", async () => {
    await act(async () => void (window.location.hash = "#/play"));
    await settle();
    await press("play-gear");
    const tabs = [...host.querySelectorAll<HTMLElement>('[role="tab"]')];
    await act(async () => tabs.find((t) => t.textContent?.includes("Year"))!.click());
    await settle();
    expect(q("year-gear")).not.toBeNull();
    expect(q("settings-screen")).toBeNull();
  });
});

describe("справка (PD-120)", () => {
  it("из Settings: «‹ Settings», назад — в Settings той же вкладки", async () => {
    await act(async () => void (window.location.hash = "#/year"));
    await settle();
    await press("year-gear");
    await press("open-help");
    expect(q("help-screen")).not.toBeNull();
    expect(q("help-back")!.textContent).toBe("Settings");
    expect(q("help-back")!.getAttribute("aria-label")).toBe("Back to Settings");
    expect(selectedTab()).toContain("Year");
    await press("help-back");
    expect(q("settings-screen")!.getAttribute("data-origin")).toBe("year");
  });

  it("Settings → справка идёт через requestLeave (шит «ключ не сохранён» не обходится)", async () => {
    await press("today-gear");
    store.requestLeave.mockClear();
    await press("open-help");
    expect(store.requestLeave).toHaveBeenCalledTimes(1);
  });

  it("со ссылки «What’s this?» на Today: открывается нужный блок, «‹ Today» возвращает на карточку", async () => {
    await press("today-help");
    expect(window.location.hash).toBe("#/help/grid");
    expect(q("help-back")!.textContent).toBe("Today");
    expect(q("help-back")!.getAttribute("aria-label")).toBe("Back to Today");
    expect(document.activeElement!.id).toBe("help-h-grid");
    await press("help-back");
    expect(q("help-screen")).toBeNull();
    expect(q("today-gear")).not.toBeNull();
  });

  it("со ссылки на Play: подпись «‹ Play»", async () => {
    await act(async () => void (window.location.hash = "#/play"));
    await settle();
    await press("play-help");
    expect(q("help-back")!.textContent).toBe("Play");
    expect(selectedTab()).toContain("Play");
  });
});

describe("PD-232 (б): прокрутка общего слоя Settings/справки", () => {
  // jsdom не хранит scrollTop — держим его сами, по элементу.
  const tops = new WeakMap<Element, number>();
  let restore: () => void = () => undefined;
  beforeEach(() => {
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop")!;
    Object.defineProperty(Element.prototype, "scrollTop", {
      configurable: true,
      get(this: Element) {
        return tops.get(this) ?? 0;
      },
      set(this: Element, v: number) {
        tops.set(this, v);
      },
    });
    restore = () => Object.defineProperty(Element.prototype, "scrollTop", desc);
  });
  afterEach(() => restore());
  const layer = () => host.querySelector<HTMLElement>(".push-layer")!;
  const scrollLayer = (top: number) =>
    act(() => {
      layer().scrollTop = top;
      layer().dispatchEvent(new Event("scroll"));
    });

  it("справка из низа Settings открывается с начала; «‹ Settings» возвращает прежнюю позицию Settings", async () => {
    await press("today-gear");
    scrollLayer(640);
    await press("open-help");
    expect(q("help-screen")).not.toBeNull();
    expect(layer().scrollTop).toBe(0);
    scrollLayer(120);
    await press("help-back");
    expect(q("settings-screen")).not.toBeNull();
    expect(layer().scrollTop).toBe(640);
  });

  it("новый заход в Settings (после ухода на вкладку) — снова с начала", async () => {
    await press("today-gear");
    scrollLayer(640);
    await press("settings-back");
    expect(q("settings-screen")).toBeNull();
    await press("today-gear");
    expect(layer().scrollTop).toBe(0);
  });
});
