// @vitest-environment jsdom
/**
 * PD-144: слот «Головоломка дня» в «Продолжить» хаба. Слот дня хаб только ЧИТАЕТ: сводка собирается из записи `days`
 * или живого стора Today; незавершённым день считается, когда он не решён и в нём есть ход или подсказка.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import type { DaySlotSource, SlotSummary } from "./daySlot";
import { summaryFromRecord, summaryFromStore, useDaySlot } from "./daySlot";
import { cellsLeft, createPlay } from "./logic";
import type { PlayState } from "./logic";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DATE = "2026-10-03";
const record = (moves: number): DayProgress => progressOf(DATE, { solved: false, moves });

describe("summaryFromRecord: что считается незавершённым днём", () => {
  it("идущий день: сложность, сколько осталось, накопленное время", () => {
    const r = record(5);
    const s = summaryFromRecord(r)!;
    expect(s).toEqual({ difficulty: "easy", left: cellsLeft(r.play), elapsedMs: r.elapsedMs, ink: false, date: DATE });
    expect(s.left).toBeLessThan(cellsLeft(createPlay({ mission: r.mission, solution: r.play.solution.join("") }))); // ходы учтены
  });

  it("нет записи, нетронутый день (ни хода, ни подсказки) и решённый день — продолжать нечего", () => {
    expect(summaryFromRecord(null)).toBeNull();
    expect(summaryFromRecord(record(0))).toBeNull();
    expect(summaryFromRecord(progressOf(DATE, { solved: true }))).toBeNull();
  });

  it("день с подсказкой, но без ходов — незавершённый", () => {
    expect(summaryFromRecord({ ...record(0), hints: 1 })).not.toBeNull();
  });

  it("нечитаемая запись не роняет хаб: слота нет", () => {
    expect(summaryFromRecord({ ...record(5), play: { ...record(5).play, values: [1, 2, 3] } } as DayProgress)).toBeNull();
  });
});

type StoreSnap = ReturnType<DaySlotSource["store"]["getSnapshot"]>;

function fakeSource(snap: Partial<StoreSnap> = {}, over: Partial<DaySlotSource["repo"]> & { day?: DayProgress | null } = {}) {
  let state: StoreSnap = { phase: "loading", play: null, difficulty: "easy", difficultyKnown: true, ...snap };
  const listeners = new Set<() => void>();
  const getDay = over.getDay ?? vi.fn(async () => over.day ?? null);
  const source: DaySlotSource = {
    store: {
      subscribe: (fn) => (listeners.add(fn), () => void listeners.delete(fn)),
      getSnapshot: () => state,
      getElapsedMs: () => 61_000,
    },
    repo: { getDay },
    now: () => new Date(2026, 9, 3, 12),
  };
  return {
    source,
    getDay,
    set(next: Partial<StoreSnap>) {
      state = { ...state, ...next };
      for (const l of listeners) l();
    },
  };
}

const playedStub = (): PlayState => {
  const r = record(7);
  return r.play;
};

describe("summaryFromStore: живая партия стора Today", () => {
  it("идёт и есть ход — сводка с живым временем; нет хода, решена, грузится — null", () => {
    const play = playedStub();
    expect(summaryFromStore(fakeSource({ phase: "playing", play }).source)).toEqual({ difficulty: "easy", left: cellsLeft(play), elapsedMs: 61_000, ink: false });
    expect(summaryFromStore(fakeSource({ phase: "playing", play: createPlay({ mission: record(0).mission, solution: play.solution.join("") }) }).source)).toBeNull();
    expect(summaryFromStore(fakeSource({ phase: "solved", play }).source)).toBeNull();
    expect(summaryFromStore(fakeSource({ phase: "loading" }).source)).toBeNull();
  });

  it("PD-262: сводка несёт дату партии стора (после полуночи стор держит вчерашний день — строка подпишет его датой)", () => {
    expect(summaryFromStore(fakeSource({ phase: "playing", play: playedStub(), date: "2026-10-02" }).source)!.date).toBe("2026-10-02");
  });

  it("сложность дня неизвестна движку — подпись без неё (difficulty: null)", () => {
    expect(summaryFromStore(fakeSource({ phase: "playing", play: playedStub(), difficultyKnown: false }).source)!.difficulty).toBeNull();
  });
});

describe("useDaySlot", () => {
  let host: HTMLDivElement;
  let root: Root;
  let seen: SlotSummary | null | undefined;
  const Probe = ({ source }: { source: DaySlotSource }) => {
    seen = useDaySlot(source);
    return null;
  };
  const flush = () => act(async () => void (await Promise.resolve()));
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

  it("приложение открылось сразу на Play (стор Today не загружен): слот читается из записи сегодняшнего дня", async () => {
    const f = fakeSource({ phase: "loading" }, { day: record(6) });
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(f.getDay).toHaveBeenCalledWith(DATE);
    expect(seen).toMatchObject({ difficulty: "easy" });
    expect(seen!.left).toBe(cellsLeft(record(6).play));
  });

  it("стор Today уже ведёт партию — он главнее записи (запись не читается)", async () => {
    const f = fakeSource({ phase: "playing", play: playedStub() }, { day: null });
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(f.getDay).not.toHaveBeenCalled();
    expect(seen).not.toBeNull();
    expect(seen!.elapsedMs).toBe(61_000);
  });

  it("изменения стора обновляют слот; «loading» стора не затирает прочитанное из хранилища", async () => {
    const f = fakeSource({ phase: "loading" }, { day: record(6) });
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    const fromRepo = seen;
    expect(fromRepo).not.toBeNull();
    act(() => f.set({ phase: "loading" }));
    expect(seen).toBe(fromRepo);
    act(() => f.set({ phase: "solved", play: playedStub() }));
    expect(seen).toBeNull(); // день решён — продолжать нечего
  });

  it("нечитаемое хранилище — слота нет, хаб не падает", async () => {
    const f = fakeSource({ phase: "loading" }, { getDay: vi.fn(async () => Promise.reject(new Error("idb"))) });
    act(() => root.render(<Probe source={f.source} />));
    await flush();
    expect(seen).toBeNull();
  });

  it("после размонтирования подписка снята и запоздавший ответ хранилища ничего не пишет", async () => {
    let resolve: (d: DayProgress | null) => void = () => undefined;
    const f = fakeSource({ phase: "loading" }, { getDay: vi.fn(() => new Promise<DayProgress | null>((r) => (resolve = r))) });
    act(() => root.render(<Probe source={f.source} />));
    act(() => root.render(null));
    resolve(record(6));
    await flush();
    expect(seen).toBeNull();
  });
});
