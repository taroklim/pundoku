// @vitest-environment jsdom
/**
 * PD-266: десктоп C «Сайдбар» — оболочка. Держат: (1) телефон/компакт — прежняя оболочка, ни сайдбара, ни кнопки, ни класса
 * (DOM не меняется); (2) от 1100 × 680 — сайдбар вместо таб-бара, выделение раздела/режима, переключение раскладки «на лету»;
 * (3) скрытие/показ с запоминанием; (4) маршрутизация режимов: режим с партией — на доску, без партии — страница режима,
 * Play — всегда на хаб. Раскладку jsdom не считает — она в design/pd266-check.mjs (Playwright).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";
import { createPlay } from "./play/logic";
import { playStore } from "./play/store";
import { DESK_QUERY, deskStore, SIDEBAR_HIDDEN_KEY } from "./shell/desk";
import { currentItem } from "./shell/Sidebar";

vi.mock("./play/PlayScreen", () => ({ PlayScreen: () => <p>play</p> }));
vi.mock("./today/TodayScreen", () => ({ TodayScreen: () => <p>today</p> }));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", () => ({ YearTab: () => <p>year</p> }));
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "Today", play: "Play", year: "Year" },
  SettingsScreen: () => <p>settings</p>,
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

interface Inner {
  snap: Record<string, unknown>;
  set(patch: Record<string, unknown>): void;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};

// matchMedia — одно условие DESK_QUERY; `change` переключает раскладку без перезагрузки (окно сузили/расширили, зум).
let deskOn = false;
const mqListeners = new Set<() => void>();
const flipLayout = (on: boolean) => {
  deskOn = on;
  act(() => mqListeners.forEach((l) => l()));
};

let host: HTMLDivElement;
let root: Root;

beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

beforeEach(() => {
  deskOn = false;
  mqListeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query === DESK_QUERY && deskOn;
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => mqListeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => mqListeners.delete(cb),
  })) as never;
  localStorage.clear();
  deskStore.reset();
  inner.snap = { ...base };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
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
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const currentIds = () => [...host.querySelectorAll('.sidebar [aria-current="page"]')].map((el) => el.getAttribute("data-testid"));

describe("раскладка: телефон и компакт не меняются", () => {
  it("без DESK_QUERY — прежняя оболочка: класс `shell`, таб-бар, ни сайдбара, ни кнопки", () => {
    render();
    expect(shell().className).toBe("shell");
    expect(host.querySelector(".tabbar")).not.toBeNull();
    expect(host.querySelector(".sidebar, .side-toggle")).toBeNull();
  });

  it("от 1100 × 680 — сайдбар с Today · Play + режимы · Year, таб-бар остаётся в DOM (скрыт стилем)", () => {
    deskOn = true;
    render();
    expect(shell().className).toBe("shell desk");
    const nav = q("sidebar")!;
    expect(nav.tagName).toBe("NAV");
    expect(nav.getAttribute("aria-label")).toBe("Sections");
    const labels = [...nav.querySelectorAll(".side-it .side-lab")].map((el) => el.textContent);
    expect(labels).toEqual(["Today", "Play", "Classic", "Ink", "Liar", "Melody", "Lantern", "Glyphs", "Year"]);
    expect(currentIds()).toEqual(["side-today"]);
    expect(host.querySelector(".tabbar")).not.toBeNull();
    expect(q("sidebar-toggle")!.getAttribute("aria-label")).toBe("Hide sidebar");
  });

  it("окно сузили (зум 125/150 %) — сайдбар уходит, вернули — возвращается; маршрут не теряется", () => {
    deskOn = true;
    render();
    click(q("side-year"));
    flipLayout(false);
    expect(shell().className).toBe("shell");
    expect(host.querySelector(".sidebar")).toBeNull();
    expect(host.querySelector('[role="tab"][aria-selected="true"]')!.id).toBe("tab-year");
    flipLayout(true);
    expect(currentIds()).toEqual(["side-year"]);
  });
});

describe("навигация сайдбаром", () => {
  it("Today / Year — разделы; на Settings ни один пункт не выбран", () => {
    deskOn = true;
    render();
    click(q("side-year"));
    expect(window.location.hash).toBe("#/year");
    expect(currentIds()).toEqual(["side-year"]);
    act(() => window.history.pushState({ pdSettings: true, pdFrom: "year" }, "", "#/settings"));
    act(() => void window.dispatchEvent(new PopStateEvent("popstate")));
    expect(currentIds()).toEqual([]);
    click(q("side-today"));
    expect(window.location.hash).toBe("#/today");
    expect(currentIds()).toEqual(["side-today"]);
  });

  it("стрелки ↑/↓ и Home/End ходят по пунктам", () => {
    deskOn = true;
    render();
    const today = q("side-today")!;
    act(() => today.focus());
    act(() => void today.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(document.activeElement).toBe(q("side-play"));
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
    expect(document.activeElement).toBe(q("side-year"));
    act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })));
    expect(document.activeElement).toBe(today);
  });

  it("режим без партии — вкладка Play и страница режима; выделен режим, не Play", () => {
    deskOn = true;
    render();
    click(q("side-mode-ink"));
    expect(window.location.hash).toBe("#/play");
    expect(deskStore.getSnapshot().modePage).toBe("ink");
    expect(playStore.getSnapshot().hub).toBe(true);
    expect(currentIds()).toEqual(["side-mode-ink"]);
  });

  it("режим с незаконченной партией — её доска, страница режима не открывается", () => {
    deskOn = true;
    const open = vi.spyOn(playStore, "open").mockImplementation((mode) => {
      inner.set({ hub: false, mode });
      return true;
    });
    render();
    click(q("side-mode-lantern"));
    expect(open).toHaveBeenCalledWith("lantern");
    expect(deskStore.getSnapshot().modePage).toBeNull();
    expect(currentIds()).toEqual(["side-mode-lantern"]);
  });

  it("режим, чья партия уже на доске, — ничего не трогает (не уходит на хаб)", () => {
    deskOn = true;
    act(() => inner.set({ hub: false, mode: "classic", phase: "playing", play: createPlay({ mission: MISSION, solution: SOLUTION }) }));
    const toHub = vi.spyOn(playStore, "toHub");
    render();
    click(q("side-mode-classic"));
    expect(toHub).not.toHaveBeenCalled();
    expect(playStore.getSnapshot().hub).toBe(false);
    expect(currentIds()).toEqual(["side-mode-classic"]);
  });

  it("Play — всегда хаб: закрывает страницу режима и уводит партию с доски (как повторный тап по вкладке)", () => {
    deskOn = true;
    render();
    click(q("side-mode-glyphs"));
    expect(deskStore.getSnapshot().modePage).toBe("glyphs");
    const reselect = vi.spyOn(playStore, "reselect");
    click(q("side-play"));
    expect(reselect).toHaveBeenCalledTimes(1);
    expect(deskStore.getSnapshot().modePage).toBeNull();
    expect(currentIds()).toEqual(["side-play"]);
  });

  it("у режима с незаконченной партией — «In progress», у остальных — без статуса", () => {
    deskOn = true;
    vi.spyOn(playStore, "slots").mockReturnValue({ melody: { difficulty: "easy", left: 30, elapsedMs: 1000, ink: false } });
    render();
    expect(q("side-mode-melody")!.querySelector(".side-meta")!.textContent).toBe("In progress");
    expect(q("side-mode-classic")!.querySelector(".side-meta")).toBeNull();
  });
});

describe("скрытие сайдбара запоминается", () => {
  it("кнопка прячет и показывает; выбор переживает перезапуск (localStorage)", () => {
    deskOn = true;
    render();
    click(q("sidebar-toggle"));
    expect(q("sidebar")!.hidden).toBe(true);
    expect(shell().className).toBe("shell desk side-off");
    expect(localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBe("1");
    expect(q("sidebar-toggle")!.getAttribute("aria-label")).toBe("Show sidebar");
    expect(q("sidebar-toggle")!.getAttribute("aria-controls")).toBe(q("sidebar")!.id);

    act(() => root.unmount());
    deskStore.reset(); // как новый запуск: состояние читается из хранилища
    root = createRoot(host);
    render();
    expect(q("sidebar")!.hidden).toBe(true);
    click(q("sidebar-toggle"));
    expect(q("sidebar")!.hidden).toBe(false);
    expect(localStorage.getItem(SIDEBAR_HIDDEN_KEY)).toBeNull();
  });

  it("на компакте скрытый сайдбар не мешает: прежняя оболочка, без кнопки", () => {
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, "1");
    deskStore.reset();
    render();
    expect(shell().className).toBe("shell");
    expect(q("sidebar-toggle")).toBeNull();
  });
});

describe("currentItem", () => {
  it("раздел; на Play — режим доски, страница режима или Play", () => {
    const hub = { hub: true, mode: "classic", restoring: false } as const;
    expect(currentItem("today", hub, "ink")).toBe("today");
    expect(currentItem(null, hub, null)).toBeNull();
    expect(currentItem("play", hub, null)).toBe("play");
    expect(currentItem("play", hub, "ink")).toBe("ink");
    expect(currentItem("play", { ...hub, hub: false, mode: "liar" }, "ink")).toBe("liar");
    expect(currentItem("play", { ...hub, restoring: true }, "ink")).toBe("play");
  });
});
