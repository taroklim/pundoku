// @vitest-environment jsdom
/**
 * PD-43: день, уже решённый на открытом экране (Today или архив) и заменённый слиянием 409 записью другого
 * устройства, показывает победившую запись (winRate/verification/источник), и в IndexedDB остаётся она же —
 * а не проигравшая, которую раньше перезаписывал `set()` → `persist()`.
 * Два «устройства» — настоящие `SyncManager` с общим токеном и крошечным сервером с семантикой 409.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteApplied, SyncHooks } from "../sync/manager";
import { META_TOKEN, SyncManager } from "../sync/manager";
import { progressOf } from "../sync/fixtures";
import type { PullResult, PushResult, SyncApi } from "../sync/syncApi";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { FetchedDay } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";
import { META_FIRST_USE } from "../year/firstUse";

const NOW = new Date(2026, 8, 29, 12, 0);
const TODAY = "2026-09-29";
const PAST = "2026-09-20";
const TOKEN = "shared-token";
const offline: FetchedDay = { ok: false, reason: "network" };

/** Сервер: один аккаунт, version строго растёт, устаревший PUT → 409 со снапшотом. */
function fakeServer() {
  let snap: { version: number; updatedAt: string; data: unknown } | null = null;
  const api: SyncApi = {
    register: async () => ({ kind: "ok", token: TOKEN }),
    pull: async (token): Promise<PullResult> => (token !== TOKEN ? { kind: "unauthorized" } : snap ? { kind: "ok", snapshot: structuredClone(snap) } : { kind: "none" }),
    push: async (token, body): Promise<PushResult> => {
      if (token !== TOKEN) return { kind: "unauthorized" };
      if (snap && body.version <= snap.version) return { kind: "conflict", snapshot: structuredClone(snap) };
      snap = { version: body.version, updatedAt: body.updatedAt, data: structuredClone(body.data) };
      return { kind: "ok", version: body.version };
    },
  };
  return api;
}

const managers: SyncManager[] = [];
afterEach(() => managers.splice(0).forEach((m) => m.dispose()));

function device(api: SyncApi, repo = new InMemoryProgressRepository()) {
  void repo.setMeta(META_TOKEN, TOKEN);
  void repo.setMetaIfAbsent(META_FIRST_USE, "2026-09-01");
  const listeners = new Set<(i: RemoteApplied) => void>();
  const manager = new SyncManager({
    storage: repo,
    api,
    now: () => NOW,
    isOnline: () => true,
    debounceMs: 60_000,
    retryBaseMs: 1000,
    retryMaxMs: 8000,
    onRemoteApplied: (i) => listeners.forEach((f) => f(i)),
  });
  managers.push(manager);
  const hooks: SyncHooks = {
    notify: () => undefined, // синхронизацию гоняет тест вручную (`syncNow`)
    whenReady: () => Promise.resolve(),
    subscribeRemote: (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
  return { repo, manager, hooks };
}

function deps(repo: InMemoryProgressRepository, hooks: SyncHooks): DayDeps {
  return {
    repo,
    useStart: async () => "2026-09-01",
    sync: hooks,
    fetchDay: vi.fn(async () => offline), // на устройстве A сеть до Sudoku.com не дотянулась: клиентская сетка
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
  };
}

function solveAll(store: DayStore): void {
  const { play } = store.getSnapshot();
  for (let i = 0; i < 81; i++) {
    if (play!.mission[i] || store.getSnapshot().play!.values[i] === play!.solution[i]) continue;
    store.select(i);
    store.input(play!.solution[i]!);
  }
}

const settle = () => new Promise((r) => setTimeout(r, 40));

/**
 * B решил день на настоящей сетке Sudoku.com (winRate 61.4) и отправил первым. A решил тот же день клиентским
 * фолбэком, открыл экран решённым и только теперь синхронизируется: PUT → 409 → слияние заменяет запись A записью B.
 */
async function scenario(date: string, archive: boolean) {
  const api = fakeServer();
  const b = device(api);
  await b.repo.saveDay(progressOf(date, { source: "sudoku.com", solvedAt: `${date}T20:00:00.000Z` }));
  await b.manager.syncNow();

  const a = device(api);
  const store = new DayStore(deps(a.repo, a.hooks), archive ? { archive: true } : {});
  if (archive) store.openArchive(date);
  else store.ensureStarted();
  await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
  solveAll(store);
  await vi.waitFor(async () => expect((await a.repo.getDay(date))?.solved).toBe(true));
  expect(store.getSnapshot()).toMatchObject({ phase: "solved", source: "client", winRate: null });

  await a.manager.syncNow(); // 409 → слияние: запись B победила
  return { a, b, store };
}

describe("PD-43: замена решённого дня слиянием 409 на открытом экране", () => {
  it("Today: экран показывает winRate и проверку победившей записи, в IDB остаётся она же (в т.ч. при gridChanged)", async () => {
    const api = fakeServer();
    const b = device(api);
    await b.repo.saveDay(progressOf(TODAY, { source: "sudoku.com", solvedAt: `${TODAY}T20:00:00.000Z` }));
    await b.repo.savePermanent({ installSeed: "device-b", index: 0, cells: [{ cell: 7, date: "2026-09-01" }] });
    await b.manager.syncNow();

    const a = device(api);
    const store = new DayStore(deps(a.repo, a.hooks));
    store.ensureStarted();
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    solveAll(store);
    await vi.waitFor(() => expect(store.getSnapshot().permanent?.cells.length).toBe(1));
    await vi.waitFor(async () => expect((await a.repo.getDay(TODAY))?.solved).toBe(true));
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", source: "client", winRate: null });
    const ownGrid = store.getSnapshot().permanent!.installSeed;
    expect(ownGrid).not.toBe("device-b");

    await a.manager.syncNow();
    await vi.waitFor(() => expect(store.getSnapshot().winRate).toBe(61.4));
    await settle(); // все асинхронные записи стора отработали: победителя не затёрли
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", source: "sudoku.com", winRate: 61.4, permanent: { installSeed: "device-b" } });
    expect(await a.repo.getDay(TODAY)).toMatchObject({ solved: true, source: "sudoku.com", winRate: 61.4, solvedAt: `${TODAY}T20:00:00.000Z` });
    expect((await a.repo.getDay(TODAY))!.mission).toBe(progressOf(TODAY).mission);
  });

  it("Today без смены Grid ∞: то же самое (gridChanged = false)", async () => {
    const { a, store } = await scenario(TODAY, false);
    await vi.waitFor(() => expect(store.getSnapshot().winRate).toBe(61.4));
    await settle();
    expect(store.getSnapshot()).toMatchObject({ phase: "solved", source: "sudoku.com", winRate: 61.4 });
    expect(await a.repo.getDay(TODAY)).toMatchObject({ source: "sudoku.com", winRate: 61.4 });
  });

  it("архивный день: экран показывает победившую запись, IDB не затирается", async () => {
    const { a, store } = await scenario(PAST, true);
    await vi.waitFor(() => expect(store.getSnapshot().winRate).toBe(61.4));
    await settle();
    expect(store.getSnapshot()).toMatchObject({ date: PAST, phase: "solved", source: "sudoku.com", winRate: 61.4 });
    expect(await a.repo.getDay(PAST)).toMatchObject({ solved: true, source: "sudoku.com", winRate: 61.4 });
  });
});
