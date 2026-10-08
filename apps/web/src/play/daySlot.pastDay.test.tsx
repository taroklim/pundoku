// @vitest-environment jsdom
/**
 * PD-275 (одобрено владельцем 2026-10-09): вчерашний незаконченный день Today не пропадает из «Продолжить» после перезапуска —
 * как вчерашний Лжец дня (PD-217). Стор Today после перезапуска грузит сегодняшний день, поэтому слот ищет незавершённый день
 * в хранилище (`listDays`): живая партия стора → сегодняшний → самый поздний прошлый; строка одна. Дата в подписи — PD-262
 * (`SlotSummary.date`). Открывается та же запись, та же сетка (архивный стор этой даты, App › continueDay).
 */
import { dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progressOf } from "../sync/fixtures";
import type { DayDeps } from "../today/dayStore";
import { DayStore } from "../today/dayStore";
import type { FetchedDay } from "../today/dayResolver";
import type { DayProgress } from "../today/repository";
import { InMemoryProgressRepository } from "../today/repository";
import type { DaySlotSource, SlotSummary } from "./daySlot";
import { summaryFromRepo, useDaySlot } from "./daySlot";
import type { PlayState } from "./logic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const D0 = "2026-10-05";
const D1 = "2026-10-06"; // вчера
const D2 = "2026-10-07"; // сегодня
const noon = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
};
const unfinished = (date: string, moves = 5): DayProgress => progressOf(date, { solved: false, moves });

type StoreSnap = ReturnType<DaySlotSource["store"]["getSnapshot"]>;

