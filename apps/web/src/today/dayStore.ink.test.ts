// @vitest-environment jsdom
/**
 * Чернильный режим на Today (PD-71): вход до первого хода, блокировка режима, архив, сохранение на каждый ход и
 * возобновление после «закрытия PWA» (новый DayStore на том же хранилище), запись дня в снапшот.
 */
import { blotsOf, dailyPuzzle, inkViolations, summary } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import { dayRecordFromProgress } from "../sync/schema";
import { NOW as SNAP_NOW } from "../sync/fixtures";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { DayPuzzle, FetchedDay } from "./dayResolver";
import { DAILY_FALLBACK_DIFFICULTY } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";
import { META_FIRST_USE, readUseStart } from "../year/firstUse";

const NOW = new Date(2026, 8, 29, 12, 0);
const DATE = "2026-09-29";
const PAST = "2026-09-20";
const EASY = dailyPuzzle(DATE, "easy");

const server = (date = DATE, over: Partial<DayPuzzle> = {}): FetchedDay => ({
  ok: true,
  puzzle: { date, mission: dailyPuzzle(date, "easy").mission, difficulty: "easy", source: "sudoku.com", winRate: 61.4, ...over },
});
const down: FetchedDay = { ok: false, reason: "network" };

function deps(repo: InMemoryProgressRepository, over: Partial<DayDeps> = {}): DayDeps {
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
    ...over,
  };
}

const started = async (store: DayStore) => {
  void store.load();
  await vi.waitFor(() => expect(store.getSnapshot().phase).not.toBe("loading"));
};
const opened = async (store: DayStore, date = PAST) => {
  store.openArchive(date);
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

const emptyCells = (store: DayStore): number[] => {
  const { play } = store.getSnapshot();
  return play!.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
};
/** Ввести цифру в клетку: верную либо заведомо неверную. */
function enter(store: DayStore, cell: number, wrong = false): void {
  const sol = store.getSnapshot().play!.solution[cell]!;
  store.select(cell);
  store.input(wrong ? (sol % 9) + 1 : sol);
}

describe("вход в режим", () => {
  it("режим по умолчанию выключен; включается до первого хода и пишется в запись дня", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo));
    await started(store);
    expect(store.getSnapshot().play!.ink).toBeUndefined();
    expect(store.setInk(true)).toBe(true);
    expect(store.getSnapshot().play!.ink).toBe(true);
    expect((await saved(repo)).play.ink).toBe(true);
    expect(store.setInk(false)).toBe(true); // до первого хода можно передумать
    expect(store.getSnapshot().play!.ink).toBeUndefined();
  });

  it("после первого хода режим не меняется (включить в обычной и выключить в ink нельзя)", async () => {
    const plain = new DayStore(deps(new InMemoryProgressRepository()));
    await started(plain);
    enter(plain, emptyCells(plain)[0]!);
    expect(plain.setInk(true)).toBe(false);
    expect(plain.getSnapshot().play!.ink).toBeUndefined();

    const inkStore = new DayStore(deps(new InMemoryProgressRepository()));
    await started(inkStore);
    inkStore.setInk(true);
    enter(inkStore, emptyCells(inkStore)[0]!);
    expect(inkStore.setInk(false)).toBe(false);
    expect(inkStore.getSnapshot().play!.ink).toBe(true);
  });

  it("заметка — тоже ход: после неё режим фиксируется", async () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()));
    await started(store);
    store.select(emptyCells(store)[0]!);
    store.toggleNotesMode();
    store.input(3);
    expect(store.getSnapshot().play!.log).toHaveLength(1);
    expect(store.setInk(true)).toBe(false);
  });

  it("архив: режим не включается (INK_RULES.allowInArchive = false)", async () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()), { archive: true });
    await opened(store);
    expect(store.setInk(true)).toBe(false);
    expect(store.getSnapshot().play!.ink).toBeUndefined();
  });

  it("до загрузки партии (phase loading) режим не включается", () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()));
    expect(store.setInk(true)).toBe(false);
  });
});

