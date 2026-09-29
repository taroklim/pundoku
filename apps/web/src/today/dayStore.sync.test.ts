// @vitest-environment jsdom
/** Интеграция DayStore с синхронизацией (PD-14): уведомления, поля Year, восстановление, деградация без sync. */
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { RemoteApplied, SyncEvent, SyncHooks } from "../sync/manager";
import { progressOf } from "../sync/fixtures";
import type { DayDeps } from "./dayStore";
import { DayStore, RESTORE_WAIT_MS } from "./dayStore";
import type { FetchedDay } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const DATE = "2026-09-29";
const EASY = dailyPuzzle(DATE, "easy");
const server = (): FetchedDay => ({ ok: true, puzzle: { date: DATE, mission: EASY.mission, difficulty: "easy", source: "sudoku.com", winRate: 61.4 } });

class FakeHooks implements SyncHooks {
  events: SyncEvent[] = [];
  listeners = new Set<(i: RemoteApplied) => void>();
  ready: Promise<void> = Promise.resolve();
  waits: number[] = [];
  notify(e: SyncEvent) {
    this.events.push(e);
  }
  whenReady(ms: number) {
    this.waits.push(ms);
    return this.ready;
  }
  subscribeRemote(fn: (i: RemoteApplied) => void) {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }
  emit(i: RemoteApplied) {
    this.listeners.forEach((f) => f(i));
  }
}

function make(now: Date, over: Partial<DayDeps> = {}, hooks: SyncHooks | undefined = new FakeHooks()) {
  const repo = new InMemoryProgressRepository();
  const deps: DayDeps = {
    repo,
    sync: hooks,
    fetchDay: vi.fn(async () => server()),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => now,
    isOnline: () => true,
    slowFetchMs: 50,
    ...over,
  };
  return { store: new DayStore(deps), repo, hooks: hooks as FakeHooks, deps };
}

const started = async (store: DayStore) => {
  store.ensureStarted();
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

describe("DayStore + sync", () => {
  it("решение: notify('solved') приходит после записи дня и улёта в хранилище; поля Year фиксируются", async () => {
    const now = new Date(2026, 8, 29, 12, 0);
    const { store, repo, hooks } = make(now);
    await started(store);
    solveAll(store);
    await vi.waitFor(() => expect(hooks.events).toContain("solved"));
    // к моменту уведомления всё уже лежит в хранилище
    const day = (await repo.getDay(DATE))!;
    expect(day).toMatchObject({ solved: true, solvedAt: now.toISOString(), late: false, assisted: false });
    expect((await repo.getPermanent())!.cells).toHaveLength(1);
    expect(hooks.events.filter((e) => e === "solved")).toHaveLength(1);
  });

  it("день решён после полуночи (дата дня < сегодня на момент решения): late = true, дата дня прежняя", async () => {
    let now = new Date(2026, 8, 29, 23, 50);
    const { store, repo, hooks } = make(now, { now: () => now });
    await started(store);
    const i = store.getSnapshot().play!.mission.findIndex((m) => !m);
    store.select(i);
    store.input(store.getSnapshot().play!.solution[i]!);
    now = new Date(2026, 8, 30, 0, 10);
    store.refresh(); // вчерашняя сетка с ходами не отбирается
    solveAll(store);
    await vi.waitFor(() => expect(hooks.events).toContain("solved"));
    expect(await repo.getDay(DATE)).toMatchObject({ solved: true, late: true, assisted: false, solvedAt: now.toISOString() });
  });

  it("начатый день уведомляет 'progress' (для debounce), без ходов — нет", async () => {
    const { store, hooks } = make(new Date(2026, 8, 29, 12, 0));
    await started(store);
    expect(hooks.events).toEqual([]);
    const i = store.getSnapshot().play!.mission.findIndex((m) => !m);
    store.select(i);
    store.input(store.getSnapshot().play!.solution[i]!);
    expect(hooks.events).toContain("progress");
  });

  it("загрузка ждёт восстановления с сервера (не дольше RESTORE_WAIT_MS) и видит восстановленный день", async () => {
    const now = new Date(2026, 8, 29, 12, 0);
    const hooks = new FakeHooks();
    const restored = progressOf(DATE);
    const { store, repo } = make(now, { fetchDay: vi.fn(async () => ({ ok: false, reason: "network" }) as FetchedDay) }, hooks);
    let release!: () => void;
    hooks.ready = new Promise<void>((r) => (release = r));
    store.ensureStarted();
    await new Promise((r) => setTimeout(r, 30));
    expect(store.getSnapshot().phase).toBe("loading"); // ждём сверки
    await repo.saveDay(restored); // «восстановление» записало день
    release();
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"));
    expect(hooks.waits).toEqual([RESTORE_WAIT_MS]);
  });

  it("постоянная сетка: если сервер её восстановил — берётся она, а не новый installSeed", async () => {
    const hooks = new FakeHooks();
    const { store, repo } = make(new Date(2026, 8, 29, 12, 0), {}, hooks);
    let release!: () => void;
    hooks.ready = new Promise<void>((r) => (release = r));
    store.ensureStarted();
    await repo.savePermanent({ installSeed: "from-server", index: 0, cells: [{ cell: 3, date: "2026-09-01" }] });
    release();
    await vi.waitFor(() => expect(store.getSnapshot().permanent?.installSeed).toBe("from-server"));
    store.dispose();
  });

  it("applyRemote: сервер прислал решённое сегодня, пока играли — день перезагружается решённым; Grid ∞ обновляется", async () => {
    const { store, repo, hooks } = make(new Date(2026, 8, 29, 12, 0));
    await started(store);
    expect(store.getSnapshot().phase).toBe("playing");
    await repo.saveDay(progressOf(DATE));
    await repo.savePermanent({ installSeed: "srv", index: 0, cells: [{ cell: 1, date: "2026-09-01" }] });
    hooks.emit({ dates: [DATE], gridChanged: true });
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"));
    await vi.waitFor(() => expect(store.getSnapshot().permanent?.installSeed).toBe("srv"));
  });

  it("dispose отписывается от событий сервера", async () => {
    const { store, hooks } = make(new Date(2026, 8, 29, 12, 0));
    await started(store);
    expect(hooks.listeners.size).toBe(1);
    store.dispose();
    expect(hooks.listeners.size).toBe(0);
  });

  it("без sync (тесты/деградация): игра работает как раньше, ожидания восстановления нет", async () => {
    const { store, repo } = make(new Date(2026, 8, 29, 12, 0), {}, undefined);
    await started(store);
    solveAll(store);
    await vi.waitFor(async () => expect((await repo.getDay(DATE))?.solved).toBe(true));
    expect(store.getSnapshot().phase).toBe("solved");
  });
});
