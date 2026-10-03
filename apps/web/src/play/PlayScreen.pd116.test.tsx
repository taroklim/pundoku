// @vitest-environment jsdom
/**
 * Пакет A, экран Play: «New puzzle» вместо select сложности (PD-116b; PD-144: одна кнопка в меню «⋯», без подтверждения,
 * партия встаёт слотом хаба; шит «Отбросить» — только на «Начать» при своей сетке), «Grid full» без счёта неверных (PD-117a),
 * тихие отклики на отказы (PD-117b), счётчики по поставленным цифрам на строке статуса и паде (PD-118),
 * «Watch your solve» после партии Play (PD-116c), состояние восстановления (PD-116a).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ANNOUNCE_DEBOUNCE_MS } from "./controls";
import { HINT_MS } from "./gameStore";
import { createPlay, enterDigit, setInkMode } from "./logic";
import type { PlayState } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const OPEN = [...Array(81).keys()].filter((i) => MISSION[i] === "0");
const WRONG_CELL = OPEN[0]!; // клетка 2, решение 4

const fresh = (): PlayState => createPlay({ mission: MISSION, solution: SOLUTION });
/** Все пустые клетки заполнены верно, кроме `WRONG_CELL` (там неверная 1) — сетка полна, но не решена. */
function fullWithMistake(): PlayState {
  let p = fresh();
  OPEN.forEach((c, k) => {
    p = enterDigit(p, c, c === WRONG_CELL ? 1 : (p.solution[c] as number), (k + 1) * 100);
  });
  expect(p.solved).toBe(false);
  return p;
}
function solved(): PlayState {
  return enterDigit(fullWithMistake(), WRONG_CELL, 4, 99_000);
}

interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
const base = { ...inner.snap };
const setSnap = (patch: Record<string, unknown>) => {
  inner.snap = { ...inner.snap, ...patch };
};
const playing = (play: PlayState, selected: number | null = WRONG_CELL, extra: Record<string, unknown> = {}) =>
  setSnap({ hub: false, restoring: false, phase: "playing", play, selected, notesMode: false, startedOn: new Date(2026, 9, 2, 12), ...extra });

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(sel: string) => host.querySelector<T>(sel);
const live = () => q('[role="status"].sr-only')!.textContent;
const statusLine = () => { const el = q('[data-testid="status-line"]')!; return (el.querySelector(".st-long") ?? el).textContent; };
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const render = () => act(() => root.render(<PlayScreen />));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  inner.snap = { ...base };
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const openMenu = () => tap(q('[data-testid="more-button"]')!);
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const inDialog = (label: string) => [...dialog()!.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("PD-116b / PD-144: «New puzzle» — один пункт меню «⋯», нативного select нет", () => {
  it("в шапке партии нет select и отдельной кнопки «New puzzle»; «⋯» — кнопка меню с именем «More»", () => {
    playing(fresh());
    render();
    expect(q("select")).toBeNull();
    expect(q('[data-testid="new-puzzle"]')).toBeNull();
    const more = q('[data-testid="more-button"]')!;
    expect(more.getAttribute("aria-label")).toBe("More");
    expect(more.getAttribute("aria-haspopup")).toBe("menu");
    expect(more.getAttribute("aria-expanded")).toBe("false");
  });

  it("пункт меню «New puzzle» ведёт на хаб БЕЗ подтверждения, даже с ходами; партия встаёт слотом «Продолжить»", () => {
    const play = enterDigit(fresh(), WRONG_CELL, 4, 100);
    playing(play);
    render();
    openMenu();
    expect(q('[data-testid="more-button"]')!.getAttribute("aria-expanded")).toBe("true");
    const item = document.querySelector<HTMLElement>('[data-testid="menu-new"]')!;
    expect(item.textContent).toBe("New puzzle");
    tap(item);
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().hub).toBe(true);
    expect(playStore.getSnapshot().play).toBe(play); // не выброшена
    expect(q('[data-testid="hub-scroll"]')).not.toBeNull();
    expect(q('[data-testid="continue-own"]')).not.toBeNull();
    expect(q('[data-testid="more-button"]')).toBeNull(); // на хабе «⋯» нет
  });

  it("«Начать» при своей сетке в слоте — шит «Discard this puzzle?»; «Keep playing» и Esc закрывают его, слот цел", () => {
    const play = enterDigit(fresh(), WRONG_CELL, 4, 100);
    playing(play);
    render();
    openMenu();
    tap(document.querySelector('[data-testid="menu-new"]')!);
    tap(q('[data-testid="setup-start"]')!);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.textContent).toContain("Discard this puzzle?");
    expect([...dialog()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Discard", "Keep playing"]);
    tap(inDialog("Keep playing"));
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);

    tap(q('[data-testid="setup-start"]')!);
    expect(dialog()).not.toBeNull();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);
    expect(playStore.getSnapshot().hub).toBe(true);
  });

  it("«Discard» — прежняя партия отброшена, запущена новая; без своей сетки «Начать» не спрашивает ничего", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    playing(enterDigit(fresh(), WRONG_CELL, 4, 100), WRONG_CELL, { hub: true });
    render();
    tap(q('[data-testid="setup-start"]')!);
    tap(inDialog("Discard"));
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().play).toBeNull();
    expect(playStore.getSnapshot().hub).toBe(false);
    expect(playStore.getSnapshot().phase).toBe("loading");

    // нет своей сетки: «Начать» сразу запускает
    setSnap({ hub: true, phase: "loading", play: null });
    render();
    tap(q('[data-testid="setup-start"]')!);
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().hub).toBe(false);
  });

  it("цифра с клавиатуры при открытом меню не попадает в клетку", () => {
    playing(enterDigit(fresh(), WRONG_CELL, 4, 100), 3);
    render();
    openMenu();
    const item = document.querySelector('[data-testid="menu-new"]')!;
    act(() => void item.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit6", key: "6", bubbles: true })));
    expect(playStore.getSnapshot().play!.values[3]).toBe(0);
  });

  it("после решения: на карточке одна «New puzzle» (вторичная), шапка без «⋯»; тап ведёт на хаб без подтверждения", () => {
    playing(solved(), null, { phase: "solved" });
    render();
    wait(300);
    expect(q('[data-testid="more-button"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="new-puzzle"]')).toHaveLength(1);
    tap(q('[data-testid="new-puzzle"]')!);
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().hub).toBe(true);
    expect(playStore.hasSlot()).toBe(false); // решённая партия слотом не становится
    expect(q('[data-testid="hub-scroll"]')).not.toBeNull();
  });

  it("восстановление: пока партия читается, нет ни хаба, ни «⋯»", () => {
    setSnap({ hub: true, restoring: true, phase: "loading", play: null });
    render();
    expect(q('[data-testid="hub-scroll"]')).toBeNull();
    expect(q('[data-testid="more-button"]')).toBeNull();
    setSnap({ restoring: false });
    act(() => playStore.setDifficulty("hard")); // перерисовать
    expect(q('[data-testid="hub-scroll"]')).not.toBeNull();
  });
});

describe("PD-117a: полная сетка с ошибкой", () => {
  it("строка статуса — «Grid full — something doesn’t match», без числа и без «0 cells left»", () => {
    playing(fullWithMistake());
    render();
    expect(statusLine()).toBe("Grid full — something doesn’t match");
    expect(statusLine()).not.toMatch(/\d/);
  });

  it("то же в uk и ru", async () => {
    playing(fullWithMistake());
    await i18n.changeLanguage("uk");
    render();
    expect(statusLine()).toBe("Сітка заповнена — десь є розбіжність");
    await act(() => i18n.changeLanguage("ru"));
    expect(statusLine()).toBe("Сетка заполнена — где-то есть несовпадение");
  });

  it("озвучивается один раз после debounce (aria-live), а не «0 cells left»", () => {
    playing(fullWithMistake());
    render();
    expect(live()).toBe("");
    wait(ANNOUNCE_DEBOUNCE_MS);
    expect(live()).toBe("Grid full — something doesn’t match");
  });

  it("не полная сетка — обычное «N cells left» по поставленным цифрам", () => {
    playing(enterDigit(fresh(), WRONG_CELL, 1, 100)); // неверная цифра всё равно уменьшает счёт
    render();
    expect(statusLine()).toBe(`${OPEN.length - 1} cells left`);
  });
});

