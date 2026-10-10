// @vitest-environment jsdom
/**
 * PD-267: десктоп C — партия: тулбар над полем + инспектор справа (Today, архив, Play). Держат:
 *  (1) только в раскладке с сайдбаром (DESK_QUERY): корень `.desk-play`, шапка `.desk-tb` с кнопкой сайдбара, заголовком и
 *      подписью одним блоком, поле в `.desk-stage`, инспектор: время/остаток, панель 1–9, действия с чипами и
 *      `aria-keyshortcuts`, шпаргалка; строки «осталось N» в зазоре нет (она — строка «Left»), отклики — в инспекторе;
 *  (2) телефон — прежняя разметка: подпись под шапкой, `.gap`, панель без чипов, ни инспектора, ни кнопки;
 *  (3) клавиши/клики инспектора ведут ту же партию; док подсказки встаёт на место панели в инспекторе;
 *  (4) архив — «‹ Year» в тулбаре. Карточка «решено» в инспекторе — PD-268, play/deskResult.test.tsx.
 * Раскладку jsdom не считает — она в design/pd267-check.mjs (Playwright, 1280/1440/1920 × 100/125/150 %).
 */
import { dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { DESK_QUERY } from "../shell/desk";
import type { DayDeps } from "../today/dayStore";
import { DayStore } from "../today/dayStore";
import { InMemoryProgressRepository } from "../today/repository";
import { DayView } from "../today/TodayScreen";
import { deskKeys } from "./deskKeys";
import { createPlay } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 8, 29, 12, 0);
const SOLUTION = "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION = "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

let deskOn = false;
let host: HTMLDivElement;
let root: Root;

interface Inner {
  snap: Record<string, unknown>;
  set(patch: Record<string, unknown>): void;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};

beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

