// @vitest-environment jsdom
/**
 * PD-167 (раскладка C): хаб Play. «Продолжить» — ТОЛЬКО день; список «Режимы» — строка на каждый готовый режим реестра
 * (значок, имя, описание; при незавершённой игре — статус «In progress · …» вместо описания), тап → `onOpenMode`,
 * долгое нажатие / правая кнопка → контекстное меню (описание, «Continue», «New puzzle…»), сноска про год, без закреплённой
 * «Начать» и без списка сложностей на хабе; повторный тап по вкладке закрывает меню и прокручивает хаб наверх.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { LONG_PRESS_MS } from "./controls";
import type { SlotSummary } from "./daySlot";
import type { ModeDef } from "./modes";
import { MODES, availableModes } from "./modes";
import { PlaySetup } from "./PlaySetup";
import type { PlaySetupProps } from "./PlaySetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Слот дня — отдельный источник; здесь он задаётся напрямую (его сборка из стора/хранилища проверена в daySlot.test.tsx).
let daySlot: SlotSummary | null = null;
vi.mock("./daySlot", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useDaySlot: () => daySlot }));

const DAY: SlotSummary = { difficulty: "hard", left: 41, elapsedMs: 5 * 60_000 + 3_000, ink: false };
const CLASSIC: SlotSummary = { difficulty: "medium", left: 31, elapsedMs: 8 * 60_000 + 40_000, ink: false };
const INK: SlotSummary = { difficulty: "hard", left: 47, elapsedMs: 3 * 60_000 + 18_000, ink: true };

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const click = (el: Element, detail = 1) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
const pointer = (el: Element, type: string, x = 10, y = 10) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }), { pointerId: 1 })));

const fns = { onOpenMode: vi.fn(), onNewInMode: vi.fn(), onOpenToday: vi.fn() };
const props = (over: Partial<PlaySetupProps> = {}): PlaySetupProps => ({ modes: availableModes(), slots: {}, reselect: 0, ...fns, ...over });
const render = (over: Partial<PlaySetupProps> = {}) => act(() => root.render(<PlaySetup {...props(over)} />));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  daySlot = null;
  for (const f of Object.values(fns)) f.mockReset();
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("«Продолжить» — только день", () => {
  it("нет дня — секции нет; хаб начинается с «Modes»", () => {
    render({ slots: { classic: CLASSIC } });
    expect(q("hub-continue")).toBeNull();
    expect(host.querySelector(".hub-head")!.textContent).toBe("Modes");
  });

  it("день есть: одна строка «Today’s puzzle · Hard · 41 cells left · 5:03», тап → onOpenToday; игр режимов в «Продолжить» нет", () => {
    daySlot = DAY;
    render({ slots: { classic: CLASSIC, ink: INK } });
    const sec = q("hub-continue")!;
    expect(sec.querySelectorAll("button")).toHaveLength(1);
    expect(q("continue-day")!.textContent).toContain("Today’s puzzle");
    expect(q("continue-day")!.textContent).toContain("Hard · 41 cells left · 5:03");
    click(q("continue-day")!);
    expect(fns.onOpenToday).toHaveBeenCalledTimes(1);
    expect(fns.onOpenMode).not.toHaveBeenCalled();
  });
});

describe("список «Режимы»", () => {
  it("строка на каждый готовый режим в порядке реестра; неготовые не показываются вовсе", () => {
    const fake: ModeDef = { ...MODES[0]!, id: "ink", ready: false };
    render({ modes: availableModes([MODES[0]!, fake]) });
    const rows = [...host.querySelectorAll('[data-testid^="mode-"].hub-row')];
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual(["mode-classic"]);
    render();
    const all = [...host.querySelectorAll(".hub-row.mode")].map((r) => r.getAttribute("data-testid"));
    expect(all).toEqual(["mode-classic", "mode-ink"]);
  });

  it("без незавершённой игры — имя и описание режима", () => {
    render();
    expect(q("mode-classic")!.textContent).toContain("Classic");
    expect(q("mode-desc-classic")!.textContent).toBe("Plain sudoku: notes, undo and hints are all there.");
    expect(q("mode-desc-ink")!.textContent).toBe("Every digit is final: no undo and no eraser for digits. A wrong one leaves a blot.");
    expect(q("mode-status-classic")).toBeNull();
  });

  it("незавершённая игра — статус вместо описания: «In progress · Medium · 31 cells left · 8:40»; у режима без игры — описание", () => {
    render({ slots: { classic: CLASSIC } });
    expect(q("mode-desc-classic")).toBeNull();
    expect(q("mode-status-classic")!.textContent).toBe("In progress · Medium · 31 cells left · 8:40");
    expect(q("mode-status-classic")!.querySelector(".dot")!.getAttribute("aria-hidden")).toBe("true");
    expect(q("mode-desc-ink")).not.toBeNull();
    render({ slots: { classic: CLASSIC, ink: INK } });
    expect(q("mode-status-ink")!.textContent).toBe("In progress · Hard · 47 cells left · 3:18");
  });

  it("тап по строке → onOpenMode(режим, строка)", () => {
    render({ slots: { ink: INK } });
    click(q("mode-ink")!);
    expect(fns.onOpenMode).toHaveBeenCalledWith("ink", q("mode-ink"));
    click(q("mode-classic")!);
    expect(fns.onOpenMode).toHaveBeenLastCalledWith("classic", q("mode-classic"));
  });

  it("сноска про год под списком; ни списка сложностей, ни закреплённой «Начать» на хабе", () => {
    render();
    expect(q("hub-foot")!.textContent).toBe("Free games aren’t recorded in your year.");
    expect(q("difficulty-list")).toBeNull();
    expect(host.querySelector(".hub-bar")).toBeNull();
    expect(q("setup-start")).toBeNull();
  });

  it("uk/ru: тексты из локалей", async () => {
    await act(() => i18n.changeLanguage("ru"));
    render({ slots: { ink: INK } });
    expect(host.querySelector(".hub-head")!.textContent).toBe("Режимы");
    expect(q("mode-status-ink")!.textContent).toBe("Не закончена · Сложно · осталось 47 · 3:18");
    await act(() => i18n.changeLanguage("uk"));
    expect(q("mode-desc-classic")!.textContent).toBe("Звичайне судоку: нотатки, скасування й підказки на місці.");
  });
});

describe("контекстное меню строки (долгое нажатие)", () => {
  it("долгое нажатие открывает меню: заголовок — описание; «Continue» только при незавершённой игре; тап-хвост жеста не нажимает", () => {
    render({ slots: { classic: CLASSIC } });
    const row = q("mode-classic")!;
    pointer(row, "pointerdown");
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(q("ctx-menu")).not.toBeNull();
    expect(q("ctx-desc")!.textContent).toBe("Plain sudoku: notes, undo and hints are all there.");
    expect(q("ctx-continue")).not.toBeNull();
    // поднятая копия строки — в разметке строки (`.hub-row.mode`), иначе в портале она теряет стили
    expect(q("ctx-preview")!.matches(".ctx-lift > .hub-row.mode")).toBe(true);
    expect(q("ctx-preview")!.textContent).toContain("Classic");
    // хвост жеста: отпускание над строкой и над пунктом меню ничего не делает
    pointer(row, "pointerup");
    click(row);
    expect(fns.onOpenMode).not.toHaveBeenCalled();
    click(q("ctx-new")!);
    expect(fns.onNewInMode).not.toHaveBeenCalled();
    expect(q("ctx-menu")).not.toBeNull();
    // новое нажатие внутри меню — пункт работает
    pointer(q("ctx-new")!, "pointerdown");
    click(q("ctx-new")!);
    expect(fns.onNewInMode).toHaveBeenCalledWith("classic", row);
    expect(q("ctx-menu")).toBeNull();
  });

  it("у режима без игры в меню только «New puzzle…»; «Continue» с клавиатуры (detail 0) открывает игру", () => {
    render({ slots: { classic: CLASSIC } });
    act(() => void q("mode-ink")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(q("ctx-continue")).toBeNull();
    expect(q("ctx-new")).not.toBeNull();
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("ctx-menu")).toBeNull();
    act(() => void q("mode-classic")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    click(q("ctx-continue")!, 0);
    expect(fns.onOpenMode).toHaveBeenCalledWith("classic", q("mode-classic"));
  });

  it("сдвиг пальца (прокрутка) отменяет долгое нажатие; короткий тап меню не открывает", () => {
    render();
    const row = q("mode-classic")!;
    pointer(row, "pointerdown", 10, 10);
    pointer(row, "pointermove", 10, 40);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS * 2));
    expect(q("ctx-menu")).toBeNull();
    pointer(row, "pointerdown");
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS - 100));
    pointer(row, "pointerup");
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(q("ctx-menu")).toBeNull();
  });

  it("Esc закрывает меню и возвращает фокус на строку", () => {
    render();
    act(() => void q("mode-ink")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(document.activeElement).toBe(q("ctx-new"));
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.activeElement).toBe(q("mode-ink"));
  });
});

describe("повторный тап по вкладке Play (reselect)", () => {
  it("закрывает контекстное меню; хаб прокручивается наверх; без изменения счётчика ничего не закрывается", () => {
    render();
    const scroller = q("hub-scroll")!;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as never;
    act(() => void q("mode-ink")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    render({ reselect: 0 });
    expect(q("ctx-menu")).not.toBeNull();
    render({ reselect: 1 });
    expect(q("ctx-menu")).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
  });
});