describe("ход в ink через стор", () => {
  it("undo() и erase() стора отвергаются: состояние не меняется", async () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()));
    await started(store);
    store.setInk(true);
    const [a] = emptyCells(store) as [number];
    enter(store, a);
    const before = store.getSnapshot().play;
    store.undo();
    store.erase();
    expect(store.getSnapshot().play).toBe(before);
    expect(store.getSnapshot().play!.values[a]).toBe(store.getSnapshot().play!.solution[a]);
  });

  it("неверная цифра: эффект blot в снапшоте, клетка закрыта верной цифрой, повторный ввод — no-op", async () => {
    const store = new DayStore(deps(new InMemoryProgressRepository()));
    await started(store);
    store.setInk(true);
    const [a] = emptyCells(store) as [number];
    enter(store, a, true);
    const s = store.getSnapshot();
    expect(s.blot).toMatchObject({ cell: a });
    expect(s.play!.values[a]).toBe(s.play!.solution[a]);
    expect(blotsOf(s.play!.log)).toHaveLength(1);
    const before = s.play;
    store.select(a);
    store.input(1);
    expect(store.getSnapshot().play).toBe(before);
    store.clearEffects();
    expect(store.getSnapshot().blot).toBeNull();
  });
});

describe("полная ink-партия с 3 ошибками и перезапуск", () => {
  it("решается до конца; лог корректен; запись дня несёт ink/blots/corrections; Grid ∞ приземляется как обычно", async () => {
    const repo = new InMemoryProgressRepository();
    const store = new DayStore(deps(repo));
    await started(store);
    store.setInk(true);
    const cells = emptyCells(store);
    const wrongAt = new Set([cells[2], cells[17], cells.at(-1)]); // в том числе последняя клетка
    for (const c of cells) enter(store, c, wrongAt.has(c));
    const s = store.getSnapshot();
    expect(s.phase).toBe("solved");
    const log = s.play!.log;
    expect(inkViolations(log)).toEqual([]);
    expect(blotsOf(log)).toHaveLength(3);
    const sum = summary(log);
    expect([sum.corrections, sum.mistakes, sum.clean]).toEqual([3, 3, false]);
    expect(s.landing).not.toBeNull();

    const progress = await vi.waitFor(async () => {
      const p = await repo.getDay(DATE);
      expect(p?.solved).toBe(true);
      return p!;
    });
    const rec = dayRecordFromProgress(progress, SNAP_NOW)!;
    expect(rec).toMatchObject({ status: "solved", ink: true, blots: 3, corrections: 3, hadCorrections: true });
  });

  it("закрыли PWA посреди партии: ink и кляксы на месте, откатить перезагрузкой нельзя", async () => {
    const repo = new InMemoryProgressRepository();
    const first = new DayStore(deps(repo));
    await started(first);
    first.setInk(true);
    const cells = emptyCells(first);
    enter(first, cells[0]!, true);
    enter(first, cells[1]!);
    enter(first, cells[2]!, true);
    await saved(repo);
    await vi.waitFor(async () => expect((await repo.getDay(DATE))!.play.log).toHaveLength(first.getSnapshot().play!.log.length));
    first.dispose();

    const second = new DayStore(deps(repo));
    await started(second);
    const p = second.getSnapshot().play!;
    expect(p.ink).toBe(true);
    expect(blotsOf(p.log)).toHaveLength(2);
    expect(p.log).toEqual(first.getSnapshot().play!.log);
    // Правила действуют и после возобновления.
    const before = second.getSnapshot().play;
    second.undo();
    second.select(cells[2]!);
    second.erase();
    second.input(1);
    expect(second.getSnapshot().play).toBe(before);
    expect(second.setInk(false)).toBe(false);
    // …и партию можно дойти до конца.
    for (const c of cells.slice(3)) enter(second, c);
    expect(second.getSnapshot().phase).toBe("solved");
    expect(summary(second.getSnapshot().play!.log).corrections).toBe(2);
  });

  it("выбор ink до первого хода переживает перезапуск", async () => {
    const repo = new InMemoryProgressRepository();
    const first = new DayStore(deps(repo));
    await started(first);
    first.setInk(true);
    await saved(repo);
    first.dispose();
    const second = new DayStore(deps(repo));
    await started(second);
    expect(second.getSnapshot().play!.ink).toBe(true);
  });

  it("сетка дня заменилась серверной до первого хода — выбор ink не теряется", async () => {
    const repo = new InMemoryProgressRepository();
    const offline = new DayStore(deps(repo, { fetchDay: vi.fn(async () => down) }));
    await started(offline);
    expect(offline.getSnapshot().source).toBe("client");
    offline.setInk(true);
    await vi.waitFor(async () => expect((await repo.getDay(DATE))?.play.ink).toBe(true));
    offline.dispose();

    const online = new DayStore(deps(repo));
    await started(online);
    // Сверка: фолбэк-сетка (другая сложность) заменена настоящей, ходов не было.
    expect(DAILY_FALLBACK_DIFFICULTY).not.toBe("easy");
    await vi.waitFor(() => expect(online.getSnapshot().play!.mission.join("")).toBe(EASY.mission));
    expect(online.getSnapshot().play!.ink).toBe(true);
  });
});
