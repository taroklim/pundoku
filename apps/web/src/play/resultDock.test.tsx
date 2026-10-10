// @vitest-environment jsdom
/**
 * PD-285 (design/pd285-result-card.md §6, §7): док действий карточки «решено» в Play на телефоне. Логика дока: где он есть
 * (телефонная карточка Play) и где его нет (AX3, ландшафт телефона, десктоп C); одна копия кнопок (testid прежние), порядок
 * «карточка → док», внутри дока Watch → Share → New puzzle; без повтора — в доке одна New puzzle, строка «повтор недоступен» —
 * в карточке; у группы дока имя — заголовок карточки (у Лжеца — «Liar caught»). Геометрию (sticky у таб-бара, растушёвка,
 * прокрутка) jsdom не считает — она в живой проверке (design/pd285-check.mjs); правила play.css — resultDock.css.test.ts.
 */
import { dailyLiarPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { DESK_QUERY } from "../shell/desk";
import { accuseCell, createLiarPlay } from "./liar";
import { createPlay, enterDigit } from "./logic";
import type { PlayState } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { DOCK_LANDSCAPE_QUERY, resultDockOn } from "./resultDock";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

function solved(): PlayState {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  [...Array(81).keys()].filter((i) => MISSION[i] === "0").forEach((c, k) => (p = enterDigit(p, c, p.solution[c] as number, (k + 1) * 100)));
  expect(p.solved).toBe(true);
  return p;
}
function solvedLiar(): PlayState {
  const P = dailyLiarPuzzle("2026-10-05", "medium");
  let s = createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
  s.mission.forEach((g, c) => {
    if (g === 0) s = enterDigit(s, c, s.solution[c]!, 1000 * (c + 1));
  });
  return accuseCell(s, P.liarCell, 999_000)!.play;
}

interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};
beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});
const solvedSnap = (play: PlayState, extra: Record<string, unknown> = {}) =>
  (inner.snap = { ...inner.snap, hub: false, restoring: false, phase: "solved", remoteSolved: true, play, selected: null, notesMode: false, startedOn: new Date(2026, 9, 2, 12), ...extra });

/** matchMedia с управляемыми запросами: `on` — какие запросы сейчас истинны; `fire()` — разослать change. */
const media = { on: new Set<string>(), listeners: new Set<() => void>() };
const fire = () => act(() => media.listeners.forEach((cb) => cb()));

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const id = (tid: string) => q(`[data-testid="${tid}"]`);
const render = () => act(() => root.render(<PlayScreen onOpenHelp={() => undefined} />));
/** Атрибут ставит useDynamicTypeFlag; MutationObserver доставляет запись микрозадачей — ждём её внутри act. */
const setAx3 = async (on: boolean) => {
  await act(async () => {
    if (on) document.documentElement.setAttribute("data-type", "ax3");
    else document.documentElement.removeAttribute("data-type");
    await Promise.resolve();
  });
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  media.on.clear();
  media.listeners.clear();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return media.on.has(query);
    },
    media: query,
    addEventListener: (_: string, cb: () => void) => media.listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => media.listeners.delete(cb),
  })) as never;
  inner.snap = { ...base };
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.documentElement.removeAttribute("data-type");
  vi.useRealTimers();
});

describe("resultDockOn: где док есть", () => {
  it("только телефонная карточка Play, не AX3, не ландшафт телефона", () => {
    expect(resultDockOn({ phoneCard: true, ax3: false, landscape: false })).toBe(true);
    expect(resultDockOn({ phoneCard: true, ax3: true, landscape: false })).toBe(false);
    expect(resultDockOn({ phoneCard: true, ax3: false, landscape: true })).toBe(false);
    expect(resultDockOn({ phoneCard: false, ax3: false, landscape: false })).toBe(false);
  });
});

