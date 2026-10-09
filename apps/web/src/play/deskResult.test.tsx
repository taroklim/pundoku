// @vitest-environment jsdom
/**
 * PD-268: десктоп C — после решения карточка результата и Grid ∞ в инспекторе. Держат:
 *  (1) Today: экран остаётся партией (`.desk-play.play-fit`): поле в `.desk-stage` (inert — вне фокуса и касаний), тулбар тот
 *      же; инспектор `.desk-insp.solved` — карточка (`result-card`) и Grid ∞ (`section.desk-grid`, пояснение — для скринридера,
 *      ссылка «What's this?» видна), ни времени, ни панели; Share и Watch — те же кнопки карточки;
 *  (2) архивный день — карточка в инспекторе, Grid ∞ нет;
 *  (3) Play — карточка с «New puzzle» в инспекторе; «New puzzle» открывает шит режима, как на телефоне;
 *  (4) телефон — прежняя разметка: карточка и Grid ∞ вместо поля, текст пояснения Grid ∞ прямо в абзаце (DOM = main).
 * Раскладку (1280×800 без прокрутки, компакт, Share PNG) jsdom не считает — она в design/pd268-check.mjs.
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
import { createPlay, enterDigit } from "./logic";
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

const q = (sel: string) => host.querySelector<HTMLElement>(sel);

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

/** Решить загруженный день ходами игрока (как клавишами) и дождаться карточки (+ Grid ∞ у Today). */
async function solve(s: DayStore, grid: boolean) {
  const play = s.getSnapshot().play!;
  act(() => {
    for (let i = 0; i < 81; i++) {
      if (play.mission[i] !== 0) continue;
      s.select(i);
      s.input(play.solution[i]!);
    }
  });
  expect(s.getSnapshot().phase).toBe("solved");
  await act(async () =>
    vi.waitFor(() => {
      expect(q('[data-testid="result-card"]')).not.toBeNull();
      if (grid) expect(q('[data-testid="grid-inf"]')).not.toBeNull();
    }, { timeout: 5000, interval: 20 }),
  );
}

async function today(desk: boolean) {
  deskOn = desk;
  const s = dayStore();
  await act(async () => root.render(<DayView store={s} onOpenSettings={() => undefined} onOpenHelp={() => undefined} />));
  await act(async () => s.ensureStarted());
  await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
  return s;
}

