// @vitest-environment jsdom
/**
 * Лесенка подсказок (PD-139): ступени, «с помощью» только за результативные открытия, Ink без подсказок,
 * шит правила, закрытие на ступени ≥3, строка-намёк.
 */
import { describe, expect, it, vi } from "vitest";
import { playOf, withValue } from "./hint.fixtures";
import type { FixtureName } from "./hint.fixtures";
import { HintLadder, NUDGE_AFTER_MS, NUDGE_KEY, RULE_KEY } from "./hintStore";
import type { FlagStore } from "./hintStore";
import { computeHint, hintFocusCell } from "./hintModel";
import type { PlayState } from "./logic";
import { PlayStore } from "./store";

function memoryFlags(initial: string[] = []): FlagStore & { has: (k: string) => boolean } {
  const set = new Set(initial);
  return { get: (k) => set.has(k), set: (k) => void set.add(k), has: (k) => set.has(k) };
}

function storeOf(play: PlayState, extra: Record<string, unknown> = {}): PlayStore {
  const store = new PlayStore();
  const inner = store as unknown as { snap: Record<string, unknown> };
  inner.snap = { ...inner.snap, phase: "playing", play, selected: null, ...extra };
  return store;
}

function ladderOn(name: FixtureName, opts: { seen?: boolean; play?: (p: PlayState) => PlayState; extra?: Record<string, unknown> } = {}) {
  const flags = memoryFlags(opts.seen === false ? [] : [RULE_KEY]);
  const play = opts.play ? opts.play(playOf(name)) : playOf(name);
  const store = storeOf(play, opts.extra);
  const ladder = new HintLadder(store, { flags });
  ladder.attach();
  return { store, ladder, flags };
}

describe("ступени", () => {
  it("открытие даёт ступень 1, «Ещё шаг» ведёт вниз до 4, на 4-й следующий вызов закрывает", () => {
    const { ladder } = ladderOn("hiddenSingle");
    ladder.openLadder();
    expect(ladder.getState()).toMatchObject({ open: true, step: 1 });
    ladder.next();
    ladder.next();
    ladder.next();
    expect(ladder.getState().step).toBe(4);
    ladder.next();
    expect(ladder.getState().open).toBe(false);
  });

  it("лампочка (toggle) открывает и закрывает", () => {
    const { ladder } = ladderOn("nakedSingle");
    ladder.toggle();
    expect(ladder.getState().open).toBe(true);
    ladder.toggle();
    expect(ladder.getState().open).toBe(false);
  });

  it("ступень ≥3 при закрытии выбирает клетку шага; ступень 1–2 выбор не трогает", () => {
    const a = ladderOn("hiddenSingle");
    a.ladder.openLadder();
    a.ladder.next();
    a.ladder.close();
    expect(a.store.getSnapshot().selected).toBeNull();

    const b = ladderOn("hiddenSingle");
    b.ladder.openLadder();
    b.ladder.next();
    b.ladder.next();
    const h = b.ladder.getState().hint!;
    b.ladder.close();
    expect(h.kind).toBe("step");
    expect(b.store.getSnapshot().selected).toBe(hintFocusCell(h as never));
  });

  it("закрытие снимает подсветку и подсказку", () => {
    const { ladder } = ladderOn("pointing");
    ladder.openLadder();
    expect(ladder.getState().marks).not.toBeNull();
    ladder.close();
    expect(ladder.getState()).toMatchObject({ open: false, hint: null, marks: null });
  });
});