describe("Play, телефон, партия решена: док", () => {
  it("кнопки — в доке сразу после карточки, по одной копии, порядок Watch → Share → New puzzle; у группы имя «Solved»", () => {
    solvedSnap(solved());
    render();
    const screen = q(".play")!;
    expect(screen.classList.contains("play-result-dock")).toBe(true);
    const card = id("result-card")!;
    const dock = id("result-dock")!;
    expect(card.nextElementSibling).toBe(dock); // DOM: карточка → док (порядок VoiceOver/Tab)
    expect(dock.getAttribute("role")).toBe("group");
    expect(dock.getAttribute("aria-label")).toBe("Solved");
    expect([...dock.children].map((c) => c.getAttribute("data-testid"))).toEqual(["tl-watch", "share", "new-puzzle"]);
    for (const t of ["tl-watch", "share", "new-puzzle"]) expect(host.querySelectorAll(`[data-testid="${t}"]`), t).toHaveLength(1);
    expect(card.querySelector("button.tl-watch, button.share, .newgrid")).toBeNull();
    expect(card.querySelector('[data-testid="tl-nolog"]')).toBeNull();
    // Строки карточки на месте, «What's this?» остаётся в карточке (это часть строки, а не действие дока).
    expect(card.querySelector('[data-testid="technique-help"]')).not.toBeNull();
  });

  it("New puzzle из дока открывает шит режима; Watch — плеер таймлапса (обработчики те же)", () => {
    solvedSnap(solved());
    render();
    act(() => id("new-puzzle")!.click());
    expect(document.querySelector('[data-testid="mode-sheet"]')).not.toBeNull();
    act(() => document.querySelector<HTMLElement>('[data-testid="sheet-cancel"]')!.click());
    act(() => id("tl-watch")!.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("без повтора (лог не цельный): в доке одна New puzzle (единственный ребёнок → тонированная во всю ширину), пояснение — в карточке", () => {
    solvedSnap({ ...solved(), logSynthetic: true });
    render();
    const dock = id("result-dock")!;
    expect([...dock.children].map((c) => c.getAttribute("data-testid"))).toEqual(["new-puzzle"]);
    expect(dock.querySelector(".newgrid:only-child")).not.toBeNull();
    expect(id("share")).toBeNull();
    expect(id("tl-watch")).toBeNull();
    expect(id("result-card")!.querySelector('[data-testid="tl-nolog"]')).not.toBeNull();
  });

  it("Лжец: имя группы дока — заголовок карточки «Liar caught»; кнопки те же", () => {
    solvedSnap(solvedLiar(), { mode: "liar", difficulty: "medium", daily: null });
    render();
    expect(id("result-card")!.querySelector("h2")!.textContent).toBe("Liar caught");
    const dock = id("result-dock")!;
    expect(dock.getAttribute("aria-label")).toBe("Liar caught");
    expect(dock.querySelector('[data-testid="new-puzzle"]')).not.toBeNull();
  });

  it("фокус в карточке под доком докручивается над док (scrollIntoView block end); фокус в доке и на самой карточке — нет", () => {
    solvedSnap(solved());
    render();
    const dock = id("result-dock")!;
    const help = id("technique-help")!;
    const rect = (top: number, bottom: number) => () => ({ top, bottom, left: 0, right: 100, width: 100, height: bottom - top, x: 0, y: top, toJSON() {} }) as DOMRect;
    dock.getBoundingClientRect = rect(634, 754);
    const spy = vi.fn();
    help.scrollIntoView = spy;
    help.getBoundingClientRect = rect(700, 724); // под доком
    act(() => help.focus());
    expect(spy).toHaveBeenCalledWith({ block: "end", inline: "nearest" });
    spy.mockClear();
    help.blur();
    help.getBoundingClientRect = rect(500, 524); // над доком — браузер справится сам
    act(() => help.focus());
    expect(spy).not.toHaveBeenCalled();
    const watch = id("tl-watch")!;
    watch.scrollIntoView = spy;
    act(() => watch.focus());
    expect(spy).not.toHaveBeenCalled();
    expect(q(".play")!.style.getPropertyValue("--dock-h")).toMatch(/px$/);
  });

  it("uk / ru: имя группы — локализованный заголовок", async () => {
    solvedSnap(solved());
    await act(() => i18n.changeLanguage("uk"));
    render();
    expect(id("result-dock")!.getAttribute("aria-label")).toBe(id("result-card")!.querySelector("h2")!.textContent);
    await act(() => i18n.changeLanguage("ru"));
    expect(id("result-dock")!.getAttribute("aria-label")).toBe(id("result-card")!.querySelector("h2")!.textContent);
  });
});

describe("где дока нет — кнопки в конце карточки, как раньше", () => {
  const inCard = () => [...id("result-card")!.querySelectorAll("button.tl-watch, button.share, .newgrid")].map((b) => b.getAttribute("data-testid"));

  it("AX3: дока нет, кнопки в карточке в прежнем порядке; смена размера текста переносит их без перезагрузки", async () => {
    await setAx3(true);
    solvedSnap(solved());
    render();
    expect(id("result-dock")).toBeNull();
    expect(q(".play")!.classList.contains("play-result-dock")).toBe(false);
    expect(inCard()).toEqual(["tl-watch", "share", "new-puzzle"]);
    await setAx3(false);
    expect(id("result-dock")).not.toBeNull();
    expect(inCard()).toEqual([]);
    await setAx3(true);
    expect(id("result-dock")).toBeNull();
    expect(inCard()).toEqual(["tl-watch", "share", "new-puzzle"]);
  });

  it("ландшафт телефона: дока нет; поворот в портрет — док появляется", () => {
    media.on.add(DOCK_LANDSCAPE_QUERY);
    solvedSnap(solved());
    render();
    expect(id("result-dock")).toBeNull();
    expect(inCard()).toEqual(["tl-watch", "share", "new-puzzle"]);
    media.on.delete(DOCK_LANDSCAPE_QUERY);
    fire();
    expect(id("result-dock")).not.toBeNull();
    expect(inCard()).toEqual([]);
  });

  it("десктоп C (≥ 1100×680): карточка в инспекторе, .result-dock в DOM нет", () => {
    media.on.add(DESK_QUERY);
    solvedSnap(solved());
    render();
    expect(q(".result-dock")).toBeNull();
    expect(q(".play")!.classList.contains("play-result-dock")).toBe(false);
    expect(q("aside.desk-insp [data-testid='new-puzzle']")).not.toBeNull();
  });

  it("партия идёт (не решена): дока нет", () => {
    solvedSnap(createPlay({ mission: MISSION, solution: SOLUTION }), { phase: "playing", remoteSolved: false });
    render();
    expect(q(".result-dock")).toBeNull();
  });
});
