// @vitest-environment jsdom
// PD-144 (§7.6): проводка «тап по уже выбранной вкладке Play → хаб» в App. Сам `PlayStore.reselect()` покрыт в `play/*`; здесь
// проверяется то, что раньше не ловилось ни одним тестом (мутация «убрать ветку в setTab» проходила весь набор): таб-бар App
// действительно зовёт `playStore.reselect()` — и только на ВЫБРАННОЙ вкладке Play, вне Settings/справки.
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const play = vi.hoisted(() => ({ reselect: vi.fn<() => void>() }));
const recovery = vi.hoisted(() => ({
  held: false,
  guardLeave: vi.fn<(proceed: () => void) => boolean>(() => false),
  requestLeave: vi.fn<(proceed: () => void) => void>((proceed) => proceed()),
}));
vi.mock("./play/store", () => ({ playStore: play }));
vi.mock("./recovery/runtime", () => ({ recoveryStore: recovery }));
vi.mock("./play/PlayScreen", () => ({ PlayScreen: () => <p>play</p> }));
vi.mock("./today/TodayScreen", () => ({ TodayScreen: () => <p>today</p> }));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", () => ({ YearTab: () => <p>year</p> }));
vi.mock("./help/HelpScreen", () => ({ HelpScreen: () => <p>help</p> }));
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "Today", play: "Play", year: "Year" },
  SettingsScreen: () => <p>settings</p>,
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const tab = (i: number) => host.querySelectorAll<HTMLElement>('[role="tab"]')[i]!;
const PLAY = 1;
const panelText = () => host.querySelector('[role="tabpanel"]:not([aria-hidden="true"])')?.textContent;
const mount = async (hash: string) => {
  window.history.replaceState(null, "", hash);
  await act(async () => root.render(<App />));
};

beforeEach(() => {
  play.reselect.mockReset();
  recovery.guardLeave.mockReset().mockReturnValue(false);
  recovery.requestLeave.mockReset().mockImplementation((proceed) => proceed());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("App: тап по выбранной вкладке Play (PD-144 §7.6)", () => {
  it("на Play повторный тап по «Play» зовёт playStore.reselect() — и остаётся на Play", async () => {
    await mount("#/play");
    expect(tab(PLAY).getAttribute("aria-selected")).toBe("true");
    await act(async () => tab(PLAY).click());
    expect(play.reselect).toHaveBeenCalledTimes(1);
    await act(async () => tab(PLAY).click());
    expect(play.reselect).toHaveBeenCalledTimes(2);
    expect(panelText()).toBe("play");
  });

  it("переход на Play с другой вкладки хаб не вызывает: доска, на которой остановились, остаётся (смена вкладки туда-обратно)", async () => {
    await mount("#/today");
    await act(async () => tab(PLAY).click());
    expect(panelText()).toBe("play");
    expect(play.reselect).not.toHaveBeenCalled();
    await act(async () => tab(0).click()); // на Today
    await act(async () => tab(PLAY).click()); // и обратно
    expect(play.reselect).not.toHaveBeenCalled();
  });

  it("повторный тап по Today / Year хаб Play не трогает", async () => {
    await mount("#/today");
    expect(tab(0).getAttribute("aria-selected")).toBe("true");
    await act(async () => tab(0).click());
    await act(async () => tab(2).click()); // на Year
    expect(tab(2).getAttribute("aria-selected")).toBe("true");
    await act(async () => tab(2).click());
    expect(play.reselect).not.toHaveBeenCalled();
    expect(panelText()).toBe("year");
  });

  it("из Settings и справки (origin = Play) тап по «Play» — обычный «назад», а не возврат на хаб", async () => {
    await mount("#/play");
    await act(async () => window.history.pushState({ pdSettings: true }, "", "#/settings"));
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(panelText()).toBeUndefined(); // у Settings роли tabpanel нет — это экран поверх вкладки
    expect(host.textContent).toContain("settings");
    await act(async () => tab(PLAY).click());
    expect(play.reselect).not.toHaveBeenCalled();
    expect(recovery.requestLeave).toHaveBeenCalledTimes(1);
  });

  it("с клавиатуры (стрелки/Home/End по таб-бару) повторного «выбора» нет: активная вкладка не переключается сама на себя", async () => {
    await mount("#/play");
    await act(async () => tab(PLAY).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(play.reselect).not.toHaveBeenCalled();
    expect(panelText()).toBe("year");
  });
});