/** Стор Today под тест + хранилище со списком дней. */
function fakeSource(snap: Partial<StoreSnap>, days: DayProgress[]) {
  let state: StoreSnap = { phase: "loading", play: null, difficulty: "easy", difficultyKnown: true, ...snap };
  const listeners = new Set<() => void>();
  const list = [...days];
  const listDays = vi.fn(async () => [...list]);
  const getDay = vi.fn(async (d: string) => list.find((x) => x.date === d) ?? null);
  const source: DaySlotSource = {
    store: {
      subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
      getSnapshot: () => state,
      getElapsedMs: () => 61_000,
    },
    repo: { getDay, listDays },
    now: () => noon(D2),
  };
  return {
    source,
    listDays,
    days: list,
    set(next: Partial<StoreSnap>) {
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
  };
}
const untouched = (date: string): PlayState => ({ ...unfinished(date, 0).play });

describe("summaryFromRepo: какой день хранилища — в «Продолжить»", () => {
  it("сегодняшний главнее прошлых; без сегодняшнего — самый поздний прошлый; решённые и нетронутые не в счёт", async () => {
    const solvedLater = progressOf("2026-10-06", { solved: true });
    const f = fakeSource({}, [unfinished(D0), unfinished(D1, 0), unfinished("2026-09-30"), solvedLater]);
    expect((await summaryFromRepo(f.source, D2, null))?.date).toBe(D0);
    f.days.push(unfinished(D2));
    expect((await summaryFromRepo(f.source, D2, null))?.date).toBe(D2);
    expect((await summaryFromRepo(f.source, D2, D2))?.date).toBe(D0); // дату ведёт стор — о ней судит он
  });

  it("хранилище без listDays — только сегодняшний, как до PD-275", async () => {
    const getDay = vi.fn(async (d: string) => (d === D2 ? unfinished(D2) : unfinished(D1)));
    const source: DaySlotSource = { store: fakeSource({}, []).source.store, repo: { getDay }, now: () => noon(D2) };
    expect((await summaryFromRepo(source, D2, null))?.date).toBe(D2);
    expect(await summaryFromRepo(source, D2, D2)).toBeNull();
    expect(getDay).toHaveBeenCalledTimes(1);
  });
});

describe("useDaySlot: вчерашний день после перезапуска", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: SlotSummary | null | undefined;
  const Probe = ({ source, refresh }: { source: DaySlotSource; refresh?: string }) => {
    seen = useDaySlot(source, refresh);
    return null;
  };
  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  beforeEach(() => {
    seen = undefined;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("стор Today уже на сегодняшнем (нетронут) — строка дня = вчерашний незаконченный, с его датой", async () => {
    const f = fakeSource({ phase: "playing", date: D2, play: untouched(D2) }, [unfinished(D1)]);
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(seen).toMatchObject({ date: D1, difficulty: "easy" });
  });

  it("приложение открылось сразу на Play (стор грузится) — тоже вчерашний", async () => {
    const f = fakeSource({ phase: "loading" }, [unfinished(D1)]);
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(seen?.date).toBe(D1);
  });

  it("сегодняшний с прогрессом в сторе — первым (хранилище не читается); решили его — возвращается вчерашний", async () => {
    const f = fakeSource({ phase: "playing", date: D2, play: unfinished(D2, 3).play }, [unfinished(D1)]);
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(seen?.date).toBe(D2);
    expect(f.listDays).not.toHaveBeenCalled();
    act(() => f.set({ phase: "solved" }));
    await flush();
    expect(seen?.date).toBe(D1);
  });

  it("ходы по нетронутому сегодняшнему без смены дня хранилище заново не читают", async () => {
    const f = fakeSource({ phase: "playing", date: D2, play: untouched(D2) }, [unfinished(D1)]);
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    const calls = f.listDays.mock.calls.length;
    act(() => f.set({ selected: 4 } as Partial<StoreSnap>));
    act(() => f.set({ selected: 5 } as Partial<StoreSnap>));
    await flush();
    expect(f.listDays.mock.calls.length).toBe(calls);
  });

  it("вчерашний доигран в архиве — при возврате на хаб (refresh) строка уходит; запись дня, который ведёт стор, не дублирует его", async () => {
    const f = fakeSource({ phase: "playing", date: D2, play: untouched(D2) }, [unfinished(D1)]);
    act(() => root.render(<Probe source={f.source} refresh="a" />));
    await flush();
    expect(seen?.date).toBe(D1);
    f.days.splice(0, 1, progressOf(D1, { solved: true }));
    act(() => root.render(<Probe source={f.source} refresh="b" />));
    await flush();
    expect(seen).toBeNull();
  });

  it("стор держит вчерашний (полночь на открытом приложении) и он решён — устаревшая запись вчерашнего строку не возвращает", async () => {
    const f = fakeSource({ phase: "solved", date: D1, play: unfinished(D1, 3).play }, [unfinished(D1)]);
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(seen).toBeNull();
  });
});

describe("PD-275 сквозной: начать день → перезапуск на следующий день → «Продолжить» → та же сетка", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: SlotSummary | null | undefined;
  const Probe = ({ source }: { source: DaySlotSource }) => {
    seen = useDaySlot(source);
    return null;
  };
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("вчерашняя запись видна хабу с датой, архивный стор открывает ту же сетку с теми же ходами и решает её на её дату", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.setMetaIfAbsent("firstUseDate", D1);
    let now = noon(D1);
    const server = (date: string): FetchedDay => ({
      ok: true,
      puzzle: { date, mission: dailyPuzzle(date, "easy").mission, difficulty: "easy", source: "sudoku.com", winRate: 50 },
    });
    const deps: DayDeps = {
      repo,
      fetchDay: vi.fn(async (d: string) => server(d)),
      verify: vi.fn(async () => true),
      generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
      now: () => now,
      isOnline: () => true,
      slowFetchMs: 50,
    };

    // Вечер D1: день начат на Today, два хода.
    const evening = new DayStore(deps);
    await evening.load();
    const p1 = evening.getSnapshot().play!;
    const empties = p1.mission.map((g, i) => (g === 0 ? i : -1)).filter((i) => i >= 0);
    for (const c of empties.slice(0, 2)) {
      evening.select(c);
      evening.input(p1.solution[c]!);
    }
    const values = [...evening.getSnapshot().play!.values];
    await vi.waitFor(async () => expect((await repo.getDay(D1))?.play.log.length).toBe(2));
    evening.dispose();

    // Утро D2, перезапуск: стор Today грузит сегодняшний (нетронутый).
    now = noon(D2);
    const morning = new DayStore(deps);
    await morning.load();
    expect(morning.getSnapshot()).toMatchObject({ date: D2, phase: "playing" });
    const source: DaySlotSource = { store: morning, repo, now: () => now };
    act(() => root.render(<Probe source={source} />));
    await vi.waitFor(async () => {
      await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
      expect(seen?.date).toBe(D1);
    });
    expect(seen!.left).toBe(empties.length - 2);

    // Тап по строке → архив этой даты: та же сетка, те же ходы; решение — в запись D1 (Year: «поздно», как у любого архивного).
    const archive = new DayStore(deps, { archive: true });
    archive.openArchive(D1);
    await vi.waitFor(() => expect(archive.getSnapshot().phase).toBe("playing"));
    expect(archive.getSnapshot().play!.mission.join("")).toBe(p1.mission.join(""));
    expect(archive.getSnapshot().play!.values).toEqual(values);
    const p = archive.getSnapshot().play!;
    for (const c of empties.slice(2)) {
      archive.select(c);
      archive.input(p.solution[c]!);
    }
    expect(archive.getSnapshot().phase).toBe("solved");
    await vi.waitFor(async () => expect((await repo.getDay(D1))?.solved).toBe(true));
    expect((await repo.getDay(D2))?.play.log.length ?? 0).toBe(0);
    archive.dispose();
    morning.dispose();
  });
});
