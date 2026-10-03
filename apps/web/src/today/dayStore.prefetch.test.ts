// @vitest-environment jsdom
/**
 * PD-147 (a): запрос сетки дня стартует параллельно ожиданию восстановления и чтению записи (раньше — после них). Решённый день
 * сети по-прежнему не касается; архив не префетчится; офлайн не ходит в сеть.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { SyncHooks } from "../sync/manager";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { FetchedDay } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const NOW = new Date(2026, 8, 29, 12, 0);

const make = (repo: InMemoryProgressRepository, over: Partial<DayDeps> = {}) => {
  const fetchDay = vi.fn(async (): Promise<FetchedDay> => ({ ok: false, reason: "network" }));
  const deps: DayDeps = {
    repo,
    fetchDay,
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
    ...over,
  };
  return { store: new DayStore(deps), fetchDay, deps };
};

describe("PD-147 (a): префетч сетки дня", () => {
  it("запрос уходит, пока восстановление с сервера ещё ждётся (параллельно, а не после него)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const sync: SyncHooks = { notify: () => undefined, whenReady: () => gate, subscribeRemote: () => () => undefined };
    const { store, fetchDay } = make(new InMemoryProgressRepository(), { sync });
    void store.load();
    await vi.waitFor(() => expect(fetchDay).toHaveBeenCalledTimes(1));
    expect(store.getSnapshot().phase).toBe("loading"); // восстановление не отпущено, а запрос уже в пути
    release();
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    expect(fetchDay).toHaveBeenCalledTimes(1); // результат префетча используется, второго запроса нет
  });

  it("решённый день: сети нет вообще", async () => {
    const repo = new InMemoryProgressRepository();
    const first = make(repo, { isOnline: () => false });
    void first.store.load();
    await vi.waitFor(() => expect(first.store.getSnapshot().phase).toBe("playing"));
    const sol = first.store.getSnapshot().play!.solution;
    const mission = first.store.getSnapshot().play!.mission;
    for (let i = 0; i < 81; i++) if (mission[i] === 0) { first.store.select(i); first.store.input(sol[i]!); }
    await vi.waitFor(() => expect(first.store.getSnapshot().phase).toBe("solved"));
    await new Promise<void>((r) => setTimeout(r, 30));

    const again = make(repo);
    void again.store.load();
    await vi.waitFor(() => expect(again.store.getSnapshot().phase).toBe("solved"));
    expect(again.fetchDay).not.toHaveBeenCalled();
  });

  it("офлайн: сеть не трогаем", async () => {
    const { store, fetchDay } = make(new InMemoryProgressRepository(), { isOnline: () => false });
    void store.load();
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    expect(fetchDay).not.toHaveBeenCalled();
  });

  it("сеть отвечает отказом: партия идёт фолбэком, запрос ровно один (результат префетча используется, не повторяется)", async () => {
    const { store, fetchDay } = make(new InMemoryProgressRepository());
    void store.load();
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    expect(fetchDay).toHaveBeenCalledTimes(1);
  });
});
