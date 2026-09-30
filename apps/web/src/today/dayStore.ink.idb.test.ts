// @vitest-environment jsdom
/**
 * PD-71, «живая» проверка хранилища: настоящий IndexedDbProgressRepository (fake-indexeddb, structured clone) и
 * настоящий DayStore. Полная ink-партия с 3 кляксами до конца и «закрытие PWA» (закрыли базу, открыли заново) —
 * ink, кляксы и лог должны пережить сериализацию IndexedDB, а не только in-memory репозиторий.
 */
import { blotsOf, dailyPuzzle, inkViolations, summary } from "@pundoku/engine";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { IndexedDbProgressRepository } from "../sync/idbRepository";
import { DayStore } from "./dayStore";
import type { DayDeps } from "./dayStore";
import { META_FIRST_USE, readUseStart } from "../year/firstUse";

const NOW = new Date(2026, 8, 29, 12, 0);
const DATE = "2026-09-29";

function deps(repo: IndexedDbProgressRepository): DayDeps {
  void repo.setMetaIfAbsent(META_FIRST_USE, "2026-09-01");
  return {
    repo,
    useStart: (t) => readUseStart(repo, t),
    fetchDay: vi.fn(async (d: string) => ({
      ok: true as const,
      puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 61.4 },
    })),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
  };
}
const started = async (store: DayStore) => {
  void store.load();
  await vi.waitFor(() => expect(store.getSnapshot().phase).not.toBe("loading"));
};
const enter = (store: DayStore, cell: number, wrong = false) => {
  const sol = store.getSnapshot().play!.solution[cell]!;
  store.select(cell);
  store.input(wrong ? (sol % 9) + 1 : sol);
};

describe("ink на настоящем IndexedDB", () => {
  it("3 кляксы, закрытие PWA посреди партии, возобновление и решение до конца", async () => {
    const factory = new IDBFactory();
    const repo1 = await IndexedDbProgressRepository.open(factory);
    const first = new DayStore(deps(repo1));
    await started(first);
    first.setInk(true);
    const cells = first.getSnapshot().play!.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    const wrongAt = new Set([cells[2], cells[17], cells.at(-1)]);
    for (const c of cells.slice(0, 20)) enter(first, c, wrongAt.has(c));
    const midLog = first.getSnapshot().play!.log;
    await vi.waitFor(async () => expect((await repo1.getDay(DATE))?.play.log).toHaveLength(midLog.length));
    first.dispose();
    repo1.close();

    const repo2 = await IndexedDbProgressRepository.open(factory);
    const second = new DayStore(deps(repo2));
    await started(second);
    const p = second.getSnapshot().play!;
    expect(p.ink).toBe(true);
    expect(p.log).toEqual(midLog);
    expect(blotsOf(p.log)).toHaveLength(2);
    for (const c of cells.slice(20)) enter(second, c, wrongAt.has(c));

    const s = second.getSnapshot();
    expect(s.phase).toBe("solved");
    expect(inkViolations(s.play!.log)).toEqual([]);
    expect(blotsOf(s.play!.log)).toHaveLength(3);
    expect(summary(s.play!.log)).toMatchObject({ corrections: 3, mistakes: 3, clean: false });
    const saved = await vi.waitFor(async () => {
      const d = await repo2.getDay(DATE);
      expect(d?.solved).toBe(true);
      return d!;
    });
    expect(saved.play.ink).toBe(true);
    expect(blotsOf(saved.play.log)).toHaveLength(3);
  });
});
