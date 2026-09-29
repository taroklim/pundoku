// @vitest-environment jsdom
/** Экран архивного дня (PD-33): шапка «‹ Year», подпись с датой, состояния загрузки/«даты нет», late-заметка, без Grid ∞. */
import { dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { progressOf } from "../sync/fixtures";
import type { FetchedDay } from "./dayResolver";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import { InMemoryProgressRepository } from "./repository";
import { DayView } from "./TodayScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 8, 29, 12, 0);
const PAST = "2026-09-20";

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function make(fetched: (d: string) => FetchedDay, repo = new InMemoryProgressRepository()) {
  const deps: DayDeps = {
    repo,
    fetchDay: vi.fn(async (d: string) => fetched(d)),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
  };
  return { store: new DayStore(deps, { archive: true }), deps, repo };
}
const ok = (d: string): FetchedDay => ({ ok: true, puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy", source: "sudoku.com", winRate: 61.4 } });

const render = async (store: DayStore, date = PAST, onBack = vi.fn()) => {
  await act(async () => root.render(<DayView store={store} archive={{ date, onBack }} />));
  return onBack;
};
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 80))));

describe("экран архивного дня", () => {
  it("шапка: «Archive» и кнопка «‹ Year» (aria «Back to Year») ведёт назад; подпись — дата этого дня и сложность", async () => {
    const { store } = make(ok);
    const onBack = await render(store);
    await settle();
    expect(q("h1.title")!.textContent).toBe("Archive");
    const back = q('[data-testid="archive-back"]')!;
    expect(back.textContent).toBe("Year");
    expect(back.getAttribute("aria-label")).toBe("Back to Year");
    expect(q(".subline")!.textContent).toContain("20");
    expect(q(".subline")!.textContent).toContain("Easy");
    expect(q('[data-testid="archive-screen"]')!.dataset["date"]).toBe(PAST);
    act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(q('[data-testid="grid-inf-section"]')).toBeNull();
  });

  it("Today не затронут: в шапке сегодняшнего стора нет кнопки «‹ Year»", async () => {
    const { store } = make(ok);
    const today = new DayStore((store as unknown as { deps: DayDeps }).deps);
    await act(async () => root.render(<DayView store={today} />));
    expect(q('[data-testid="archive-back"]')).toBeNull();
    expect(q("h1.title")!.textContent).toBe("Today");
    today.dispose();
  });

  it("дата, которой нет: сообщение без кнопки повтора", async () => {
    const { store } = make(() => ({ ok: false, reason: "http", status: 404 }));
    await render(store);
    await settle();
    expect(q('[data-testid="archive-unavailable"]')!.textContent).toBe("This day’s puzzle isn’t available.");
    expect(host.querySelector("button.link")).toBeNull();
    expect(q(".subline")!.textContent).not.toMatch(/Medium|Easy/);
  });

  it("решённый позже день: карточка результата с пометкой «остаётся пропуском», без Grid ∞", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.saveDay(progressOf(PAST, { late: true }));
    const { store } = make(ok, repo);
    await render(store);
    await settle();
    expect(q('[data-testid="late-note"]')!.textContent).toContain("missed");
    expect(q('[data-testid="grid-inf-section"]')).toBeNull();
  });

  it("решённый вовремя-в-архиве без late (запись пришла с сервера): пометки нет", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.saveDay(progressOf(PAST));
    const { store } = make(ok, repo);
    await render(store);
    await settle();
    expect(q('[data-testid="late-note"]')).toBeNull();
    expect(q(".card")).not.toBeNull();
  });

  it("уход с экрана закрывает архив: стор в «загрузке», слушатели сняты", async () => {
    const { store } = make(ok);
    await render(store);
    await settle();
    expect(store.getSnapshot().phase).toBe("playing");
    await act(async () => root.render(null));
    expect(store.getSnapshot().phase).toBe("loading");
  });
});

describe("несуществующая календарная дата в адресе", () => {
  it("подпись не «перекатывается» в другой месяц и не показывает сложность", async () => {
    const { store } = make(ok);
    await render(store, "2026-02-30");
    await settle();
    expect(q('[data-testid="archive-unavailable"]')).not.toBeNull();
    expect(q(".subline")!.textContent).toBe("");
  });
});
