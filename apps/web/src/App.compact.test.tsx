// @vitest-environment jsdom
/**
 * PD-268: компакт десктопа C — альбомное окно ниже 1100 × 680 CSS px (ноутбук при 125/150 %: 1024×640, 853×533, 960×600).
 * Та же раскладка C (`.shell.desk`: тулбар, инспектор, слой окна, таб-бара нет), но без сайдбара — `.compact`. Держат:
 *  (1) включение по COMPACT_QUERY и только ниже DESK_QUERY (полная раскладка важнее); телефон (ни одного условия) — прежний;
 *  (2) сайдбар скрыт всегда, кнопка «Show sidebar» (aria-expanded) показывает его поверх контента — не запоминается
 *      (pundoku.sidebarHidden полной раскладки не трогается);
 *  (3) показан: фокус на выбранном пункте; Esc — убирает и возвращает фокус на кнопку (и дальше не идёт: не «назад» экрана);
 *      выбор пункта — переход и убирает; касание мимо панели — убирает;
 *  (4) смена окна на лету: компакт → полная — сайдбар по сохранённому выбору; обратно — снова скрыт.
 * Раскладку (поле, инспектор 2 × 2, прокрутка) jsdom не считает — она в design/pd268-check.mjs.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";
import { playStore } from "./play/store";
import { COMPACT_QUERY, DESK_QUERY, deskStore, isDeskCompact, isDeskLayout, isFullDesk, SIDEBAR_HIDDEN_KEY } from "./shell/desk";

vi.mock("./play/PlayScreen", () => ({ PlayScreen: () => <p>play</p> }));
vi.mock("./today/TodayScreen", async () => {
  const { TabHeader } = await import("./shell/TabHeader");
  return { TodayScreen: () => <TabHeader title={<h1 className="title">today</h1>} /> };
});
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", async () => {
  const { TabHeader } = await import("./shell/TabHeader");
  return { YearTab: () => <TabHeader title={<h1 className="title">year</h1>} /> };
});
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "Today", play: "Play", year: "Year" },
  SettingsScreen: () => <p>settings</p>,
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let fullOn = false;
let compactOn = false;
const mqListeners = new Set<() => void>();
const setWindow = (full: boolean, compact: boolean) => {
  fullOn = full;
  compactOn = compact;
  act(() => mqListeners.forEach((l) => l()));
};

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
});

beforeEach(() => {
  fullOn = false;
  compactOn = true;
  mqListeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      // Как в браузере: условие компакта (альбомное от 700 × 501) верно и для полной раскладки.
      return (query === DESK_QUERY && fullOn) || (query === COMPACT_QUERY && (compactOn || fullOn));
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => mqListeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => mqListeners.delete(cb),
  })) as never;
  localStorage.clear();
  deskStore.reset();
  window.history.replaceState(null, "", "#/today");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const render = () => act(() => root.render(<App />));
const shell = () => host.querySelector<HTMLElement>(".shell")!;
const q = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const toggle = () => host.querySelector<HTMLElement>(".tab-pane:not(.off) [data-testid='sidebar-toggle']")!;
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const key = (k: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

describe("условие компакта", () => {
  it("полная раскладка важнее компакта; без условий — телефон", () => {
    compactOn = true;
    expect([isFullDesk(), isDeskCompact(), isDeskLayout()]).toEqual([false, true, true]);
    fullOn = true;
    expect([isFullDesk(), isDeskCompact(), isDeskLayout()]).toEqual([true, false, true]);
    fullOn = false;
    compactOn = false;
    expect([isFullDesk(), isDeskCompact(), isDeskLayout()]).toEqual([false, false, false]);
    expect(COMPACT_QUERY).toBe("(orientation: landscape) and (min-width: 700px) and (min-height: 501px)");
  });
});

describe("компакт C: оболочка без сайдбара", () => {
  it("класс `shell desk compact side-off`, сайдбар скрыт, слой окна есть, в шапке «Show sidebar» (aria-expanded=false)", () => {
    render();
    expect(shell().className).toBe("shell desk compact side-off");
    expect(q("sidebar")!.hidden).toBe(true);
    expect(q("desk-layer")).not.toBeNull();
    expect(toggle().getAttribute("aria-label")).toBe("Show sidebar");
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
  });

  it("кнопка показывает сайдбар поверх контента: фокус на выбранном пункте; выбор не запоминается", () => {
    render();
    click(toggle());
    expect(q("sidebar")!.hidden).toBe(false);
    expect(shell().className).toBe("shell desk compact");
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-label")).toBe("Hide sidebar");
    expect(document.activeElement).toBe(q("side-today"));
    expect(localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBeNull();
    click(toggle());
    expect(q("sidebar")!.hidden).toBe(true);
  });

  it("Esc убирает сайдбар и возвращает фокус на кнопку; дальше Esc не идёт", () => {
    render();
    toggle().focus();
    click(toggle());
    expect(document.activeElement).toBe(q("side-today"));
    const later = vi.fn();
    document.addEventListener("keydown", later);
    key("Escape");
    document.removeEventListener("keydown", later);
    expect(q("sidebar")!.hidden).toBe(true);
    expect(document.activeElement).toBe(toggle());
    expect(later).not.toHaveBeenCalled();
    // Сайдбар убран — Esc снова обычный (до экрана доходит).
    const again = vi.fn();
    document.addEventListener("keydown", again);
    key("Escape");
    document.removeEventListener("keydown", again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("выбор пункта — переход и сайдбар убран", () => {
    render();
    click(toggle());
    click(q("side-year"));
    expect(window.location.hash).toBe("#/year");
    expect(q("sidebar")!.hidden).toBe(true);
    expect(host.querySelector(".tab-pane:not(.off) .title")!.textContent).toBe("year");
  });

  it("касание мимо панели убирает её; касание самой панели и кнопки — нет", () => {
    render();
    click(toggle());
    act(() => void q("side-play")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(q("sidebar")!.hidden).toBe(false);
    act(() => void toggle().dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(q("sidebar")!.hidden).toBe(false);
    act(() => void host.querySelector(".tab-pane:not(.off) .title")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(q("sidebar")!.hidden).toBe(true);
  });
});

describe("смена окна на лету", () => {
  it("компакт → полная: сайдбар по сохранённому выбору; обратно — снова скрыт, показ поверх не «всплывает»", () => {
    render();
    click(toggle());
    expect(q("sidebar")!.hidden).toBe(false);
    setWindow(true, true);
    expect(shell().className).toBe("shell desk");
    expect(q("sidebar")!.hidden).toBe(false);
    expect(toggle().getAttribute("aria-expanded")).toBeNull();
    setWindow(false, true);
    expect(shell().className).toBe("shell desk compact side-off");
    expect(q("sidebar")!.hidden).toBe(true);
  });

  it("скрытый в полной раскладке сайдбар: на компакте показ поверх не меняет сохранённый выбор", () => {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, "1");
    deskStore.reset();
    render();
    click(toggle());
    expect(q("sidebar")!.hidden).toBe(false);
    setWindow(true, true);
    expect(shell().className).toBe("shell desk side-off");
    expect(localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBe("1");
  });

  it("компакт → телефон (окно сузили/повернули): прежняя оболочка, без кнопки и класса", () => {
    render();
    setWindow(false, false);
    expect(shell().className).toBe("shell");
    expect(host.querySelector(".sidebar, .side-toggle, .desk-layer")).toBeNull();
  });
});
