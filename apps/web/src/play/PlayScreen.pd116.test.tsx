// @vitest-environment jsdom
/**
 * Пакет A, экран Play: «New puzzle» вместо select сложности (PD-116b; PD-144: одна кнопка в меню «⋯»; PD-167: она открывает
 * шит режима партии с предупреждением об отбрасывании), «Grid full» без счёта неверных (PD-117a),
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
  (playStore as unknown as { saved: Map<string, unknown> }).saved.clear();
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

  it("PD-167: пункт «New puzzle» открывает шит ТЕКУЩЕГО режима поверх партии с предупреждением; «Cancel» и Esc — партия цела", () => {
    const play = enterDigit(fresh(), WRONG_CELL, 4, 100);
    playing(play);
    render();
    openMenu();
    expect(q('[data-testid="more-button"]')!.getAttribute("aria-expanded")).toBe("true");
    const item = document.querySelector<HTMLElement>('[data-testid="menu-new"]')!;
    expect(item.textContent).toBe("New puzzle");
    tap(item);
    const sheet = document.querySelector<HTMLElement>('[data-testid="mode-sheet"]')!;
    expect(sheet.getAttribute("data-mode")).toBe("classic");
    expect(sheet.querySelector('[data-testid="discard-note"]')!.textContent).toMatch(/^Your unfinished puzzle \(Medium · 50 cells left · \d+:\d\d\) will be discarded\.$/);
    expect(sheet.querySelector('[data-testid="sheet-start"]')!.textContent).toBe("Start new");
    expect(playStore.getSnapshot().hub).toBe(false); // под шитом — партия, не хаб
    tap(sheet.querySelector('[data-testid="sheet-cancel"]')!);
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);
    expect(playStore.getSnapshot().hub).toBe(false);

    openMenu();
    tap(document.querySelector('[data-testid="menu-new"]')!);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);
  });

  it("«Start new» — партия режима отброшена, запущена новая с выбранной в шите сложностью", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    playing(enterDigit(fresh(), WRONG_CELL, 4, 100));
    render();
    openMenu();
    tap(document.querySelector('[data-testid="menu-new"]')!);
    tap(document.querySelector('[data-testid="difficulty-expert"]')!);
    tap(document.querySelector('[data-testid="sheet-start"]')!);
    expect(dialog()).toBeNull();
    expect(playStore.getSnapshot()).toMatchObject({ play: null, hub: false, phase: "loading", mode: "classic", difficulty: "expert" });
    expect(playStore.slots().classic).toBeUndefined();
  });

  it("Ink: «New puzzle» → шит Чернил; «Start new» → правило PD-74 ПОСЛЕ шита (не поверх); «Play in ink» запускает чернильную", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    playing(enterDigit(setInkMode(fresh(), true), WRONG_CELL, 4, 100), WRONG_CELL, { mode: "ink" });
    render();
    openMenu();
    tap(document.querySelector('[data-testid="menu-new"]')!);
    expect(document.querySelector('[data-testid="mode-sheet"]')!.getAttribute("data-mode")).toBe("ink");
    tap(document.querySelector('[data-testid="sheet-start"]')!);
    expect(document.querySelector('[data-testid="mode-sheet"]')).toBeNull();
    expect(document.querySelector('[data-testid="ink-sheet"]')).not.toBeNull();
    expect(playStore.getSnapshot().play).not.toBeNull(); // до «Play in ink» ничего не отброшено
    tap(document.querySelector('[data-testid="ink-rule-start"]')!);
    expect(document.querySelector('[data-testid="ink-sheet"]')).toBeNull();
    expect(playStore.getSnapshot()).toMatchObject({ play: null, mode: "ink", phase: "loading" });
  });

  it("цифра с клавиатуры при открытом меню не попадает в клетку", () => {
    playing(enterDigit(fresh(), WRONG_CELL, 4, 100), 3);
    render();
    openMenu();
    const item = document.querySelector('[data-testid="menu-new"]')!;
    act(() => void item.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit6", key: "6", bubbles: true })));
    expect(playStore.getSnapshot().play!.values[3]).toBe(0);
  });

  it("после решения: на карточке одна «New puzzle» (вторичная), шапка без «⋯»; тап — шит режима БЕЗ предупреждения, Cancel — карточка", () => {
    playing(solved(), null, { phase: "solved" });
    render();
    wait(300);
    expect(q('[data-testid="more-button"]')).toBeNull();
    expect(host.querySelectorAll('[data-testid="new-puzzle"]')).toHaveLength(1);
    tap(q('[data-testid="new-puzzle"]')!);
    expect(document.querySelector('[data-testid="mode-sheet"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="discard-note"]')).toBeNull(); // решённая — не незавершённая
    expect(document.querySelector('[data-testid="sheet-start"]')!.textContent).toBe("Start");
    expect(playStore.hasSlot()).toBe(false);
    tap(document.querySelector('[data-testid="sheet-cancel"]')!);
    expect(dialog()).toBeNull();
    expect(q('[data-testid="new-puzzle"]')).not.toBeNull();
  });

  it("восстановление: пока слоты читаются, нет ни хаба, ни «⋯»", () => {
    setSnap({ hub: true, restoring: true, phase: "loading", play: null });
    render();
    expect(q('[data-testid="hub-scroll"]')).toBeNull();
    expect(q('[data-testid="more-button"]')).toBeNull();
    setSnap({ restoring: false });
    act(() => playStore.setPick("classic", "hard")); // перерисовать
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

describe("PD-144 D-1: классы резерва под док на экране партии (play.css: --extra у .play-hintable, строка статуса у .play-docked)", () => {
  const cls = () => q(".play")!.className.split(/\s+/);

  it("обычная партия: play-fit + play-hintable, без play-docked; с открытым доком добавляется play-docked, резерв остаётся", () => {
    playing(fresh());
    render();
    expect(cls()).toEqual(expect.arrayContaining(["play-fit", "play-hintable"]));
    expect(cls()).not.toContain("play-docked");
    tap(q('[data-testid="hint-button"]')!);
    const go = q('[data-testid="hint-rule-go"]') ?? document.querySelector<HTMLElement>('[data-testid="hint-rule-go"]');
    if (go) tap(go);
    expect(q('[data-testid="hint-dock"]')).not.toBeNull();
    expect(cls()).toEqual(expect.arrayContaining(["play-fit", "play-hintable", "play-docked"]));
    tap(q('[data-testid="hint-close"]')!);
    expect(cls()).toContain("play-hintable");
    expect(cls()).not.toContain("play-docked");
  });

  it("Ink: лампочки нет — резерва нет (поле прежнее), класса play-hintable нет", () => {
    playing(setInkMode(fresh(), true), WRONG_CELL, { hint: null });
    render();
    expect(q('[data-testid="hint-button"]')).toBeNull();
    expect(cls()).toContain("play-fit");
    expect(cls()).not.toContain("play-hintable");
  });

  it("хаб: ни play-fit, ни резерва", () => {
    setSnap({ hub: true, restoring: false });
    render();
    expect(cls()).toContain("play-hub");
    expect(cls()).not.toContain("play-hintable");
    expect(cls()).not.toContain("play-fit");
  });
});
