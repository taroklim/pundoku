// @vitest-environment jsdom
/**
 * Архив (PD-33): DayStore на произвольную прошлую дату. Загрузка через API, клиентский фолбэк по правилам PD-29,
 * прогресс по дате, `late = true` при доигрывании не в свой день, изоляция от «сегодня» и Grid ∞, ошибки 400/404,
 * интеграция с синхронизацией (late в снапшоте, не теряется при слиянии и восстановлении).
 */
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { RemoteApplied, SyncEvent, SyncHooks } from "../sync/manager";
import { pickDayRecord } from "../sync/merge";
import { progressOf } from "../sync/fixtures";
import { dayRecordFromProgress, progressFromRecord } from "../sync/schema";
import type { DayDeps } from "./dayStore";
import { archiveStore, DayStore, isArchiveDate } from "./dayStore";
import type { DayPuzzle, FetchedDay } from "./dayResolver";
import { DAILY_FALLBACK_DIFFICULTY } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const NOW = new Date(2026, 8, 29, 12, 0); // сегодня 2026-09-29
const TODAY = "2026-09-29";
const PAST = "2026-09-20";

const EASY = dailyPuzzle(PAST, "easy");
const server = (date = PAST, over: Partial<DayPuzzle> = {}): FetchedDay => ({
  ok: true,
  puzzle: { date, mission: dailyPuzzle(date, "easy").mission, difficulty: "easy", source: "sudoku.com", winRate: 61.4, ...over },
});
const http = (status: number): FetchedDay => ({ ok: false, reason: "http", status });
const down: FetchedDay = { ok: false, reason: "network" };

