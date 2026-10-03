// @vitest-environment jsdom
// QA PD-91: финал в Play (PD-89) — dim-фаза 240 мс (140 при reduced motion), затем карточка; тап (pointerdown) в dim-фазе
// показывает карточку сразу; без тапа карточка появляется ровно по таймеру; слушатель снимается (нет утечки).
// PD-95: фокус на карточку — после кадра, а не в задаче монтажа; отложенный фокус не возвращает ghost-click (PD-94).
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { createPlay, enterDigit } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

/** Партия без последней пустой клетки: следующий верный ввод в неё решает пазл. */
function almostSolved() {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  const open: number[] = [];
  for (let i = 0; i < 81; i++) if (!p.mission[i]) open.push(i);
  const last = open[open.length - 1]!;
  open.slice(0, -1).forEach((cell, k) => {
    p = enterDigit(p, cell, p.solution[cell] as number, (k + 1) * 1000);
  });
  expect(p.solved).toBe(false);
  return { play: p, last };
}

function setReduced(reduced: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: reduced && q.includes("reduce"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  })) as never;
}

let host: HTMLDivElement;
let root: Root;
const card = () => host.querySelector(".card, [data-testid='result-card'], .result, [data-testid='new-puzzle']");
const dimmed = () => host.querySelector(".board.dim") !== null;

function startAlmostSolved() {
  const { play, last } = almostSolved();
  const inner = playStore as unknown as { snap: Record<string, unknown> };
  inner.snap = { ...inner.snap, hub: false, phase: "playing", play, selected: last, startedOn: new Date() };
  act(() => root.render(<PlayScreen />));
  expect(card()).toBeNull();
  // последний верный ввод -> phase "solved"
  act(() => playStore.input(SOLUTION.charCodeAt(last) - 48));
  expect(playStore.getSnapshot().phase).toBe("solved");
}

beforeEach(() => {
  vi.useFakeTimers();
  // rAF под управлением fake-таймеров: один кадр = 16 мс (afterPaint: rAF → setTimeout 0).
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  setReduced(false);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("финал Play: dim-фаза и тап-прерывание (PD-89)", () => {
  it("после решения поле гаснет (dim), карточки ещё нет", () => {
    startAlmostSolved();
    expect(dimmed()).toBe(true);
    expect(card()).toBeNull();
  });

  it("без тапа карточка появляется ровно через 240 мс (не раньше)", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(239));
    expect(card()).toBeNull();
    expect(dimmed()).toBe(true);
    act(() => void vi.advanceTimersByTime(1));
    expect(card()).not.toBeNull();
    expect(dimmed()).toBe(false);
  });

  it("pointerdown в dim-фазе показывает карточку сразу, не дожидаясь таймера", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(50));
    expect(card()).toBeNull();
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(card()).not.toBeNull();
    expect(dimmed()).toBe(false);
    // таймер, сработавший позже, ничего не ломает (карточка остаётся, без исключений)
    act(() => void vi.advanceTimersByTime(500));
    expect(card()).not.toBeNull();
  });

  it("тап по самой сетке (capture) тоже прерывает dim-фазу", () => {
    startAlmostSolved();
    const cell = host.querySelector(".board .cell, .board [role='gridcell'], .board div");
    expect(cell).not.toBeNull();
    act(() => {
      cell!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(card()).not.toBeNull();
  });

  it("reduced motion: dim-фаза 140 мс", () => {
    setReduced(true);
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(139));
    expect(card()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(card()).not.toBeNull();
  });

  it("reduced motion: тап тоже прерывает", () => {
    setReduced(true);
    startAlmostSolved();
    act(() => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(card()).not.toBeNull();
  });

  it("слушатель pointerdown снимается при уходе из solved (новая партия) — утечки нет", () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");
    startAlmostSolved();
    const added = add.mock.calls.filter((c) => c[0] === "pointerdown").length;
    expect(added).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(300));
    act(() => playStore.toHub());
    const removed = remove.mock.calls.filter((c) => c[0] === "pointerdown").length;
    expect(removed).toBe(added);
    add.mockRestore();
    remove.mockRestore();
  });

  it("новая партия после финала: dim и карточка сбрасываются", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(300));
    expect(card()).not.toBeNull();
    act(() => playStore.toHub());
    expect(card()).toBeNull();
    expect(dimmed()).toBe(false);
  });
  // PD-94: хвост прерывающего касания не должен нажать кнопку, оказавшуюся под пальцем.
  const newGame = () => host.querySelector<HTMLButtonElement>('button[data-testid="new-puzzle"]')!;
  const tap = (target: Element, detail = 1) => {
    target.dispatchEvent(new Event("pointerup", { bubbles: true }));
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
  };

  it("тап-прерывание: click того же касания над кнопкой «New game» гасится, карточка остаётся (PD-94)", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(50));
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(card()).not.toBeNull();
    act(() => tap(newGame()));
    expect(playStore.getSnapshot().phase).toBe("solved");
    expect(card()).not.toBeNull();
  });

  it("после прерывающего тапа следующий осознанный тап по «New game» работает", () => {
    startAlmostSolved();
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => tap(newGame())); // хвост — погашен
    act(() => {
      newGame().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => tap(newGame()));
    expect(playStore.getSnapshot().phase).not.toBe("solved");
  });

  it("клавиатурная активация «New game» сразу после прерывания не блокируется (detail 0)", () => {
    startAlmostSolved();
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => tap(newGame(), 0));
    expect(playStore.getSnapshot().phase).not.toBe("solved");
  });

  it("карточка уже показана по таймеру: тап по «New game» работает сразу (перехвата нет)", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(300));
    act(() => {
      newGame().dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act(() => tap(newGame()));
    expect(playStore.getSnapshot().phase).not.toBe("solved");
  });

  // PD-95: фокус (a11y) — после ближайшего кадра, не в задаче монтажа карточки (форсированный style+layout).
  const cardEl = () => host.querySelector<HTMLElement>('[data-testid="result-card"]')!;

  it("PD-95: фокус на карточке появляется после кадра, а не синхронно с монтажом", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(240));
    expect(card()).not.toBeNull();
    expect(document.activeElement).not.toBe(cardEl());
    act(() => void vi.advanceTimersByTime(17));
    expect(document.activeElement).toBe(cardEl());
  });

  it("PD-95: тап-прерывание — карточка сразу, фокус на ней после кадра", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(50));
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(cardEl()).not.toBeNull();
    expect(document.activeElement).not.toBe(cardEl());
    act(() => void vi.advanceTimersByTime(17));
    expect(document.activeElement).toBe(cardEl());
  });

  it("PD-95: ghost-click не возвращается — click по «New game» после перевода фокуса (тот же тап) по-прежнему гасится", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(50));
    act(() => void document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => void vi.advanceTimersByTime(40)); // кадр прошёл, фокус уже на карточке
    expect(document.activeElement).toBe(cardEl());
    act(() => tap(newGame()));
    expect(playStore.getSnapshot().phase).toBe("solved");
    expect(card()).not.toBeNull();
  });

  it("PD-95: уход из solved до кадра отменяет отложенный фокус (нет ошибок и кражи фокуса)", () => {
    startAlmostSolved();
    act(() => void vi.advanceTimersByTime(240));
    act(() => playStore.toHub());
    act(() => void vi.advanceTimersByTime(500));
    expect(host.querySelector('[data-testid="result-card"]')).toBeNull();
  });
});
