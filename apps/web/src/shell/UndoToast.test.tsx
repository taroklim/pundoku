// @vitest-environment jsdom
/**
 * PD-225 (design/pd224-swipe-gestures.md §A7.1): тост «Сетка удалена · Отменить». 6 с, пауза пока палец на тосте или фокус
 * внутри; путь клавиатуры/VoiceOver — фокус сразу на «Отменить», по таймеру не гаснет, ушёл фокус — 6 с заново. Текст — в
 * живом регионе (polite). Новый тост заменяет прежний (таймер заново). Уход — прозрачностью, потом из DOM.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UndoToastProps } from "./UndoToast";
import { UNDO_TOAST_MS, UndoToast } from "./UndoToast";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const fire = (el: Element, type: string, init: MouseEventInit = {}) => act(() => void el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init })));
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

let onAction: ReturnType<typeof vi.fn<(hadFocus: boolean) => void>>;
let onExpire: ReturnType<typeof vi.fn<() => void>>;
const show = (toast: UndoToastProps["toast"], announce: UndoToastProps["announce"] = null) =>
  act(() => root.render(<UndoToast toast={toast} announce={announce} actionLabel="Undo" onAction={onAction} onExpire={onExpire} />));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
  onAction = vi.fn();
  onExpire = vi.fn();
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

describe("UndoToast", () => {
  it("показывает текст и «Undo» (цель ≥ 44); через 6 с — onExpire ровно один раз, не раньше", () => {
    show({ id: 1, text: "Liar puzzle deleted", focus: false });
    expect(q("undo-toast")!.textContent).toContain("Liar puzzle deleted");
    expect(q("undo-toast-action")!.textContent).toBe("Undo");
    expect(UNDO_TOAST_MS).toBe(6000);
    wait(5999);
    expect(onExpire).not.toHaveBeenCalled();
    wait(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    wait(10_000);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("«Undo» — onAction; таймер после этого не срабатывает", () => {
    show({ id: 1, text: "Liar puzzle deleted", focus: false });
    fire(q("undo-toast-action")!, "click", { detail: 1 });
    expect(onAction).toHaveBeenCalledTimes(1);
    show(null);
    wait(7000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("палец на тосте — пауза; отпустили — отсчёт продолжается с остатка", () => {
    show({ id: 1, text: "x", focus: false });
    wait(4000);
    fire(q("undo-toast")!, "pointerdown");
    wait(10_000);
    expect(onExpire).not.toHaveBeenCalled();
    fire(q("undo-toast")!, "pointerup");
    wait(1999);
    expect(onExpire).not.toHaveBeenCalled();
    wait(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("путь клавиатуры: фокус на «Undo», пока фокус в тосте — не гаснет; ушёл фокус — 6 с заново", () => {
    const outside = document.createElement("button");
    document.body.append(outside);
    show({ id: 1, text: "x", focus: true });
    wait(300); // фокус ставится после кадра
    expect(document.activeElement).toBe(q("undo-toast-action"));
    wait(30_000);
    expect(onExpire).not.toHaveBeenCalled();
    act(() => outside.focus());
    wait(5999);
    expect(onExpire).not.toHaveBeenCalled();
    wait(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
    outside.remove();
  });

  it("новый тост заменяет прежний: текст новый, таймер заново", () => {
    show({ id: 1, text: "Liar puzzle deleted", focus: false });
    wait(5000);
    show({ id: 2, text: "Ink puzzle deleted", focus: false });
    expect(q("undo-toast")!.textContent).toContain("Ink puzzle deleted");
    expect(document.querySelectorAll('[data-testid="undo-toast"]')).toHaveLength(1);
    wait(5999);
    expect(onExpire).not.toHaveBeenCalled();
    wait(1);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("текст тоста и объявление «восстановлена» — в живом регионе polite", () => {
    show({ id: 1, text: "Liar puzzle deleted", focus: false });
    wait(100);
    const live = q("undo-toast-live")!;
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Liar puzzle deleted");
    show(null, { id: 1, text: "Liar puzzle restored" });
    wait(100);
    expect(live.textContent).toBe("Liar puzzle restored");
  });

  it("уход: класс ухода, через 160 мс тоста нет в DOM", () => {
    show({ id: 1, text: "x", focus: false });
    show(null);
    expect(q("undo-toast")!.classList.contains("out")).toBe(true);
    wait(170);
    expect(q("undo-toast")).toBeNull();
  });
});