class FakeHooks implements SyncHooks {
  events: SyncEvent[] = [];
  listeners = new Set<(i: RemoteApplied) => void>();
  notify(e: SyncEvent) {
    this.events.push(e);
  }
  whenReady() {
    return Promise.resolve();
  }
  subscribeRemote(fn: (i: RemoteApplied) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
}

function make(over: Partial<DayDeps> = {}, repo = new InMemoryProgressRepository()) {
  const hooks = new FakeHooks();
  const deps: DayDeps = {
    repo,
    sync: hooks,
    fetchDay: vi.fn(async (d: string) => server(d)),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
    ...over,
  };
  const store = new DayStore(deps, { archive: true });
  const today = new DayStore(deps);
  return { store, today, deps, repo, hooks };
}

const opened = async (store: DayStore, date = PAST) => {
  store.openArchive(date);
  await vi.waitFor(() => expect(store.getSnapshot().phase).not.toBe("loading"));
};

function solveAll(store: DayStore): void {
  const { play } = store.getSnapshot();
  for (let i = 0; i < 81; i++) {
    if (play!.mission[i] || store.getSnapshot().play!.values[i] === play!.solution[i]) continue;
    store.select(i);
    store.input(play!.solution[i]!);
  }
}

describe("isArchiveDate", () => {
  it("только существующая календарная дата строго раньше сегодня", () => {
    expect(isArchiveDate("2026-09-28", TODAY)).toBe(true);
    expect(isArchiveDate("2020-02-29", TODAY)).toBe(true);
    expect(isArchiveDate(TODAY, TODAY)).toBe(false);
    expect(isArchiveDate("2026-09-30", TODAY)).toBe(false);
    expect(isArchiveDate("2026-02-30", TODAY)).toBe(false);
    expect(isArchiveDate("2026-9-1", TODAY)).toBe(false);
    expect(isArchiveDate("", TODAY)).toBe(false);
  });
});

describe("архив: загрузка прошлой даты", () => {
  it("ответ API /daily/:date: играем серверную сетку этой даты, подпись — эта дата, не сегодня", async () => {
    const { store, deps } = make();
    await opened(store);
    expect(deps.fetchDay).toHaveBeenCalledWith(PAST);
    expect(store.getSnapshot()).toMatchObject({ date: PAST, phase: "playing", source: "sudoku.com", verification: "server", unavailable: false, late: false });
    expect(store.getSnapshot().play!.mission.join("")).toBe(EASY.mission);
  });

  it("API недоступен: фолбэк dailyPuzzle(date, medium) — сложность по умолчанию, проверка локальная", async () => {
    const { store, deps } = make({ fetchDay: vi.fn(async () => down) });
    await opened(store);
    expect(deps.generateFallback).toHaveBeenCalledWith(PAST, DAILY_FALLBACK_DIFFICULTY);
    const s = store.getSnapshot();
    expect(s.play!.mission.join("")).toBe(dailyPuzzle(PAST, DAILY_FALLBACK_DIFFICULTY).mission);
    expect(s).toMatchObject({ date: PAST, source: "client", verification: "local", offline: true });
  });

  it("503 от API — обычная сеть: фолбэк, а не «дня нет»", async () => {
    const { store, deps } = make({ fetchDay: vi.fn(async () => http(503)) });
    await opened(store);
    expect(deps.generateFallback).toHaveBeenCalledWith(PAST, DAILY_FALLBACK_DIFFICULTY);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", source: "client", unavailable: false });
  });

  it("негодный ответ у сетки generator: фолбэк её сложности; у sudoku.com метка не идёт (medium)", async () => {
    const gen = make({ fetchDay: vi.fn(async (d: string) => server(d, { mission: "1".repeat(81), source: "generator", difficulty: "hard" })) });
    await opened(gen.store);
    expect(gen.deps.generateFallback).toHaveBeenCalledWith(PAST, "hard");
    const com = make({ fetchDay: vi.fn(async (d: string) => server(d, { mission: "1".repeat(81), source: "sudoku.com", difficulty: "hard" })) });
    await opened(com.store);
    expect(com.deps.generateFallback).toHaveBeenCalledWith(PAST, DAILY_FALLBACK_DIFFICULTY);
  });

  it("офлайн по navigator.onLine: сеть не трогаем", async () => {
    const { store, deps } = make({ isOnline: () => false });
    await opened(store);
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(store.getSnapshot().source).toBe("client");
  });

  it("сверка: фолбэк-сетка заменяется настоящей, пока нет ходов (как у сегодняшнего дня)", async () => {
    let up = false;
    const { store } = make({ slowFetchMs: 5, fetchDay: vi.fn(async (d: string) => (up ? server(d) : down)) });
    await opened(store);
    expect(store.getSnapshot().source).toBe("client");
    up = true;
    store.refresh();
    await vi.waitFor(() => expect(store.getSnapshot().source).toBe("sudoku.com"));
    expect(store.getSnapshot().play!.mission.join("")).toBe(EASY.mission);
  });
});

describe("архив: дата, которой нет", () => {
  it("«завтра» (404 not_available_yet) и будущее (400 future_date): unavailable, фолбэк не строится, ничего не пишется", async () => {
    for (const status of [404, 400]) {
      const { store, deps, repo } = make({ fetchDay: vi.fn(async () => http(status)) });
      await opened(store);
      expect(store.getSnapshot()).toMatchObject({ phase: "error", unavailable: true, play: null });
      expect(deps.generateFallback).not.toHaveBeenCalled();
      expect(await repo.listDays()).toEqual([]);
    }
  });

  it("сегодня, будущее и несуществующая дата отвергаются сразу, без сети", async () => {
    for (const date of [TODAY, "2026-09-30", "2027-01-01", "2026-02-30", "junk"]) {
      const { store, deps, repo } = make();
      await opened(store, date);
      expect(store.getSnapshot()).toMatchObject({ phase: "error", unavailable: true });
      expect(deps.fetchDay).not.toHaveBeenCalled();
      expect(await repo.listDays()).toEqual([]);
    }
  });

  it("refresh на unavailable не перезагружает (сетью «даты нет» не лечится)", async () => {
    const { store, deps } = make({ fetchDay: vi.fn(async () => http(404)) });
    await opened(store);
    store.refresh();
    await new Promise((r) => setTimeout(r, 20));
    expect(deps.fetchDay).toHaveBeenCalledTimes(1);
  });

  it("сохранённая партия этой даты переживает 404 (сохранённое надёжнее)", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.saveDay(progressOf(PAST, { solved: false, moves: 5 }));
    const { store } = make({ fetchDay: vi.fn(async () => http(404)) }, repo);
    await opened(store);
    expect(store.getSnapshot()).toMatchObject({ phase: "playing", unavailable: false });
  });
});

