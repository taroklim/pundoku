// @vitest-environment jsdom
/**
 * PD-137 (находка QA по PD-125): день сменился в живой сессии (приложение открыто за полночь) и вчерашний день дорешан
 * на Today — карточка результата согласована с Year: «solved late» (знак и слова), без ложного «solved today».
 * «Сегодня» стор берёт из часов в момент решения (`late = дата партии < локальная дата`), а не из даты партии.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import { InMemoryProgressRepository } from "./repository";
import { DayView } from "./TodayScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const D1 = "2026-09-29";
const EVENING = new Date(2026, 8, 29, 23, 50);
const AFTER_MIDNIGHT = new Date(2026, 8, 30, 0, 10);

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function make() {
  let now = EVENING;
  const deps: DayDeps = {
    repo: new InMemoryProgressRepository(),
    fetchDay: vi.fn(async (d: string) => ({
      ok: true as const,
      puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 58.2 },
    })),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => now,
    isOnline: () => true,
    slowFetchMs: 50,
  };
  return { store: new DayStore(deps), setNow: (d: Date) => (now = d) };
}

/** Заполнить пустые клетки правильными цифрами, оставив `keep` клеток нерешёнными (с конца). */
function fill(store: DayStore, keep = 0): void {
  const { play } = store.getSnapshot();
  const empty = [...play!.mission.keys()].filter((i) => !play!.mission[i]);
  for (const i of empty.slice(0, empty.length - keep)) {
    store.select(i);
    store.input(play!.solution[i]!);
  }
}
const finish = (store: DayStore) => {
  const { play } = store.getSnapshot();
  const i = [...play!.mission.keys()].find((k) => !play!.mission[k] && !store.getSnapshot().play!.values[k])!;
  store.select(i);
  store.input(play!.solution[i]!);
};

const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 50))));
/** Карточка результата появляется после финала (reduced motion — таймерами); ждём её, а не фиксированную паузу. */
const cardShown = () => act(async () => vi.waitFor(() => expect(q('[data-testid="winrate"]')).not.toBeNull(), { timeout: 40000, interval: 25 }));

async function openToday(store: DayStore) {
  await act(async () => root.render(<DayView store={store} />));
  await act(async () => store.ensureStarted());
  await act(async () => vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"), { timeout: 40000, interval: 25 }));
}

describe("PD-137: карточка результата Today при смене суток в живой сессии", { timeout: 60000 }, () => {
  it("вчерашний день начат до полуночи, дорешан после (без перезагрузки): «solved late» со знаком, «solved that day», не «today»", async () => {
    const { store, setNow } = make();
    await openToday(store);
    expect(store.getSnapshot().date).toBe(D1);
    act(() => fill(store, 1)); // ходы есть — refresh после полуночи день не подменяет
    setNow(AFTER_MIDNIGHT);
    act(() => store.refresh());
    await settle();
    expect(store.getSnapshot().date).toBe(D1);
    act(() => finish(store));
    await cardShown();

    expect(store.getSnapshot()).toMatchObject({ phase: "solved", late: true });
    const note = q('[data-testid="late-note"]')!;
    expect(note.textContent).toBe("Solved after its day — your year keeps it as “solved late”.");
    expect(note.querySelector(".ymark.is-late")).not.toBeNull();
    const wr = q('[data-testid="winrate"]')!.textContent!;
    expect(wr).toBe("58 % solved that day");
    expect(wr).not.toContain("today");
  });

  it("обычный случай не затронут: решён в тот же день — без пометки, «solved today»", async () => {
    const { store } = make();
    await openToday(store);
    act(() => fill(store));
    await cardShown();
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", late: false });
    expect(q('[data-testid="late-note"]')).toBeNull();
    expect(q('[data-testid="winrate"]')!.textContent).toBe("58 % solved today");
  });

  it("решён до полуночи, карточка открыта после: это не late, пометки нет", async () => {
    const { store, setNow } = make();
    await openToday(store);
    act(() => fill(store));
    setNow(AFTER_MIDNIGHT);
    await settle();
    expect(store.getSnapshot().late).toBe(false);
    expect(q('[data-testid="late-note"]')).toBeNull();
  });
});
