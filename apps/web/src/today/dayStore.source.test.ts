// @vitest-environment jsdom
/**
 * PD-305: источник сетки дня — Sudoku.com (по умолчанию) или наш «Эксперт без X-Wing» (`dailyPuzzle(date, 'expert')` на
 * устройстве). Главное правило: начатый (ход/подсказка) или решённый день источник НЕ меняет — смена действует со следующего
 * дня; не начатый переключается сразу. Наша сетка не перезапрашивается и не сверяется с сервером.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { DailySource } from "../settings/prefs";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { DayPuzzle, FetchedDay } from "./dayResolver";
import { OWN_DAILY_DIFFICULTY, ownDay } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const DATE = "2026-11-08";
const NEXT = "2026-11-09";
const SUDOKU = dailyPuzzle(DATE, "easy"); // «сетка Sudoku.com» в тестах — любая решаемая, отличная от нашей
const OWN = dailyPuzzle(DATE, OWN_DAILY_DIFFICULTY);
const OWN_NEXT = dailyPuzzle(NEXT, OWN_DAILY_DIFFICULTY);

const server = (date: string, over: Partial<DayPuzzle> = {}): FetchedDay => ({
  ok: true,
  puzzle: { date, mission: dailyPuzzle(date, "easy").mission, difficulty: "hard", source: "sudoku.com", winRate: 55, ...over },
});

function make(source: DailySource, over: Partial<DayDeps> = {}) {
  const repo = new InMemoryProgressRepository();
  let current = source;
  const listeners = new Set<() => void>();
  let now = new Date(2026, 10, 8, 12, 0);
  const deps: DayDeps = {
    repo,
    fetchDay: vi.fn(async (date: string) => server(date)),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => now,
    isOnline: () => true,
    slowFetchMs: 50,
    dailySource: () => current,
    subscribeSource: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    ...over,
  };
  const store = new DayStore(deps);
  const setSource = (s: DailySource) => {
    current = s;
    listeners.forEach((l) => l());
  };
  const setNow = (d: Date) => {
    now = d;
  };
  return { store, deps, repo, setSource, setNow, listeners };
}

const settle = async (store: DayStore) => {
  await vi.waitFor(() => expect(store.getSnapshot().phase).not.toBe("loading"));
};
const mission = (store: DayStore) => store.getSnapshot().play!.mission.join("");
/** Один верный ход — день начат. */
function move(store: DayStore): void {
  const { play } = store.getSnapshot();
  const cell = play!.mission.findIndex((g) => g === 0);
  store.select(cell);
  store.input(play!.solution[cell]!);
}
function solveAll(store: DayStore): void {
  const { play } = store.getSnapshot();
  for (let i = 0; i < 81; i++) {
    if (play!.mission[i]) continue;
    store.select(i);
    store.input(play!.solution[i]!);
  }
}

describe("PD-305: наш источник сетки дня", () => {
  it("ownDay — ровно dailyPuzzle(date, 'expert'), детерминирован по дате, одинаков у всех", () => {
    expect(OWN_DAILY_DIFFICULTY).toBe("expert");
    const a = ownDay(DATE);
    const b = ownDay(DATE);
    expect(a.puzzle).toEqual({ date: DATE, mission: OWN.mission, difficulty: "expert", source: "pundoku", winRate: null });
    expect(b).toEqual(a);
    expect(ownDay(NEXT).puzzle.mission).toBe(OWN_NEXT.mission);
    expect(OWN_NEXT.mission).not.toBe(OWN.mission);
  });

  it("выбран наш: сеть не трогаем вовсе, сетка — dailyPuzzle(date, 'expert') в Worker, проверка локальная, не офлайн", async () => {
    const { store, deps } = make("pundoku");
    void store.load();
    await settle(store);
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(deps.generateFallback).toHaveBeenCalledWith(DATE, "expert");
    expect(mission(store)).toBe(OWN.mission);
    expect(store.getSnapshot()).toMatchObject({ source: "pundoku", difficulty: "expert", difficultyKnown: true, winRate: null, verification: "local", offline: false });
  });

  it("выбран наш и офлайн — та же сетка (от сети не зависит)", async () => {
    const { store, deps } = make("pundoku", { isOnline: () => false });
    void store.load();
    await settle(store);
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(mission(store)).toBe(OWN.mission);
    expect(store.getSnapshot().offline).toBe(false);
  });

  it("по умолчанию (dailySource не задан) — Sudoku.com, как до PD-305", async () => {
    const { store, deps } = make("sudoku.com", { dailySource: undefined });
    void store.load();
    await settle(store);
    expect(deps.fetchDay).toHaveBeenCalledWith(DATE);
    expect(mission(store)).toBe(SUDOKU.mission);
    expect(store.getSnapshot().source).toBe("sudoku.com");
  });

  it("наша сетка не перезапрашивается при возврате в сеть и не заменяется ответом сервера", async () => {
    const { store, deps } = make("pundoku");
    void store.load();
    await settle(store);
    store.refresh();
    window.dispatchEvent(new Event("online"));
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(mission(store)).toBe(OWN.mission);
  });

  it("запись дня хранит источник pundoku и переживает перезапуск без сети", async () => {
    const { store, repo, deps } = make("pundoku");
    void store.load();
    await settle(store);
    move(store);
    await vi.waitFor(async () => expect((await repo.getDay(DATE))?.play.log.length).toBe(1));
    expect((await repo.getDay(DATE))!.source).toBe("pundoku");
    const again = new DayStore({ ...deps, fetchDay: vi.fn(async () => server(DATE)) });
    void again.load();
    await settle(again);
    expect(mission(again)).toBe(OWN.mission);
    expect(again.getSnapshot().source).toBe("pundoku");
  });
});

