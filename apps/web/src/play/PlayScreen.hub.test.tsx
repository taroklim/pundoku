// @vitest-environment jsdom
/**
 * PD-144, экран Play целиком: шапка партии (лампочка · шестерёнка · «⋯», отдельной «Новая сетка» нет), меню «⋯» с Fill
 * (и откат Fill через Undo), Ink и «нечего заполнять», слот своей сетки при уходе на хаб и возврате, повторный тап по вкладке
 * Play, фокус после смены экрана, таймер на паузе, решённая партия.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
const base = { ...inner.snap };
const playing = (play: PlayState, extra: Record<string, unknown> = {}) =>
  (inner.snap = { ...inner.snap, hub: false, restoring: false, phase: "playing", play, selected: 2, notesMode: false, startedOn: new Date(2026, 9, 3, 12), ...extra });

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const render = (props: Parameters<typeof PlayScreen>[0] = {}) => act(() => root.render(<PlayScreen {...props} />));
const openMenu = () => tap(q("more-button")!);
const notesCount = () => playStore.getSnapshot().play!.notes.filter((n) => n !== 0).length;

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

describe("слот своей сетки: хаб и возврат", () => {
  it("«New puzzle» из меню: партия встаёт слотом «Продолжить» (подпись из партии), таймер на паузе; тап по слоту возвращает на доску", () => {
    const play = enterDigit(fresh(), 2, 4, 100);
    playing(play);
    render();
    openMenu();
    tap(q("menu-new")!);
    expect(q("hub-scroll")).not.toBeNull();
    expect(q("continue-own")!.textContent).toContain("Medium · 50 cells left");
    // таймер на хабе не идёт
    const t0 = playStore.getElapsedMs();
    act(() => void vi.advanceTimersByTime(5000));
    expect(playStore.getElapsedMs()).toBe(t0);
    tap(q("continue-own")!);
    expect(q("hub-scroll")).toBeNull();
    expect(q("board") ?? host.querySelector(".board")).not.toBeNull();
    expect(playStore.getSnapshot().play).toBe(play);
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
    tap(q("mode-row")!);
    expect(q("mode-sheet")).not.toBeNull();
    act(() => playStore.reselect()); // уже на хабе
    expect(playStore.getSnapshot().reselect).toBe(n + 1);
    expect(q("mode-sheet")).toBeNull();
  });

  it("открытое меню «⋯»: повторный тап по вкладке закрывает меню и уводит на хаб", () => {
    playing(fresh());
    render();
    openMenu();
    expect(q("more-menu")).not.toBeNull();
    act(() => playStore.reselect());
    expect(q("more-menu")).toBeNull();
    expect(q("hub-scroll")).not.toBeNull();
  });
});

describe("фокус при смене экрана", () => {
  it("после «New puzzle» из меню фокус на заголовке вкладки, а не на <body>", () => {
    playing(fresh());
    render();
    openMenu();
    tap(q("menu-new")!);
    expect(document.activeElement).toBe(host.querySelector("h1.title"));
  });
});
