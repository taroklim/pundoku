// @vitest-environment jsdom
// PD-275: куда ведёт строка дня в «Продолжить» хаба Play. Сегодняшний день и прошлый, который стор Today ещё держит (полночь на
// открытом приложении), — вкладка Today; прошлый, найденный в хранилище после перезапуска, — архив этой даты (та же запись и
// сетка, сегодняшний день на Today не вытесняется).
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const day = vi.hoisted(() => ({ snap: { date: "2026-10-07", phase: "playing", play: null as unknown } }));
const opened = vi.hoisted(() => ({ fn: null as ((date?: string) => void) | null }));
const archive = vi.hoisted(() => ({ props: null as { backTo?: string; onBack: () => void } | null }));
vi.mock("./today/dayStore", () => ({ dayStore: { getSnapshot: () => day.snap } }));
vi.mock("./play/store", () => ({ playStore: { reselect: vi.fn() } }));
vi.mock("./recovery/runtime", () => ({ recoveryStore: { held: false, guardLeave: () => false, requestLeave: (p: () => void) => p() } }));
vi.mock("./play/PlayScreen", () => ({
  PlayScreen: ({ onOpenToday }: { onOpenToday: (date?: string) => void }) => {
    opened.fn = onOpenToday;
    return <p>play</p>;
  },
}));
vi.mock("./today/TodayScreen", () => ({ TodayScreen: () => <p>today</p> }));
vi.mock("./today/ArchiveScreen", () => ({
  ArchiveScreen: (props: { date: string; backTo?: string; onBack: () => void }) => {
    archive.props = props;
    return <p>archive {props.date}</p>;
  },
}));
vi.mock("./year/YearTab", () => ({ YearTab: () => <p>year</p> }));
vi.mock("./help/HelpScreen", () => ({ HelpScreen: () => <p>help</p> }));
vi.mock("./recovery/SettingsScreen", () => ({ BACK_LABEL: { today: "Today", play: "Play", year: "Year" }, SettingsScreen: () => <p>settings</p> }));

import { App } from "./App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const TODAY = "2026-10-08";
const YESTERDAY = "2026-10-07";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 8, 9));
  day.snap = { date: TODAY, phase: "playing", play: null };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  window.history.replaceState(null, "", "#/play");
  await act(async () => root.render(<App />));
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("App › continueDay (PD-275)", () => {
  it("вчерашний из хранилища (стор Today уже на сегодняшнем) — архив этой даты", async () => {
    await act(async () => opened.fn!(YESTERDAY));
    expect(window.location.hash).toBe(`#/day/${YESTERDAY}`);
    expect(host.textContent).toContain(`archive ${YESTERDAY}`);
  });

  it("PD-282: архив, открытый из «Продолжить», — «‹ Play» обратно в Play (и после перезагрузки записи), а не в Year", async () => {
    await act(async () => opened.fn!(YESTERDAY));
    expect(archive.props!.backTo).toBe("play");
    expect(window.history.state).toEqual({ pdFrom: "play" });
    // popstate/hashchange той же записи (метка в history.state) — источник не теряется
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(archive.props!.backTo).toBe("play");
    await act(async () => archive.props!.onBack());
    expect(window.location.hash).toBe("#/play");
    expect(host.textContent).toContain("play");
    expect(host.textContent).not.toContain("archive");
  });

  it("PD-282: архив без метки источника (из Year, глубокая ссылка) — «‹ Year» на карточку дня, как раньше", async () => {
    window.history.replaceState(null, "", `#/day/${YESTERDAY}`);
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    expect(archive.props!.backTo).toBe("year");
    await act(async () => archive.props!.onBack());
    expect(window.location.hash).toBe(`#/year/${YESTERDAY}`);
  });

  it("сегодняшний и без даты — вкладка Today", async () => {
    await act(async () => opened.fn!(TODAY));
    expect(window.location.hash).toBe("#/today");
    window.history.replaceState(null, "", "#/play");
    await act(async () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    await act(async () => opened.fn!());
    expect(window.location.hash).toBe("#/today");
  });

  it("вчерашний, который стор Today ещё держит (полночь на открытом приложении), — Today, а не второй стор в архиве", async () => {
    day.snap = { date: YESTERDAY, phase: "playing", play: null };
    await act(async () => opened.fn!(YESTERDAY));
    expect(window.location.hash).toBe("#/today");
  });
});
