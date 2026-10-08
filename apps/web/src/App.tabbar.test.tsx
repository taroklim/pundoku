// @vitest-environment jsdom
// PD-221: тап по вкладке не перерисовывает экраны вкладок, которым нечего менять. Раньше App на каждой смене вкладки
// заново строил все три экрана (новые замыкания в пропсах) — React рендерил Today + Play + Year целиком до того, как
// вкладка подсветится и слайд стартует (WebKit, стенд design/pd221-tabbar.mjs: click → aria-selected ~100–130 мс).
// Экраны, которым активность нужна, получают её через TabActiveContext — перерисовываются только они.
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const renders = vi.hoisted(() => ({ play: 0, today: 0, year: 0 }));
const props = vi.hoisted(() => ({ year: [] as Record<string, unknown>[], play: [] as Record<string, unknown>[] }));
vi.mock("./play/PlayScreen", () => ({
  PlayScreen: (p: { onOpenToday?: () => void }) => {
    renders.play++;
    props.play.push(p);
    return (
      <button type="button" data-testid="open-today" onClick={() => p.onOpenToday?.()}>
        play
      </button>
    );
  },
}));
vi.mock("./today/TodayScreen", () => ({
  TodayScreen: () => {
    renders.today++;
    return <p>today</p>;
  },
}));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", () => ({
  YearTab: (p: Record<string, unknown>) => {
    renders.year++;
    props.year.push(p);
    const consumed = p.onInitialDateConsumed as () => void;
    useEffect(() => {
      if (p.initialDate) consumed();
    }, [p.initialDate, consumed]);
    return <p>year {String(p.initialDate)}</p>;
  },
}));
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "Today", play: "Play", year: "Year" },
  SettingsScreen: () => <p>settings</p>,
}));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  renders.play = renders.today = renders.year = 0;
  props.year.length = 0;
  props.play.length = 0;
  window.history.replaceState(null, "", "#/today");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const tab = (i: number) => host.querySelectorAll<HTMLElement>('[role="tab"]')[i]!;
const reset = () => {
  renders.play = renders.today = renders.year = 0;
};

describe("PD-221: смена вкладки не перерисовывает экраны", () => {
  it("после первого посещения тап по вкладке не рендерит заново ни один экран (активность — через контекст)", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    act(() => tab(2).click());
    act(() => tab(0).click());
    reset();
    act(() => tab(1).click()); // today -> play
    act(() => tab(2).click()); // play -> year
    act(() => tab(0).click()); // year -> today
    expect(renders).toEqual({ today: 0, play: 0, year: 0 });
    expect(tab(0).getAttribute("aria-selected")).toBe("true");
  }, 20_000); // первый тест файла платит импорт App

  it("колбэки экранов стабильны и видят актуальное состояние: «Today» из Play после смен вкладок ведёт на Today", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    act(() => tab(2).click());
    act(() => tab(1).click());
    const first = props.play[0]!;
    const last = props.play.at(-1)!;
    expect(last.onOpenToday).toBe(first.onOpenToday);
    act(() => host.querySelector<HTMLElement>('[data-testid="open-today"]')!.click());
    expect(tab(0).getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe("#/today");
  });

  it("Year по-прежнему получает initialDate своего адреса (#/year/YYYY-MM-DD) и сбрасывает его", () => {
    window.history.replaceState(null, "", "#/year/2026-10-01");
    act(() => root.render(<App />));
    expect(props.year.some((p) => p.initialDate === "2026-10-01")).toBe(true);
    expect(window.location.hash).toBe("#/year");
    expect(props.year.at(-1)!.initialDate).toBeNull();
  });
});
