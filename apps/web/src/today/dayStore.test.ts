// @vitest-environment jsdom
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { DayPuzzle, FetchedDay } from "./dayResolver";
import { DAILY_FALLBACK_DIFFICULTY } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const NOW = new Date(2026, 8, 29, 12, 0);
const DATE = "2026-09-29";

const EASY = dailyPuzzle(DATE, "easy");
const OTHER = dailyPuzzle("2026-09-30", "easy");
const FALLBACK = dailyPuzzle(DATE, DAILY_FALLBACK_DIFFICULTY);

const server = (over: Partial<DayPuzzle> = {}): FetchedDay => ({
  ok: true,
  puzzle: { date: DATE, mission: EASY.mission, difficulty: "easy", source: "sudoku.com", winRate: 61.4, ...over },
});
const down: FetchedDay = { ok: false, reason: "network" };

function make(over: Partial<DayDeps> = {}) {
  const repo = new InMemoryProgressRepository();
  const deps: DayDeps = {
    repo,
    fetchDay: vi.fn(async () => server()),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
    ...over,
  };
  const store = new DayStore(deps);
  return { store, deps, repo };
}

const started = async (store: DayStore) => {
  void store.load();
  await vi.waitFor(() => expect(store.getSnapshot().phase).not.toBe("loading"));
};

/** Заполнить все пустые клетки правильными цифрами; возвращает клетку последнего хода. */
function solveAll(store: DayStore, skip = -1): number {
  const { play } = store.getSnapshot();
  let last = -1;
  for (let i = 0; i < 81; i++) {
    if (play!.mission[i] || i === skip) continue;
    store.select(i);
    store.input(play!.solution[i]!);
    last = i;
  }
  return last;
}

describe("загрузка дня", () => {
  it("ответ API: играем серверную сетку, подпись/источник/win rate/проверка на сервере", async () => {
    const { store } = make();
    await started(store);
    const s = store.getSnapshot();
    expect(s.phase).toBe("playing");
    expect(s.play!.mission.join("")).toBe(EASY.mission);
    expect(s.play!.solution.join("")).toBe(EASY.solution);
    expect(s).toMatchObject({ date: DATE, source: "sudoku.com", winRate: 61.4, difficulty: "easy", verification: "server", offline: false });
  });

  it("API недоступен: фолбэк ровно dailyPuzzle(date, DAILY_FALLBACK_DIFFICULTY), проверка локальная", async () => {
    const { store, deps } = make({ fetchDay: vi.fn(async () => down) });
    await started(store);
    const s = store.getSnapshot();
    expect(deps.generateFallback).toHaveBeenCalledWith(DATE, DAILY_FALLBACK_DIFFICULTY);
    expect(s.play!.mission.join("")).toBe(FALLBACK.mission);
    expect(s).toMatchObject({ source: "client", verification: "local", offline: true, winRate: null });
  });

  it("ответ API негоден, но сложность известна (generator) — фолбэк этой сложности", async () => {
    const bad: FetchedDay = { ok: false, reason: "invalid", difficulty: "easy" };
    const { store, deps } = make({ fetchDay: vi.fn(async () => bad) });
    await started(store);
    expect(deps.generateFallback).toHaveBeenCalledWith(DATE, "easy");
    expect(store.getSnapshot().play!.mission.join("")).toBe(EASY.mission);
  });

  it("mission без единственного решения от сервера — фолбэк, а не поломанная игра", async () => {
    const broken = server({ mission: "1".repeat(81), source: "generator" });
    const { store, deps } = make({ fetchDay: vi.fn(async () => broken) });
    await started(store);
    expect(deps.generateFallback).toHaveBeenCalledWith(DATE, "easy");
    expect(store.getSnapshot().source).toBe("client");
  });

  it("негодная mission от sudoku.com: её метка сложности в фолбэк не идёт — DAILY_FALLBACK_DIFFICULTY", async () => {
    const broken = server({ mission: "1".repeat(81), source: "sudoku.com", difficulty: "hard" });
    const { store, deps } = make({ fetchDay: vi.fn(async () => broken) });
    await started(store);
    expect(deps.generateFallback).toHaveBeenCalledWith(DATE, DAILY_FALLBACK_DIFFICULTY);
    expect(store.getSnapshot().play!.mission.join("")).toBe(FALLBACK.mission);
  });

  it("офлайн по navigator.onLine: сеть не трогаем, играем фолбэком сразу", async () => {
    const { store, deps } = make({ isOnline: () => false });
    await started(store);
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(store.getSnapshot().source).toBe("client");
  });

  it("сбой генератора фолбэка — phase error", async () => {
    const { store } = make({ fetchDay: vi.fn(async () => down), generateFallback: vi.fn(async () => Promise.reject(new Error("boom"))) });
    await started(store);
    expect(store.getSnapshot().phase).toBe("error");
  });
});