describe("«с помощью»: только за результативные открытия", () => {
  it("первая ступень шага: assisted=true, hints=1, запись в hintLog с клеткой", () => {
    const { ladder, store } = ladderOn("hiddenSingle");
    ladder.openLadder();
    const snap = store.getSnapshot();
    expect(snap.assisted).toBe(true);
    expect(snap.hints).toBe(1);
    expect(snap.play!.hintLog).toHaveLength(1);
    expect(snap.play!.hintLog![0]!.cell).not.toBeNull();
  });

  it("ступени одного открытия не накручивают счёт; новое открытие — плюс один", () => {
    const { ladder, store } = ladderOn("nakedSingle");
    ladder.openLadder();
    ladder.next();
    ladder.next();
    ladder.next();
    expect(store.getSnapshot().hints).toBe(1);
    ladder.close();
    ladder.openLadder();
    expect(store.getSnapshot().hints).toBe(2);
  });

  it("«ничего не нашёл» (beyond) ничего не помечает и не считает", () => {
    const { ladder, store } = ladderOn("beyond");
    ladder.openLadder();
    expect(ladder.getState().hint).toEqual({ kind: "none", reason: "beyond" });
    expect(store.getSnapshot().assisted ?? false).toBe(false);
    expect(store.getSnapshot().hints ?? 0).toBe(0);
    expect(store.getSnapshot().play!.hintLog ?? []).toHaveLength(0);
  });

  it("ошибка на доске — результативное открытие: помечает, клетка в журнале null", () => {
    const { ladder, store } = ladderOn("nakedSingle", {
      play: (p) => {
        const s = computeHint(p);
        if (s.kind !== "step") throw new Error("fixture");
        return withValue(p, s.placement!.cell, (s.placement!.digit % 9) + 1);
      },
    });
    ladder.openLadder();
    expect(ladder.getState().hint!.kind).toBe("mistake");
    const snap = store.getSnapshot();
    expect(snap.assisted).toBe(true);
    expect(snap.play!.hintLog).toEqual([{ t: expect.any(Number), cell: null }]);
  });

  it("поставил цифру при открытом доке — пересчёт в той же сессии, счёт не растёт, ступень 1", () => {
    const { ladder, store } = ladderOn("nakedSingle");
    ladder.openLadder();
    ladder.next();
    const h = ladder.getState().hint;
    expect(h!.kind).toBe("step");
    const s = h as Extract<typeof h, { kind: "step" }>;
    store.select(s.placement!.cell);
    store.input(s.placement!.digit);
    expect(ladder.getState().open).toBe(true);
    expect(ladder.getState().step).toBe(1);
    expect(store.getSnapshot().hints).toBe(1);
  });
});

describe("Ink и закрытые состояния: подсказок нет", () => {
  it("Ink-партия: hintAllowed=false, лампочка ничего не открывает и ничего не помечает", () => {
    const { ladder, store } = ladderOn("hiddenSingle", { play: (p) => ({ ...p, ink: true }) });
    expect(store.hintAllowed()).toBe(false);
    ladder.toggle();
    expect(ladder.getState().open).toBe(false);
    expect(ladder.getState().rule).toBe(false);
    expect(store.getSnapshot().assisted ?? false).toBe(false);
    expect(store.registerHint(3)).toBe(false);
  });

  it("решённая партия и фаза не playing — тоже нет", () => {
    const solved = ladderOn("hiddenSingle", { play: (p) => ({ ...p, solved: true }) });
    solved.ladder.openLadder();
    expect(solved.ladder.getState().open).toBe(false);
    const loading = ladderOn("hiddenSingle", { extra: { phase: "loading" } });
    loading.ladder.openLadder();
    expect(loading.ladder.getState().open).toBe(false);
  });

  it("после подсказки Ink включить нельзя", () => {
    const { ladder, store } = ladderOn("hiddenSingle");
    ladder.openLadder();
    ladder.close();
    expect(store.inkChoosable()).toBe(false);
    expect(store.setInk(true)).toBe(false);
    expect(store.getSnapshot().play!.ink === true).toBe(false);
  });

  it("Ink-партия при открытом доке закрывает док без выбора клетки", () => {
    const { ladder, store } = ladderOn("hiddenSingle");
    ladder.openLadder();
    const inner = store as unknown as { snap: Record<string, unknown> };
    inner.snap = { ...inner.snap, play: { ...(inner.snap.play as PlayState), ink: true } };
    (store as unknown as { set: (p: object) => void }).set({});
    expect(ladder.getState().open).toBe(false);
  });
});