beforeEach(async () => {
  await i18n.changeLanguage("en");
  deskOn = false;
  window.matchMedia = ((q: string) => ({
    get matches() {
      return (q === DESK_QUERY && deskOn) || q.includes("reduce");
    },
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
  localStorage.clear();
  inner.snap = { ...base };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const dayStore = (archive = false) => {
  const deps: DayDeps = {
    repo: new InMemoryProgressRepository(),
    fetchDay: vi.fn(async (d: string) => ({
      ok: true as const,
      puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 58.2 },
    })),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
  };
  return new DayStore(deps, { archive });
};
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const qa = (sel: string) => [...host.querySelectorAll<HTMLElement>(sel)];
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

async function today(desk: boolean) {
  deskOn = desk;
  const s = dayStore();
  await act(async () => root.render(<DayView store={s} onOpenSettings={() => undefined} />));
  await act(async () => s.ensureStarted());
  await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
  return s;
}

describe("Today, десктоп C: тулбар + поле + инспектор", () => {
  it("разметка партии: .desk-play, шапка .desk-tb (кнопка сайдбара первой, заголовок + подпись одним блоком), поле в .desk-stage", async () => {
    await today(true);
    const screen = q(".play.today")!;
    expect(screen.className).toContain("play-fit");
    expect(screen.className).toContain("desk-play");
    const tb = q("header.toolbar")!;
    expect(tb.className).toBe("toolbar desk-tb");
    expect(tb.firstElementChild!.getAttribute("data-testid")).toBe("sidebar-toggle");
    const tt = tb.querySelector(".desk-tt")!;
    expect(tt.querySelector("h1.title")!.textContent).toBe("Today");
    // Подпись дня — в тулбаре, без часов (время — в инспекторе); отдельной строки под шапкой нет.
    expect(tt.querySelector(".subline")).not.toBeNull();
    expect(tt.querySelector(".subline .clock")).toBeNull();
    expect(qa(".subline")).toHaveLength(1);
    expect(q('[data-testid="hint-button"]')!.closest("header")).toBe(tb);
    expect(q('[data-testid="open-settings"]')!.closest("header")).toBe(tb);
    expect(q(".desk-stage > .board-wrap .board")).not.toBeNull();
    expect(q(":scope .play > .gap")).toBeNull();
  });

  it("инспектор: время и остаток, панель 1–9, действия с чипами клавиш и aria-keyshortcuts, шпаргалка; aside с именем", async () => {
    await today(true);
    const insp = q("aside.desk-insp")!;
    expect(insp.getAttribute("aria-label")).toBe("Puzzle tools");
    const dd = [...insp.querySelectorAll(".insp-meta dd")].map((d) => d.textContent);
    expect(dd[0]).toMatch(/^\d+:\d\d$/);
    expect(dd[1]).toMatch(/^\d+ cells$/);
    expect(insp.querySelectorAll(".pad .key")).toHaveLength(9);
    const k = deskKeys();
    const acts = [...insp.querySelectorAll(".actions .act")].map((a) => [a.querySelector("kbd")?.textContent, a.getAttribute("aria-keyshortcuts")]);
    expect(acts).toEqual([
      ["N", "N"],
      [k.undo, "Meta+Z Control+Z"],
      ["⌫", "Backspace Delete"],
    ]);
    // Чип — не часть имени кнопки (имя — aria-label), для скринридера он скрыт.
    expect(insp.querySelector(".act kbd")!.getAttribute("aria-hidden")).toBe("true");
    const legend = insp.querySelector('[data-testid="insp-keys"]')!;
    expect(legend.querySelector("h3")!.textContent).toBe("Keyboard");
    expect([...legend.querySelectorAll("li")].map((li) => li.getAttribute("data-testid"))).toEqual(["key-move", "key-place", "key-note", "key-fill", "key-hint", "key-esc"]);
    // «Осталось N» — строка Left, в статусе её нет (одна фраза на экране); источник сетки — в инспекторе.
    expect(insp.querySelector('[data-testid="status-line"]')).toBeNull();
  });

  it("клик по клавише инспектора ставит цифру; Left уменьшается", async () => {
    const s = await today(true);
    const play = s.getSnapshot().play!;
    const cell = play.mission.findIndex((v) => v === 0);
    act(() => s.select(cell));
    const before = q('[data-testid="insp-left"]')!.textContent;
    const digit = play.solution[cell]!;
    tap(qa(".desk-insp .pad .key")[digit - 1]!);
    expect(s.getSnapshot().play!.values[cell]).toBe(digit);
    expect(q('[data-testid="insp-left"]')!.textContent).not.toBe(before);
  });

  it("лампочка (после шита правила) — док подсказки в инспекторе на месте панели", async () => {
    const s = await today(true);
    tap(q('[data-testid="hint-button"]')!);
    // Первый раз — шит правила «A hint marks the day» (портал); «Show the hint» открывает док.
    const go = document.querySelector<HTMLElement>('[data-testid="hint-rule-go"]') ?? [...document.querySelectorAll<HTMLElement>(".ink-sheet button")][0];
    if (go) tap(go);
    await act(async () => vi.waitFor(() => expect(q(".desk-insp .hint-dock")).not.toBeNull(), { timeout: 5000, interval: 25 }));
    expect(q(".desk-insp .pad")).toBeNull();
    expect(q(".hint-dock")!.parentElement!.className).toBe("desk-insp");
    expect(s.getSnapshot().phase).toBe("playing");
  });

  it("телефон — прежняя разметка: подпись под шапкой с часами, зазор со статусом, панель без чипов, ни инспектора, ни кнопки", async () => {
    await today(false);
    const screen = q(".play.today")!;
    expect(screen.className).not.toContain("desk-play");
    expect(q("header.toolbar")!.className).toBe("toolbar");
    expect(q(".desk-tt, .desk-insp, .desk-stage, [data-testid='sidebar-toggle'], kbd")).toBeNull();
    expect(screen.querySelector(":scope > .subline .clock")).not.toBeNull();
    expect(screen.querySelector(":scope > .gap")).not.toBeNull();
    expect(screen.querySelector(":scope > .pad-wrap")).not.toBeNull();
    expect(qa("[aria-keyshortcuts]")).toHaveLength(0);
  });
});

describe("архивный день, десктоп C", () => {
  it("«‹ Year» — в тулбаре партии перед заголовком «Archive», без шестерёнки", async () => {
    deskOn = true;
    const s = dayStore(true);
    const onBack = vi.fn();
    await act(async () => root.render(<DayView store={s} archive={{ date: "2026-09-27", onBack }} />));
    const tb = q("header.toolbar")!;
    expect(tb.className).toBe("toolbar desk-tb");
    const kids = [...tb.children].map((el) => el.getAttribute("data-testid") ?? el.className);
    expect(kids.slice(0, 3)).toEqual(["sidebar-toggle", "archive-back", "desk-tt"]);
    expect(tb.querySelector(".desk-tt h1")!.textContent).toBe("Archive");
    expect(q('[data-testid="open-settings"]')).toBeNull();
    tap(q('[data-testid="archive-back"]')!);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("телефон — прежняя шапка архива (столбиком, без тулбара партии)", async () => {
    const s = dayStore(true);
    await act(async () => root.render(<DayView store={s} archive={{ date: "2026-09-27", onBack: () => undefined }} />));
    expect(q("header.toolbar")!.className).toBe("toolbar toolbar-archive");
    expect(q(".desk-tt")).toBeNull();
  });
});

describe("Play, десктоп C", () => {
  const party = () => act(() => inner.set({ hub: false, mode: "classic", phase: "playing", play: createPlay({ mission: MISSION, solution: SOLUTION }) }));

  it("партия: тулбар (кнопка · заголовок + подпись · лампочка · ⚙ · ⋯) + поле + инспектор", () => {
    deskOn = true;
    party();
    act(() => root.render(<PlayScreen onOpenSettings={() => undefined} />));
    const tb = q("header.toolbar")!;
    expect(tb.className).toBe("toolbar desk-tb");
    expect(tb.firstElementChild!.getAttribute("data-testid")).toBe("sidebar-toggle");
    expect(tb.querySelector(".desk-tt h1")!.textContent).toBe("Play");
    expect(tb.querySelector(".desk-tt .subline")).not.toBeNull();
    expect([...tb.querySelectorAll(".toolbar-end > *")].map((el) => el.getAttribute("data-testid"))).toEqual(["hint-button", "open-settings", "more-button"]);
    expect(q(".play")!.className).toContain("desk-play");
    expect(q(".desk-stage .board")).not.toBeNull();
    expect(qa(".desk-insp .pad .key")).toHaveLength(9);
    expect(q(".desk-insp [data-testid='insp-left']")!.textContent).toBe("51 cells");
  });

  it("хаб Play — без тулбара партии и инспектора (заголовок «Play», кнопка сайдбара в шапке)", () => {
    deskOn = true;
    act(() => inner.set({ hub: true }));
    act(() => root.render(<PlayScreen onOpenSettings={() => undefined} />));
    expect(q("header.toolbar")!.className).toBe("toolbar");
    expect(q("header.toolbar")!.firstElementChild!.getAttribute("data-testid")).toBe("sidebar-toggle");
    expect(q(".desk-insp, .desk-tt")).toBeNull();
  });

  it("телефон — прежняя партия: подпись под шапкой, зазор, панель без чипов", () => {
    party();
    act(() => root.render(<PlayScreen onOpenSettings={() => undefined} />));
    expect(q(".play")!.className).not.toContain("desk-play");
    expect(q(".desk-insp, .desk-tt, kbd, [data-testid='sidebar-toggle']")).toBeNull();
    expect(q(".play > .subline")).not.toBeNull();
    expect(q(".play > .gap")).not.toBeNull();
  });
});