describe("архив: сохранение прогресса по дате", () => {
  it("ход пишется в запись именно этой даты; сегодня и Grid ∞ не появляются", async () => {
    const { store, repo } = make();
    await opened(store);
    const i = store.getSnapshot().play!.mission.findIndex((m) => !m);
    store.select(i);
    store.input(store.getSnapshot().play!.solution[i]!);
    await vi.waitFor(async () => expect((await repo.getDay(PAST))?.play.log.length).toBe(1));
    expect(await repo.getDay(TODAY)).toBeNull();
    expect(await repo.getPermanent()).toBeNull();
    expect((await repo.listDays()).map((d) => d.date)).toEqual([PAST]);
  });

  it("начатую партию можно доиграть после переоткрытия: ходы и время на месте, сеть не нужна", async () => {
    const repo = new InMemoryProgressRepository();
    const a = make({}, repo);
    await opened(a.store);
    const i = a.store.getSnapshot().play!.mission.findIndex((m) => !m);
    a.store.select(i);
    a.store.input(a.store.getSnapshot().play!.solution[i]!);
    a.store.closeArchive();
    await vi.waitFor(async () => expect((await repo.getDay(PAST))?.play.log).toHaveLength(1));
    const b = make({ fetchDay: vi.fn(async () => down) }, repo);
    await opened(b.store);
    expect(b.store.getSnapshot().play!.log).toHaveLength(1);
    expect(b.store.getSnapshot().phase).toBe("playing");
  });

  it("решённый день открывается карточкой сразу, без сети", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.saveDay(progressOf(PAST, { late: true }));
    const { store, deps } = make({}, repo);
    await opened(store);
    expect(deps.fetchDay).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", late: true, date: PAST });
  });

  it("closeArchive сбрасывает в «загрузку»: следующий экран не показывает чужую партию", async () => {
    const { store } = make();
    await opened(store);
    store.closeArchive();
    expect(store.getSnapshot()).toMatchObject({ phase: "loading", play: null, late: false, unavailable: false });
  });

  it("смена даты без закрытия грузит новую и не смешивает записи", async () => {
    const { store, repo } = make();
    await opened(store, "2026-09-20");
    const i = store.getSnapshot().play!.mission.findIndex((m) => !m);
    store.select(i);
    store.input(store.getSnapshot().play!.solution[i]!);
    await opened(store, "2026-09-21");
    await vi.waitFor(() => expect(store.getSnapshot().date).toBe("2026-09-21"));
    expect(store.getSnapshot().play!.log).toHaveLength(0);
    expect((await repo.getDay("2026-09-20"))!.play.log).toHaveLength(1);
  });
});

describe("архив: решение и late", () => {
  it("доигранный сегодня прошлый день: late = true в записи и снапшоте, дата дня прежняя, solvedAt — момент решения", async () => {
    const { store, repo, hooks } = make();
    await opened(store);
    solveAll(store);
    await vi.waitFor(() => expect(hooks.events).toContain("solved"));
    expect(await repo.getDay(PAST)).toMatchObject({ solved: true, late: true, assisted: false, solvedAt: NOW.toISOString(), date: PAST });
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", late: true });
  });

  it("не в Grid ∞: клетка не приземляется, постоянная сетка не создаётся и не меняется", async () => {
    const { store, repo } = make();
    const perm = { installSeed: "keep", index: 0, cells: [{ cell: 3, date: "2026-09-01" }] };
    await repo.savePermanent(perm);
    await opened(store);
    solveAll(store);
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"));
    expect(store.getSnapshot().landing).toBeNull();
    expect(store.getSnapshot().permanent).toBeNull();
    expect(await repo.getPermanent()).toEqual(perm);
  });

  it("hadCorrections сохраняется как раньше: ошибка и исправление видны в записи снапшота", async () => {
    const { store, repo } = make();
    await opened(store);
    const { play } = store.getSnapshot();
    const cell = play!.mission.findIndex((m) => !m);
    store.select(cell);
    store.input((play!.solution[cell]! % 9) + 1); // неверная цифра
    solveAll(store);
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"));
    await vi.waitFor(async () => expect((await repo.getDay(PAST))?.solved).toBe(true));
    const rec = dayRecordFromProgress((await repo.getDay(PAST))!, NOW)!;
    expect(rec).toMatchObject({ status: "solved", late: true, hadCorrections: true });
  });

  it("серверная проверка идёт по дате архива", async () => {
    const { store, deps } = make();
    await opened(store);
    solveAll(store);
    await vi.waitFor(() => expect(deps.verify).toHaveBeenCalled());
    expect(vi.mocked(deps.verify).mock.calls[0]![0]).toBe(PAST);
    await vi.waitFor(() => expect(store.getSnapshot().serverVerified).toBe(true));
  });

  it("день, решённый в свой день (не архив), late = false — флаг зависит от даты решения", async () => {
    const { today, repo, hooks } = make({ fetchDay: vi.fn(async (d: string) => server(d)) });
    today.ensureStarted();
    await vi.waitFor(() => expect(today.getSnapshot().phase).toBe("playing"));
    solveAll(today);
    await vi.waitFor(() => expect(hooks.events).toContain("solved"));
    expect(await repo.getDay(TODAY)).toMatchObject({ solved: true, late: false });
    today.dispose();
  });
});