describe("шит правила", () => {
  it("первое открытие за всё время показывает шит, ничего не помечая; «Показать» помечает и открывает", () => {
    const { ladder, store, flags } = ladderOn("hiddenSingle", { seen: false });
    ladder.openLadder();
    expect(ladder.getState()).toMatchObject({ rule: true, open: false });
    expect(store.getSnapshot().assisted ?? false).toBe(false);
    expect(flags.has(RULE_KEY)).toBe(false);
    ladder.confirmRule();
    expect(ladder.getState()).toMatchObject({ rule: false, open: true });
    expect(store.getSnapshot().assisted).toBe(true);
    expect(flags.has(RULE_KEY)).toBe(true);
  });

  it("«Не сейчас» — шит уходит, пометки нет, при следующем открытии шит снова", () => {
    const { ladder, store } = ladderOn("hiddenSingle", { seen: false });
    ladder.openLadder();
    ladder.dismissRule();
    expect(ladder.getState().rule).toBe(false);
    expect(store.getSnapshot().assisted ?? false).toBe(false);
    ladder.openLadder();
    expect(ladder.getState().rule).toBe(true);
  });

  it("шит не нужен, если в партии уже были подсказки или «уже были дни с подсказкой»", async () => {
    const a = ladderOn("hiddenSingle", { seen: false, extra: { hints: 1 } });
    a.ladder.openLadder();
    expect(a.ladder.getState().rule).toBe(false);

    const store = storeOf(playOf("hiddenSingle"));
    const ladder = new HintLadder(store, { flags: memoryFlags(), assistedBefore: async () => true });
    ladder.attach();
    await Promise.resolve();
    await Promise.resolve();
    ladder.openLadder();
    expect(ladder.getState()).toMatchObject({ rule: false, open: true });
  });
});

describe("строка-намёк", () => {
  const quiet = (flags: FlagStore, ms: number, over: Record<string, unknown> = {}) => {
    const store = storeOf(playOf("hiddenSingle"), over);
    vi.spyOn(store, "getElapsedMs").mockReturnValue(ms);
    const ladder = new HintLadder(store, { flags });
    ladder.attach();
    return { ladder, store };
  };

  it("после порога тишины показывается один раз на устройство", () => {
    const flags = memoryFlags([RULE_KEY]);
    expect(quiet(flags, NUDGE_AFTER_MS - 1).ladder.checkNudge()).toBe(false);
    const q = quiet(flags, NUDGE_AFTER_MS + 1);
    expect(q.ladder.checkNudge()).toBe(true);
    expect(flags.has(NUDGE_KEY)).toBe(true);
    expect(quiet(flags, NUDGE_AFTER_MS * 5).ladder.checkNudge()).toBe(false);
  });

  it("не показывается, если уже брали подсказку, а также в Ink и при открытом доке", () => {
    expect(quiet(memoryFlags(), NUDGE_AFTER_MS + 1, { hints: 1 }).ladder.checkNudge()).toBe(false);
    const ink = storeOf({ ...playOf("hiddenSingle"), ink: true });
    vi.spyOn(ink, "getElapsedMs").mockReturnValue(NUDGE_AFTER_MS + 1);
    const l = new HintLadder(ink, { flags: memoryFlags() });
    l.attach();
    expect(l.checkNudge()).toBe(false);
    const q = quiet(memoryFlags([RULE_KEY]), NUDGE_AFTER_MS + 1);
    q.ladder.openLadder();
    expect(q.ladder.checkNudge()).toBe(false);
  });

  it("исчезает, когда игрок поставил цифру", () => {
    const flags = memoryFlags([RULE_KEY]);
    const { ladder, store } = quiet(flags, NUDGE_AFTER_MS + 1);
    expect(ladder.checkNudge()).toBe(true);
    const h = computeHint(store.getSnapshot().play!);
    if (h.kind !== "step") throw new Error("fixture");
    store.select(h.placement!.cell);
    store.input(h.placement!.digit);
    expect(ladder.getState().nudge).toBe(false);
  });
});
