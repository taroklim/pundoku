// @vitest-environment jsdom
/**
 * Подсказки на Today/в архиве (PD-139, решения владельца): `assisted`/`hints`/`hintLog` реально пишутся в запись дня,
 * переживают «закрытие PWA», уходят в снапшот и читаются Year (клетка «с помощью»); схема снапшота не меняется.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import { sanitizeDayRecord, dayRecordFromProgress, progressFromRecord } from "../sync/schema";
import { NOW as SNAP_NOW } from "../sync/fixtures";
import { entryFromProgress, markOf, yearContext } from "../year/model";
import { markClass } from "../year/labels";
import { META_FIRST_USE, readUseStart } from "../year/firstUse";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { DayPuzzle, FetchedDay } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const NOW = new Date(2026, 8, 29, 12, 0);
const DATE = "2026-09-29";
const PAST = "2026-09-20";

const server = (date = DATE, over: Partial<DayPuzzle> = {}): FetchedDay => ({
  ok: true,
  puzzle: { date, mission: dailyPuzzle(date, "easy").mission, difficulty: "easy", source: "sudoku.com", winRate: 61.4, ...over },
});

function deps(repo: InMemoryProgressRepository): DayDeps {
  void repo.setMetaIfAbsent(META_FIRST_USE, "2026-09-01");
  return {
    repo,
    useStart: (t) => readUseStart(repo, t),
    fetchDay: vi.fn(async (d: string) => server(d)),
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
const saved = async (repo: InMemoryProgressRepository, date = DATE) => {
  let p = await repo.getDay(date);
  await vi.waitFor(async () => {
    p = await repo.getDay(date);
    expect(p).not.toBeNull();
  });
  return p!;
};
const solveAll = (store: DayStore) => {
  const { play } = store.getSnapshot();
  play!.mission.forEach((g, i) => {
    if (g) return;
    store.select(i);
    store.input(store.getSnapshot().play!.solution[i]!);
  });
};

describe("запись дня: assisted/hints/hintLog", () => {
  it("день без подсказок: assisted=false, hints нет", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo));
    await started(store);
    solveAll(store);
    const p = await saved(repo);
    expect(p.assisted).toBe(false);
    expect(p.hints ?? 0).toBe(0);
    expect(p.play.hintLog ?? []).toHaveLength(0);
  });

  it("результативная подсказка пишется сразу и переживает «закрытие PWA»", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo));
    await started(store);
    expect(store.hintAllowed()).toBe(true);
    expect(store.registerHint(7)).toBe(true);
    const p = await vi.waitFor(async () => {
      const day = await repo.getDay(DATE);
      expect(day?.assisted).toBe(true);
      return day!;
    });
    expect(p.hints).toBe(1);
    expect(p.play.hintLog).toEqual([{ t: expect.any(Number), cell: 7 }]);

    const again = new DayStore(deps(repo));
    await started(again);
    expect(again.getSnapshot().assisted).toBe(true);
    expect(again.getSnapshot().hints).toBe(1);
    expect(again.getSnapshot().play!.hintLog).toHaveLength(1);
    expect(again.registerHint(null)).toBe(true);
    expect(again.getSnapshot().hints).toBe(2);
  });

  it("anyAssisted: пусто → false, после подсказки → true (шит правила не нужен)", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo));
    await started(store);
    expect(await store.anyAssisted()).toBe(false);
    store.registerHint(1);
    await vi.waitFor(async () => expect(await store.anyAssisted()).toBe(true));
  });

  it("Ink-день: подсказок нет и пометить его нельзя", async () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()));
    await started(store);
    store.setInk(true);
    expect(store.hintAllowed()).toBe(false);
    expect(store.registerHint(1)).toBe(false);
    expect(store.getSnapshot().assisted ?? false).toBe(false);
  });

  it("после подсказки Ink уже не включить", async () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()));
    await started(store);
    store.registerHint(1);
    expect(store.inkChoosable()).toBe(false);
    expect(store.setInk(true)).toBe(false);
  });

  it("архив: подсказки разрешены, помечают архивный день", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo), { archive: true });
    store.openArchive(PAST);
    await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
    expect(store.hintAllowed()).toBe(true);
    expect(store.registerHint(3)).toBe(true);
    const p = await vi.waitFor(async () => {
      const day = await repo.getDay(PAST);
      expect(day?.assisted).toBe(true);
      return day!;
    });
    expect(p.hints).toBe(1);
  });
});

describe("Year и снапшот читают «с помощью»", () => {
  it("решённый день с подсказкой → клетка has-help; без подсказки — нет; none не помечает", async () => {
    const helped = new InMemoryProgressRepository();
    const a = new DayStore(deps(helped));
    await started(a);
    a.registerHint(5);
    solveAll(a);
    const pa = await vi.waitFor(async () => {
      const day = await helped.getDay(DATE);
      expect(day?.solved).toBe(true);
      return day!;
    });
    expect(pa.assisted).toBe(true);
    const entry = entryFromProgress(pa)!;
    expect(entry.assisted).toBe(true);
    const ctx = yearContext("2026-09-01", new Map([[DATE, entry]]), DATE);
    const mark = markOf(DATE, entry, ctx);
    expect(mark.assisted).toBe(true);
    expect(markClass(mark)).toContain("has-help");

    const plain = new InMemoryProgressRepository();
    const b = new DayStore(deps(plain));
    await started(b);
    solveAll(b);
    const pb = await vi.waitFor(async () => {
      const day = await plain.getDay(DATE);
      expect(day?.solved).toBe(true);
      return day!;
    });
    expect(markClass(markOf(DATE, entryFromProgress(pb)!, ctx))).not.toContain("has-help");
  });

  it("снапшот: assisted и hints переживают запись → JSON → чтение; запись без hints читается как раньше", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo));
    await started(store);
    store.registerHint(5);
    store.registerHint(9);
    solveAll(store);
    const p = await vi.waitFor(async () => {
      const day = await repo.getDay(DATE);
      expect(day?.solved).toBe(true);
      return day!;
    });
    const rec = dayRecordFromProgress(p, SNAP_NOW)!;
    expect(rec.assisted).toBe(true);
    expect(rec.hints).toBe(2);
    const back = sanitizeDayRecord(JSON.parse(JSON.stringify(rec)))!;
    expect(back.assisted).toBe(true);
    expect(back.hints).toBe(2);
    const prog = progressFromRecord(DATE, back)!;
    expect(prog.assisted).toBe(true);
    expect(prog.hints).toBe(2);
    // Журнал в снапшот не уходит (только счётчик): карточка с другого устройства без полых клеток — осознанно.
    expect(prog.play.hintLog).toBeUndefined();

    const legacy = { ...JSON.parse(JSON.stringify(rec)) };
    delete legacy.hints;
    legacy.assisted = false;
    const old = sanitizeDayRecord(legacy)!;
    expect(old.hints).toBeUndefined();
    expect(old.assisted).toBe(false);
    expect(progressFromRecord(DATE, old)!.assisted).toBe(false);
  });
});
