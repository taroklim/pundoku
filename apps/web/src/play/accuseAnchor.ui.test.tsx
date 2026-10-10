// @vitest-environment jsdom
/**
 * PD-291: клавиша A и «⋯ → Обвинить» открывают меню обвинения без элемента клетки (`openAccuse(cell, null)`). Клетка должна
 * находиться на экране Play, а не первой доской документа: в приложении раньше Play в DOM стоит панель Today (её поле или
 * Grid ∞ решённого дня) — скрытая, но со своими координатами. Раньше меню вставало по клетке Today (на телефоне — за нижний
 * край), а фокус после Esc уходил на <body> (возврат на скрытую клетку не срабатывал).
 *
 * Здесь «чужая» доска — копия поля перед экраном Play с другими координатами; меню обязано встать по клетке Play,
 * а Esc вернуть фокус на неё же.
 */
import type { LiarPuzzle } from "@pundoku/engine";
import { dailyLiarPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { createLiarPlay } from "./liar";
import type { PlayState } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let P: LiarPuzzle;
const inner = playStore as unknown as { snap: Record<string, unknown> };
let base: Record<string, unknown> = {};

beforeAll(async () => {
  P = dailyLiarPuzzle("2026-10-05", "medium");
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

const real = (): PlayState =>
  createLiarPlay({ mission: P.mission, solution: P.solution, honestMission: P.honestMission, liarCell: P.liarCell, liarDigit: P.liarDigit, trueDigit: P.trueDigit });
const givens = (s: PlayState) => s.mission.flatMap((g, i) => (g !== 0 ? [i] : []));

let host: HTMLDivElement;
let decoy: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 })));
const pointer = (el: Element, type: string) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: 10, clientY: 10, button: 0 }), { pointerId: 1 })));
const playCell = (i: number) => host.querySelector<HTMLElement>(`.board [data-i="${i}"]`)!;
const esc = () => act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

/** Клетки чужой доски «ниже экрана» (как поле Today под решённым днём), клетки Play — в верхней части. */
const rectOf = (el: Element): DOMRect => {
  // Копия клетки (position: fixed) стоит там, куда её поставил стиль: у затемнения нет transform-предка, начало отсчёта fixed —
  // окно. Без этого `fixedOrigin` (PD-290, сведение десктопа C) брал бы для копии прямоугольник «клетки 0» и сдвигал её.
  if (el instanceof HTMLElement && el.classList.contains("ctx-lift")) {
    const left = parseFloat(el.style.left) || 0;
    const top = parseFloat(el.style.top) || 0;
    const width = parseFloat(el.style.width) || 0;
    const height = parseFloat(el.style.height) || 0;
    return { top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON() {} } as DOMRect;
  }
  const i = Number((el as HTMLElement).dataset?.i ?? -1);
  const top = el.closest("#decoy") ? 2000 : 100 + Math.floor(Math.max(i, 0) / 9) * 40;
  const left = 10 + (Math.max(i, 0) % 9) * 40;
  return { top, bottom: top + 39, left, right: left + 39, width: 39, height: 39, x: left, y: top, toJSON() {} } as DOMRect;
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return rectOf(this);
  });
  inner.snap = { ...base };
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
  // Чужая доска — РАНЬШЕ экрана Play в документе (как панель Today в стопке вкладок).
  decoy = document.createElement("div");
  decoy.id = "decoy";
  decoy.innerHTML = `<div class="board">${Array.from({ length: 81 }, (_, i) => `<button type="button" class="cell" data-i="${i}"></button>`).join("")}</div>`;
  decoy.style.visibility = "hidden";
  document.body.append(decoy);
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  decoy.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openGame = (cell: number) => {
  inner.snap = {
    ...inner.snap,
    hub: false,
    restoring: false,
    phase: "playing",
    mode: "liar",
    difficulty: "medium",
    daily: null,
    play: real(),
    selected: cell,
    notesMode: false,
    startedOn: new Date(2026, 9, 5, 12),
  };
  act(() => root.render(<PlayScreen />));
};

/** Копия клетки над затемнением стоит на клетке Play, а не на чужой доске. */
const expectLiftOnPlayCell = (cell: number) => {
  const lift = document.querySelector<HTMLElement>(".liar-lift")!;
  const r = rectOf(playCell(cell));
  expect(lift.style.top).toBe(`${r.top}px`);
  expect(lift.style.left).toBe(`${r.left}px`);
};

describe("PD-291: меню обвинения без элемента клетки — по клетке экрана Play", () => {
  it("клавиша A: меню у клетки Play; Esc возвращает фокус на эту клетку, не на <body>", () => {
    const y = givens(real()).find((g) => g !== P.liarCell)!;
    openGame(y);
    act(() => void host.querySelector(".play")!.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA", key: "a", bubbles: true })));
    expect(q("accuse-menu")).not.toBeNull();
    expectLiftOnPlayCell(y);
    act(() => void vi.advanceTimersByTime(50));
    expect(document.activeElement).toBe(q("accuse-confirm"));
    esc();
    expect(q("accuse-menu")).toBeNull();
    expect(document.activeElement).toBe(playCell(y));
    expect(decoy.contains(document.activeElement)).toBe(false);
  });

  it("«⋯ → Обвинить»: то же — меню у клетки Play, Esc возвращает фокус на клетку", () => {
    const y = givens(real()).find((g) => g !== P.liarCell)!;
    openGame(y);
    tap(q("more-button")!);
    pointer(q("menu-accuse")!, "pointerdown");
    tap(q("menu-accuse")!);
    expect(q("accuse-menu")).not.toBeNull();
    expectLiftOnPlayCell(y);
    act(() => void vi.advanceTimersByTime(50));
    esc();
    expect(q("accuse-menu")).toBeNull();
    expect(document.activeElement).toBe(playCell(y));
  });
});