describe("сверка при возврате в сеть", () => {
  it("нет ходов, сервер отдал другую сетку — молча берём актуальную", async () => {
    let answer: FetchedDay = down;
    const { store } = make({ fetchDay: vi.fn(async () => answer) });
    await started(store);
    expect(store.getSnapshot().source).toBe("client");
    answer = server({ mission: OTHER.mission });
    store.refresh();
    await vi.waitFor(() => expect(store.getSnapshot().source).toBe("sudoku.com"));
    const s = store.getSnapshot();
    expect(s.play!.mission.join("")).toBe(OTHER.mission);
    expect(s).toMatchObject({ verification: "server", offline: false, winRate: 61.4, phase: "playing" });
  });

  it("есть ходы, сервер отдал другую сетку — доигрываем свою; verify не зовётся, проверка локальная", async () => {
    let answer: FetchedDay = down;
    const { store, deps } = make({ fetchDay: vi.fn(async () => answer) });
    await started(store);
    store.select(store.getSnapshot().selected!);
    store.input(1); // любой ход — лог непустой
    answer = server({ mission: OTHER.mission });
    store.refresh();
    await vi.waitFor(() => expect(store.getSnapshot().offline).toBe(false));
    const s = store.getSnapshot();
    expect(s.play!.mission.join("")).toBe(FALLBACK.mission);
    expect(s).toMatchObject({ verification: "local", winRate: null });
    store.erase();
    solveAll(store);
    expect(store.getSnapshot().phase).toBe("solved");
    await Promise.resolve();
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("та же сетка (клиентский фолбэк совпал с серверным generator): остаёмся и проверяем на сервере", async () => {
    let answer: FetchedDay = down;
    const { store, deps } = make({ fetchDay: vi.fn(async () => answer) });
    await started(store);
    answer = server({ mission: FALLBACK.mission, source: "generator", difficulty: DAILY_FALLBACK_DIFFICULTY, winRate: null });
    store.refresh();
    await vi.waitFor(() => expect(store.getSnapshot().source).toBe("generator"));
    expect(store.getSnapshot().verification).toBe("server");
    solveAll(store);
    await vi.waitFor(() => expect(store.getSnapshot().serverVerified).toBe(true));
    expect(deps.verify).toHaveBeenCalledTimes(1);
    const grid = vi.mocked(deps.verify).mock.calls[0]![1];
    expect(grid).toBe(FALLBACK.solution);
  });

  it("сетка sudoku.com неизменна: при возврате в сеть день не перезапрашивается", async () => {
    const { store, deps } = make();
    await started(store);
    store.refresh();
    await Promise.resolve();
    expect(deps.fetchDay).toHaveBeenCalledTimes(1);
  });

  it("медленный сервер: начинаем с фолбэка, поздний ответ сверяется", async () => {
    let release!: (f: FetchedDay) => void;
    const late = new Promise<FetchedDay>((r) => (release = r));
    const { store } = make({ fetchDay: vi.fn(() => late), slowFetchMs: 10 });
    await started(store);
    expect(store.getSnapshot().source).toBe("client");
    release(server({ mission: OTHER.mission }));
    await vi.waitFor(() => expect(store.getSnapshot().source).toBe("sudoku.com"));
    expect(store.getSnapshot().play!.mission.join("")).toBe(OTHER.mission);
  });

  it("смена суток: без ходов новый день загружается", async () => {
    let now = NOW;
    const { store, deps } = make({ now: () => now, fetchDay: vi.fn(async (d: string) => (d === DATE ? server() : server({ date: d, mission: OTHER.mission }))) });
    await started(store);
    now = new Date(2026, 8, 30, 0, 1);
    store.refresh();
    await vi.waitFor(() => expect(store.getSnapshot().date).toBe("2026-09-30"));
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    expect(deps.fetchDay).toHaveBeenLastCalledWith("2026-09-30");
  });

  it("смена суток: недоигранная вчерашняя сетка с ходами не отбирается", async () => {
    let now = NOW;
    const { store } = make({ now: () => now });
    await started(store);
    store.select(store.getSnapshot().selected!);
    store.input(1);
    now = new Date(2026, 8, 30, 0, 1);
    store.refresh();
    await Promise.resolve();
    expect(store.getSnapshot().date).toBe(DATE);
  });
});

describe("сложность фолбэка после смены суток в офлайне", () => {
  /** День 1 приходит с API, в полночь API недоступен — что строит клиентский фолбэк на 2026-09-30. */
  async function midnightOffline(first: FetchedDay) {
    let now = NOW;
    let apiUp = true;
    const { store, deps } = make({ now: () => now, fetchDay: vi.fn(async () => (apiUp ? first : down)) });
    await started(store);
    apiUp = false;
    now = new Date(2026, 8, 30, 0, 1);
    store.refresh(); // событие online/visibilitychange после полуночи: день не начат — грузим новый
    await vi.waitFor(() => expect(store.getSnapshot().date).toBe("2026-09-30"));
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    return { store, deps };
  }

  it("день из Sudoku.com (hard): фолбэк новой даты — dailyPuzzle(newDate, medium), метка hard не запоминается", async () => {
    const { store, deps } = await midnightOffline(server({ source: "sudoku.com", difficulty: "hard" }));
    const expected = dailyPuzzle("2026-09-30", DAILY_FALLBACK_DIFFICULTY);
    expect(deps.generateFallback).toHaveBeenLastCalledWith("2026-09-30", DAILY_FALLBACK_DIFFICULTY);
    const s = store.getSnapshot();
    expect(s.source).toBe("client");
    expect(s.play!.mission.join("")).toBe(expected.mission);
  });

  it("день из generator (hard): фолбэк новой даты сохраняет сложность из ответа — dailyPuzzle(newDate, hard)", async () => {
    const { store, deps } = await midnightOffline(server({ source: "generator", difficulty: "hard", winRate: null }));
    expect(deps.generateFallback).toHaveBeenLastCalledWith("2026-09-30", "hard");
    expect(store.getSnapshot().play!.mission.join("")).toBe(dailyPuzzle("2026-09-30", "hard").mission);
  });
});

describe("решение: карточка дня и Grid ∞", () => {
  it("последняя клетка приземляется в Grid ∞ на позицию последнего хода; цифра из скрытого решения", async () => {
    const { store, repo } = make();
    await started(store);
    const last = solveAll(store);
    const s = store.getSnapshot();
    expect(s.phase).toBe("solved");
    expect(s.landing).toMatchObject({ cell: last });
    expect(s.permanent!.cells).toEqual([{ cell: last, date: DATE }]);
    expect((await repo.getPermanent())!.cells).toHaveLength(1);
  });

  it("verify для серверной сетки, serverVerified false скрывает win rate у карточки (данные есть, решает UI)", async () => {
    const { store } = make({ verify: vi.fn(async () => false) });
    await started(store);
    solveAll(store);
    await vi.waitFor(() => expect(store.getSnapshot().serverVerified).toBe(false));
  });

  it("решённый день переживает пересоздание хранилища: карточка сразу, без сети и без нового прилёта", async () => {
    const first = make();
    await started(first.store);
    solveAll(first.store);
    await vi.waitFor(() => expect(first.store.getSnapshot().landing).not.toBeNull());
    const second = make({ repo: first.repo, fetchDay: vi.fn(async () => down) });
    await started(second.store);
    const s = second.store.getSnapshot();
    expect(s.phase).toBe("solved");
    expect(s.landing).toBeNull();
    expect(second.deps.fetchDay).not.toHaveBeenCalled();
    expect(s.play!.log.length).toBeGreaterThan(0);
  });

  it("ensureStarted подтягивает постоянную сетку из репозитория (счётчик реальный)", async () => {
    const { store, repo } = make();
    await repo.savePermanent({ installSeed: "x", index: 0, cells: [{ cell: 4, date: "2026-09-01" }] });
    store.ensureStarted();
    await vi.waitFor(() => expect(store.getSnapshot().permanent?.cells).toHaveLength(1));
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    solveAll(store);
    expect(store.getSnapshot().permanent!.cells).toHaveLength(2);
    store.dispose();
  });

  it("acknowledgeLanding гасит триггер прилёта", async () => {
    const { store } = make();
    await started(store);
    solveAll(store);
    expect(store.getSnapshot().landing).not.toBeNull();
    store.acknowledgeLanding();
    expect(store.getSnapshot().landing).toBeNull();
  });
});