describe("архив: изоляция от сегодняшнего дня", () => {
  it("два стора на одном хранилище: партия архива не трогает Today, и наоборот", async () => {
    const { store, today, repo } = make();
    today.ensureStarted();
    await vi.waitFor(() => expect(today.getSnapshot().phase).toBe("playing"));
    const before = today.getSnapshot().play;
    await opened(store);
    solveAll(store);
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"));
    expect(today.getSnapshot()).toMatchObject({ date: TODAY, phase: "playing", late: false });
    expect(today.getSnapshot().play).toBe(before);
    expect(today.getSnapshot().permanent?.cells).toHaveLength(0); // Grid ∞ не получил клетку от архива
    await vi.waitFor(async () => expect((await repo.getDay(PAST))?.solved).toBe(true));
    expect((await repo.getDay(TODAY))?.solved).toBe(false);
    today.dispose();
  });

  it("глобальный archiveStore — отдельный экземпляр, а не сегодняшний стор", async () => {
    const mod = await import("./dayStore");
    expect(mod.archiveStore).not.toBe(mod.dayStore);
    expect(archiveStore.getSnapshot().phase).toBe("loading");
  });

  it("openArchive/ensureStarted: обычный стор не открывает архив, архивный не грузит «сегодня»", async () => {
    const { store, today, deps } = make();
    expect(() => today.openArchive(PAST)).toThrow();
    store.ensureStarted();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getSnapshot().phase).toBe("loading");
    expect(deps.fetchDay).not.toHaveBeenCalled();
  });

  it("архив: событие сервера по дате перезагружает день; смена суток на нём ничего не ломает", async () => {
    const { store, repo, hooks } = make();
    await opened(store);
    await repo.saveDay(progressOf(PAST, { late: true }));
    for (const fn of hooks.listeners) fn({ dates: [PAST], gridChanged: true });
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"));
    expect(store.getSnapshot().permanent).toBeNull(); // gridChanged архивом игнорируется
    expect(store.getSnapshot().date).toBe(PAST);
  });
});

describe("архив: синхронизация (late не теряется)", () => {
  it("late уходит в снапшот дня и возвращается при восстановлении", async () => {
    const { store, repo } = make();
    await opened(store);
    solveAll(store);
    await vi.waitFor(async () => expect((await repo.getDay(PAST))?.solved).toBe(true));
    const rec = dayRecordFromProgress((await repo.getDay(PAST))!, NOW)!;
    expect(rec).toMatchObject({ status: "solved", late: true });
    expect(progressFromRecord(PAST, rec)).toMatchObject({ solved: true, late: true });
  });

  it("слияние 409: late-решённый день побеждает «не решён» с другого устройства и не теряет late", () => {
    const solved = dayRecordFromProgress(progressOf(PAST, { late: true }), NOW)!;
    const unfinished = dayRecordFromProgress(progressOf(PAST, { solved: false, moves: 3 }), NOW)!;
    expect(pickDayRecord(solved, unfinished).late).toBe(true);
    expect(pickDayRecord(unfinished, solved).late).toBe(true);
  });

  it("слияние: решён вовремя на другом устройстве (ранний solvedAt) — день не считается пропуском", () => {
    const onTime = dayRecordFromProgress(progressOf(PAST, { solvedAt: `${PAST}T09:00:00.000Z` }), NOW)!;
    const late = dayRecordFromProgress(progressOf(PAST, { late: true, solvedAt: "2026-09-29T10:00:00.000Z" }), NOW)!;
    expect(pickDayRecord(late, onTime)).toMatchObject({ late: false });
    expect(pickDayRecord(onTime, late)).toMatchObject({ late: false });
  });

  it("слияние: sudoku.com над device — запись архива с настоящей сеткой не вытесняется клиентским фолбэком", () => {
    const real = dayRecordFromProgress(progressOf(PAST, { late: true }), NOW)!;
    const device = dayRecordFromProgress(progressOf(PAST, { source: "client" }), NOW)!;
    expect(pickDayRecord(real, device).source).toBe("sudoku.com");
    expect(pickDayRecord(device, real).late).toBe(true);
  });
});