describe("Today, десктоп C: после решения", () => {
  it("поле на месте (inert), тулбар тот же; в инспекторе карточка + Grid ∞, без времени и панели", async () => {
    const s = await today(true);
    await solve(s, true);
    const screen = q(".play.today")!;
    expect(screen.className).toContain("desk-play");
    expect(screen.className).toContain("play-fit");
    expect(q("header.toolbar")!.className).toBe("toolbar desk-tb");
    const stage = q(".desk-stage")!;
    expect(stage.hasAttribute("inert")).toBe(true);
    expect(stage.querySelectorAll(".board button.cell")).toHaveLength(81);
    const insp = q("aside.desk-insp")!;
    expect(insp.className).toBe("desk-insp solved");
    expect([...insp.children].map((c) => c.getAttribute("data-testid"))).toEqual(["result-card", "grid-inf-section"]);
    expect(insp.querySelector(".insp-meta, .pad, .insp-keys")).toBeNull();
    // Карточка — та же (Watch, Share, техника с «What's this?», источник), в инспекторе.
    for (const id of ["heat", "share", "technique-help", "winrate"]) expect(insp.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    expect(insp.querySelector(".card .source")!.textContent).toBe("Puzzle from Sudoku.com");
    // Grid ∞: компактный вариант — класс desk-grid, пояснение только для скринридера, ссылка на справку видна.
    const grid = q("section.desk-grid")!;
    expect(grid.querySelectorAll('[data-testid="grid-inf"] .cell')).toHaveLength(81);
    expect(grid.querySelector('[data-testid="grid-inf-target"]')).not.toBeNull();
    const explain = grid.querySelector('[data-testid="grid-explain"]')!;
    expect(explain.querySelector(".sr-only")!.textContent).toContain("grid");
    expect(explain.querySelector('[data-testid="grid-help"]')).not.toBeNull();
    // Ни телефонной карточки под полем, ни зазора.
    expect(screen.querySelector(":scope > .card, :scope > section, :scope > .gap")).toBeNull();
  });

  it("после решения в тулбаре нет лампочки, клавиши партии не работают (поле не в игре)", async () => {
    const s = await today(true);
    await solve(s, true);
    expect(q('[data-testid="hint-button"]')).toBeNull();
    const before = s.getSnapshot().play!.values.join("");
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", code: "Digit1", bubbles: true })));
    expect(s.getSnapshot().play!.values.join("")).toBe(before);
  });
});

describe("архивный день, десктоп C: после решения", () => {
  it("карточка в инспекторе, Grid ∞ нет; «‹ Year» в тулбаре", async () => {
    deskOn = true;
    const s = dayStore(true);
    await act(async () => root.render(<DayView store={s} archive={{ date: "2026-09-27", onBack: () => undefined }} />));
    await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
    await solve(s, false);
    const insp = q("aside.desk-insp.solved")!;
    expect([...insp.children].map((c) => c.getAttribute("data-testid"))).toEqual(["result-card"]);
    expect(q('[data-testid="grid-inf"]')).toBeNull();
    expect(q(".desk-tb [data-testid='archive-back']")).not.toBeNull();
    expect(q(".desk-stage")!.hasAttribute("inert")).toBe(true);
  });
});

describe("телефон: решённый день — прежняя разметка", () => {
  it("карточка и Grid ∞ вместо поля, без инспектора; пояснение Grid ∞ — текстом абзаца, без desk-grid", async () => {
    const s = await today(false);
    await solve(s, true);
    const screen = q(".play.today")!;
    expect(screen.className).not.toContain("desk-play");
    expect(screen.className).not.toContain("play-fit");
    expect(q(".desk-insp, .desk-stage, .desk-grid")).toBeNull();
    expect(screen.querySelector(":scope > .card")).not.toBeNull();
    const section = q("[data-testid='grid-inf-section']")!;
    expect(section.getAttribute("class")).toBeNull();
    expect(q(".board button.cell")).toBeNull();
    const explain = q('[data-testid="grid-explain"]')!;
    expect(explain.querySelector(".sr-only")).toBeNull();
    expect(explain.firstChild!.nodeType).toBe(Node.TEXT_NODE);
  });
});

describe("Play, десктоп C: после решения", () => {
  const solved = () => {
    let p = createPlay({ mission: MISSION, solution: SOLUTION });
    for (let i = 0; i < 81; i++) if (!p.mission[i]) p = enterDigit(p, i, p.solution[i] as number, 1000 + i * 500);
    return p;
  };

  it("поле на месте (inert), в инспекторе карточка с «New puzzle»; «New puzzle» — шит режима", async () => {
    deskOn = true;
    act(() => inner.set({ hub: false, mode: "classic", phase: "solved", remoteSolved: true, play: solved() }));
    act(() => root.render(<PlayScreen onOpenSettings={() => undefined} />));
    const screen = q(".play")!;
    expect(screen.className).toContain("desk-play");
    expect(screen.className).toContain("play-fit");
    expect(q(".desk-stage")!.hasAttribute("inert")).toBe(true);
    const insp = q("aside.desk-insp.solved")!;
    expect([...insp.children].map((c) => c.getAttribute("data-testid"))).toEqual(["result-card"]);
    const btn = insp.querySelector<HTMLElement>('[data-testid="new-puzzle"]')!;
    expect(insp.querySelector(".insp-meta, .pad")).toBeNull();
    // ⋯ на решённой партии не показывается (как на телефоне); заголовок и кнопка сайдбара — в тулбаре.
    expect(q('[data-testid="more-button"]')).toBeNull();
    expect(q("header.toolbar")!.firstElementChild!.getAttribute("data-testid")).toBe("sidebar-toggle");
    act(() => btn.click());
    expect(document.querySelector('[data-testid="mode-sheet"]')).not.toBeNull();
  });

  it("телефон — прежняя карточка вместо поля", () => {
    act(() => inner.set({ hub: false, mode: "classic", phase: "solved", remoteSolved: true, play: solved() }));
    act(() => root.render(<PlayScreen onOpenSettings={() => undefined} />));
    expect(q(".desk-insp, .desk-stage")).toBeNull();
    expect(q(".play > .card [data-testid='new-puzzle']")).not.toBeNull();
    expect(q(".board")).toBeNull();
  });
});