describe("PD-118: счётчики по поставленным цифрам", () => {
  const keyLabel = (d: number) => q<HTMLElement>(`.pad .key:nth-child(${d})`)!.getAttribute("aria-label");

  it("неверная цифра уменьшает остаток у ЭТОЙ цифры и не выдаёт верную (нет оракула)", () => {
    const left1 = 9 - [...MISSION].filter((c) => c === "1").length;
    const left4 = 9 - [...MISSION].filter((c) => c === "4").length;
    playing(enterDigit(fresh(), WRONG_CELL, 1, 100));
    render();
    expect(keyLabel(1)).toBe(`Enter 1, ${left1 - 1} left`);
    expect(keyLabel(4)).toBe(`Enter 4, ${left4} left`); // решение клетки (4) счётчиком не выдано
  });

  it("порог озвучки (последние 5) считается по доске: пять неверных цифр до конца — «5 cells left»", () => {
    let p = fresh();
    for (const c of OPEN.slice(0, -5)) p = enterDigit(p, c, c === WRONG_CELL ? 1 : (p.solution[c] as number), 10);
    playing(p);
    render();
    expect(statusLine()).toBe("5 cells left");
    wait(ANNOUNCE_DEBOUNCE_MS);
    expect(live()).toBe("5 cells left");
  });
});

describe("PD-117b: тихий отклик на отказ", () => {
  it("цифра без выбранной клетки: в строке статуса «Pick an empty cell first», затем возвращается счёт", () => {
    playing(fresh(), null);
    render();
    act(() => playStore.input(4));
    expect(statusLine()).toBe("Pick an empty cell first");
    wait(100);
    expect(live()).toBe("Pick an empty cell first");
    wait(HINT_MS);
    expect(statusLine()).toBe(`${OPEN.length} cells left`);
    expect(live()).toBe("");
  });

  it("заметка в занятую клетку и цифра в чернильную клетку — свои фразы", () => {
    playing(enterDigit(fresh(), WRONG_CELL, 4, 100));
    render();
    act(() => playStore.toggleNotesMode());
    act(() => playStore.input(5));
    expect(statusLine()).toBe("Notes go in empty cells only");
    const ink = enterDigit(setInkMode(fresh(), true), WRONG_CELL, 4, 100);
    playing(ink, WRONG_CELL, { hint: null });
    act(() => playStore.input(7));
    expect(statusLine()).toBe("This cell is filled — ink doesn’t lift");
  });

  it("отклик ничего не блокирует: модалки нет, ввод работает сразу", () => {
    playing(fresh(), null);
    render();
    act(() => playStore.input(4));
    expect(q('[role="dialog"]')).toBeNull();
    act(() => playStore.select(WRONG_CELL));
    act(() => playStore.input(4));
    expect(playStore.getSnapshot().play!.values[WRONG_CELL]).toBe(4);
  });
});

describe("PD-116c: «Watch your solve» после партии Play", () => {
  it("на карточке решённой партии Play есть вход в Таймлапс (ходы сыграны, лог цельный)", () => {
    playing(solved(), null, { phase: "solved" });
    render();
    wait(300);
    expect(q('[data-testid="new-puzzle"]')).not.toBeNull(); // карточка показана
    expect(q('[data-testid="tl-watch"]')).not.toBeNull();
    expect(q('[data-testid="tl-nolog"]')).toBeNull();
  });
});
