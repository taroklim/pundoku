// @vitest-environment jsdom
/**
 * PD-144/PD-167, экран Play целиком: шапка партии (лампочка · шестерёнка · «⋯»), меню «⋯» с Fill (и откат Fill через Undo),
 * Ink и «нечего заполнять», раскладка режимов C (строка и слот на режим, шит режима, контекстное меню, чип режима),
 * повторный тап по вкладке Play, фокус после смены экрана, таймер на паузе.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { createPlay, enterDigit, setInkMode } from "./logic";
import type { PlayState } from "./logic";
import { PlayScreen } from "./PlayScreen";
import { playStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const fresh = (): PlayState => createPlay({ mission: MISSION, solution: SOLUTION });

interface Inner {
  snap: Record<string, unknown>;
}
const inner = playStore as unknown as Inner;
let base: Record<string, unknown> = {};
const playing = (play: PlayState, extra: Record<string, unknown> = {}) =>
  (inner.snap = { ...inner.snap, hub: false, restoring: false, phase: "playing", play, selected: 2, notesMode: false, startedOn: new Date(2026, 9, 3, 12), ...extra });

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const render = (props: Parameters<typeof PlayScreen>[0] = {}) => act(() => root.render(<PlayScreen {...props} />));
const openMenu = () => tap(q("more-button")!);
const notesCount = () => playStore.getSnapshot().play!.notes.filter((n) => n !== 0).length;

// Боевой `playStore` при импорте сам запускает `restore()` (общее хранилище в памяти: jsdom без IndexedDB). Дожидаемся
// его ДО первого теста и берём исходный снимок уже после: иначе поздний `restore()` под нагрузкой полного прогона мог
// доехать посреди теста (снять `restoring`, подложить слоты) — изоляция не зависела бы от тайминга.
beforeAll(async () => {
  await vi.waitFor(() => expect(playStore.getSnapshot().restoring).toBe(false));
  await playStore.flushed();
  base = { ...inner.snap };
});

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

describe("шапка партии", () => {
  it("лампочка, шестерёнка и «⋯» — три кнопки; отдельной иконки «Новая сетка» нет", () => {
    playing(fresh());
    render({ onOpenSettings: () => undefined });
    const bar = host.querySelector("header.toolbar")!;
    const names = [...bar.querySelectorAll("button")].map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(3);
    expect(names[1]).toBe("Settings");
    expect(names[2]).toBe("More");
    expect(bar.querySelectorAll("button")).toHaveLength(3);
    expect(bar.querySelector('[data-testid="hint-button"]')).not.toBeNull();
    expect(bar.querySelector('[data-testid="more-button"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="new-puzzle"]')).toBeNull();
    expect(host.querySelector('[data-testid="new-game"]')).toBeNull();
  });

  it("на хабе и на решённой партии «⋯» нет", () => {
    render(); // хаб
    expect(q("more-button")).toBeNull();
    playing(fresh());
    render();
    expect(q("more-button")).not.toBeNull();
    playing({ ...fresh(), solved: true }, { phase: "solved" });
    render();
    expect(q("more-button")).toBeNull();
  });
});

describe("«Fill candidates» из меню", () => {
  it("без подтверждения заполняет заметки и закрывает меню; одна запись undo откатывает всё", () => {
    playing(fresh());
    render();
    expect(notesCount()).toBe(0);
    openMenu();
    const item = q("menu-fill")!;
    expect(item.getAttribute("aria-disabled")).toBe("false");
    tap(item);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(q("more-menu")).toBeNull();
    expect(notesCount()).toBeGreaterThan(0);
    act(() => playStore.undo());
    expect(notesCount()).toBe(0);
  });

  it("повторно, когда заполнять нечего: пункт на месте, aria-disabled, причина «Nothing to fill in», тап — no-op", () => {
    playing(fresh());
    render();
    act(() => playStore.fillCandidates());
    const filled = playStore.getSnapshot().play;
    openMenu();
    const item = q("menu-fill")!;
    expect(item.getAttribute("aria-disabled")).toBe("true");
    expect(q("menu-fill-why")!.textContent).toBe("Nothing to fill in");
    tap(item);
    expect(playStore.getSnapshot().play).toBe(filled); // ни хода, ни записи undo
    expect(q("more-menu")).not.toBeNull();
  });

  it("в Ink пункт остаётся на месте и недоступен с причиной «Not available in Ink»; партия не меняется", () => {
    const ink = setInkMode(fresh(), true);
    playing(ink);
    render();
    openMenu();
    expect(q("menu-fill")).not.toBeNull();
    expect(q("menu-fill")!.getAttribute("aria-disabled")).toBe("true");
    expect(q("menu-fill-why")!.textContent).toBe("Not available in Ink");
    tap(q("menu-fill")!);
    expect(playStore.getSnapshot().play).toBe(ink);
  });
});

describe("PD-167: режимы на хабе — строка на режим, слот на режим", () => {
  it("партия ушла на хаб — строка «Classic» показывает статус, таймер на паузе; тап по строке возвращает на ту же доску", () => {
    const play = enterDigit(fresh(), 2, 4, 100);
    playing(play);
    render();
    act(() => playStore.reselect());
    expect(q("hub-scroll")).not.toBeNull();
    expect(q("hub-continue")).toBeNull(); // «Продолжить» — только день
    expect(q("mode-status-classic")!.textContent).toMatch(/^In progress · Medium · 50 cells left · \d+:\d\d$/);
    expect(q("mode-desc-ink")).not.toBeNull();
    const t0 = playStore.getElapsedMs();
    act(() => void vi.advanceTimersByTime(5000));
    expect(playStore.getElapsedMs()).toBe(t0);
    tap(q("mode-classic")!);
    expect(q("hub-scroll")).toBeNull();
    expect(q("mode-sheet")).toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);
  });

  it("режим без игры — шит режима (описание, сложность, «Start»); Cancel — хаб без изменений", () => {
    render();
    tap(q("mode-ink")!);
    const sheet = q("mode-sheet")!;
    expect(sheet.getAttribute("data-mode")).toBe("ink");
    expect(q("mode-desc")!.textContent).toBe("Every digit is final: no undo and no eraser for digits. A wrong one leaves a blot.");
    expect(q("discard-note")).toBeNull();
    expect(q("sheet-start")!.textContent).toBe("Start");
    expect(sheet.querySelectorAll('[role="radio"]')).toHaveLength(5);
    expect(q("difficulty-medium")!.getAttribute("aria-checked")).toBe("true");
    tap(q("difficulty-hard")!);
    expect(q("difficulty-hard")!.getAttribute("aria-checked")).toBe("true");
    tap(q("sheet-cancel")!);
    expect(q("mode-sheet")).toBeNull();
    expect(playStore.getSnapshot().hub).toBe(true);
    expect(playStore.pickFor("ink")).toBe("hard"); // выбор запомнен для следующего открытия
    expect(document.activeElement).toBe(q("mode-ink"));
  });

  it("две незавершённые (Classic + Ink): обе строки со статусом; переход между ними паркует, а не выбрасывает", () => {
    vi.stubGlobal("Worker", class { onmessage = null; onerror = null; postMessage() {} terminate() {} });
    const classic = enterDigit(fresh(), 2, 4, 100);
    playing(classic);
    render();
    act(() => playStore.reselect());
    // новая чернильная сетка с хаба: шит → Start → правило → Play in ink → сетка готова
    tap(q("mode-ink")!);
    tap(q("sheet-start")!);
    tap(q("ink-rule-start")!);
    const gen = playStore as unknown as { requestId: number; onGenerated(id: number, r: unknown): void };
    act(() => gen.onGenerated(gen.requestId, { id: gen.requestId, ok: true, puzzle: { mission: MISSION, solution: SOLUTION, difficulty: "medium", seed: "t" } }));
    expect(playStore.getSnapshot()).toMatchObject({ mode: "ink", hub: false });
    expect(playStore.getSnapshot().play!.ink).toBe(true);
    act(() => playStore.reselect());
    expect(q("mode-status-classic")).not.toBeNull();
    expect(q("mode-status-ink")!.textContent).toContain("In progress · Medium · 51 cells left");
    tap(q("mode-classic")!);
    expect(playStore.getSnapshot().play).toEqual(classic);
    expect(playStore.getSnapshot().mode).toBe("classic");
    expect(q("mode-chip")).toBeNull(); // Классика — без чипа
    act(() => playStore.reselect());
    tap(q("mode-ink")!);
    expect(playStore.getSnapshot().mode).toBe("ink");
    expect(q("mode-chip")!.getAttribute("data-mode")).toBe("ink");
    expect(q("mode-chip")!.textContent).toBe("Ink");
  });

  it("контекстное меню «New puzzle…» при незавершённой игре — шит с предупреждением и «Start new»", () => {
    playing(enterDigit(fresh(), 2, 4, 100));
    render();
    act(() => playStore.reselect());
    act(() => void q("mode-classic")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    tap(q("ctx-new")!); // клик без detail — как с клавиатуры (хвост жеста — PlaySetup.test)
    expect(q("mode-sheet")).not.toBeNull();
    expect(q("discard-note")!.textContent).toContain("Your unfinished puzzle (Medium · 50 cells left");
    expect(q("sheet-start")!.textContent).toBe("Start new");
    // PD-175: предупреждение — первым в прокрутке, НАД описанием (при AX3 на 320×568 под описанием оно уходило под
    // прокрутку), и читается экранным диктором вместе с описанием шита.
    const scroll = q("mode-sheet")!.querySelector(".sheet-scroll")!;
    expect(scroll.firstElementChild).toBe(q("discard-note"));
    expect(q("discard-note")!.compareDocumentPosition(q("mode-desc")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const described = q("mode-sheet")!.getAttribute("aria-describedby")!.split(" ");
    expect(described).toEqual([q("discard-note")!.id, q("mode-desc")!.id]);
  });
});

describe("повторный тап по выбранной вкладке Play", () => {
  it("из партии — на хаб без подтверждения, партия остаётся слотом; на хабе — только сигнал (оверлеи закрываются)", () => {
    const play = enterDigit(fresh(), 2, 4, 100);
    playing(play);
    render();
    act(() => playStore.reselect());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(q("hub-scroll")).not.toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);
    const n = playStore.getSnapshot().reselect;
    tap(q("mode-ink")!);
    expect(q("mode-sheet")).not.toBeNull();
    act(() => playStore.reselect()); // уже на хабе
    expect(playStore.getSnapshot().reselect).toBe(n + 1);
    expect(q("mode-sheet")).toBeNull();
  });

  it("открытое меню «⋯» или шит режима поверх партии: повторный тап по вкладке закрывает их и уводит на хаб", () => {
    playing(fresh());
    render();
    openMenu();
    expect(q("more-menu")).not.toBeNull();
    act(() => playStore.reselect());
    expect(q("more-menu")).toBeNull();
    expect(q("hub-scroll")).not.toBeNull();
    tap(q("mode-classic")!); // назад в партию
    openMenu();
    tap(q("menu-new")!);
    expect(q("mode-sheet")).not.toBeNull();
    act(() => playStore.reselect());
    expect(q("mode-sheet")).toBeNull();
    expect(q("hub-scroll")).not.toBeNull();
  });
});

describe("фокус при смене экрана", () => {
  it("после возврата на хаб из партии фокус на заголовке вкладки, а не на <body>", () => {
    playing(fresh());
    render();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => playStore.reselect());
    expect(document.activeElement).toBe(host.querySelector("h1.title"));
  });
});