describe("PD-305: смена источника не меняет начатый день", () => {
  it("начатый день Sudoku.com, выбрали наш — сетка та же (сверка с сервером: keep), со следующего дня — наша", async () => {
    const { store, deps, setSource, setNow } = make("sudoku.com");
    store.ensureStarted();
    await settle(store);
    move(store);
    setSource("pundoku");
    await new Promise((r) => setTimeout(r, 20));
    expect(mission(store)).toBe(SUDOKU.mission);
    // перезапуск в тот же день — всё ещё Sudoku.com (запись начата)
    void store.load();
    await settle(store);
    expect(mission(store)).toBe(SUDOKU.mission);
    expect(store.getSnapshot().source).toBe("sudoku.com");
    expect(store.getSnapshot().play!.log.length).toBe(1);
    // следующий день — наш
    setNow(new Date(2026, 10, 9, 9, 0));
    (deps.fetchDay as ReturnType<typeof vi.fn>).mockClear();
    void store.load();
    await settle(store);
    expect(store.getSnapshot().date).toBe(NEXT);
    expect(mission(store)).toBe(OWN_NEXT.mission);
    expect(deps.fetchDay).not.toHaveBeenCalled();
    store.dispose();
  });

  it("начатый наш день, выбрали Sudoku.com — доигрываем свою сетку без сети; сервер её не заменяет", async () => {
    const { store, deps, setSource } = make("pundoku");
    store.ensureStarted();
    await settle(store);
    move(store);
    setSource("sudoku.com");
    await new Promise((r) => setTimeout(r, 20));
    expect(mission(store)).toBe(OWN.mission);
    void store.load();
    await settle(store);
    expect(mission(store)).toBe(OWN.mission);
    expect(store.getSnapshot()).toMatchObject({ source: "pundoku", verification: "local" });
    store.refresh();
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(mission(store)).toBe(OWN.mission);
    store.dispose();
  });

  it("подсказка без ходов — тоже «начат»: источник не меняется", async () => {
    const { store, repo, deps } = make("sudoku.com");
    void store.load();
    await settle(store);
    const saved = (await repo.getDay(DATE))!;
    await repo.saveDay({ ...saved, hints: 1, assisted: true });
    const again = new DayStore({ ...deps, dailySource: () => "pundoku" });
    void again.load();
    await settle(again);
    expect(mission(again)).toBe(SUDOKU.mission);
  });

  it("решённый день не меняется ни сменой источника, ни перезапуском", async () => {
    const { store, setSource } = make("sudoku.com");
    store.ensureStarted();
    await settle(store);
    solveAll(store);
    expect(store.getSnapshot().phase).toBe("solved");
    setSource("pundoku");
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getSnapshot().phase).toBe("solved");
    void store.load();
    await settle(store);
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", source: "sudoku.com" });
    expect(mission(store)).toBe(SUDOKU.mission);
    store.dispose();
  });

  it("не начатый день переключается сразу — в обе стороны (Чернила, выбранные до хода, сохраняются)", async () => {
    const { store, setSource } = make("sudoku.com");
    store.ensureStarted();
    await settle(store);
    expect(mission(store)).toBe(SUDOKU.mission);
    store.setInk(true);
    setSource("pundoku");
    await vi.waitFor(() => expect(store.getSnapshot().source).toBe("pundoku"));
    await settle(store);
    expect(mission(store)).toBe(OWN.mission);
    expect(store.getSnapshot().play!.ink).toBe(true);
    setSource("sudoku.com");
    await vi.waitFor(() => expect(store.getSnapshot().source).toBe("sudoku.com"));
    expect(mission(store)).toBe(SUDOKU.mission);
    store.dispose();
  });

  it("не начатая наша сетка при Sudoku.com и без сети — не «надёжнее фолбэка»: играем фолбэк Sudoku.com-источника", async () => {
    const { store, deps } = make("pundoku");
    void store.load();
    await settle(store);
    const offline = new DayStore({ ...deps, dailySource: () => "sudoku.com", fetchDay: vi.fn(async (): Promise<FetchedDay> => ({ ok: false, reason: "network" })) });
    void offline.load();
    await settle(offline);
    expect(offline.getSnapshot().source).toBe("client");
  });

  it("смена другой настройки (не источника) день не перезагружает", async () => {
    const { store, deps, listeners } = make("sudoku.com");
    store.ensureStarted();
    await settle(store);
    const calls = (deps.fetchDay as ReturnType<typeof vi.fn>).mock.calls.length;
    listeners.forEach((l) => l());
    await new Promise((r) => setTimeout(r, 20));
    expect((deps.fetchDay as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
    store.dispose();
  });

  it("dayStatus: нет записи — null; не начат — started false; начат — started и наш ли", async () => {
    const { store } = make("pundoku");
    expect(await store.dayStatus()).toBeNull();
    void store.load();
    await settle(store);
    expect(await store.dayStatus()).toEqual({ started: false, own: true });
    move(store);
    expect(await store.dayStatus()).toEqual({ started: true, own: true });
  });
});
