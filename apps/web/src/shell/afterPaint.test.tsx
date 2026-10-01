// @vitest-environment jsdom
// PD-95: afterPaint (rAF → setTimeout 0, страховка 200 мс) и useDeferredFocus.
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AFTER_PAINT_SAFETY_MS, afterPaint, useDeferredFocus } from "./afterPaint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("afterPaint", () => {
  it("не синхронно и не в самом rAF: после кадра (rAF → setTimeout 0)", () => {
    const cb = vi.fn();
    afterPaint(cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(15);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); // rAF отработал; колбэк ещё впереди (после отрисовки кадра)
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("выполняется ровно один раз (rAF-ветка и страховка не дублируют)", () => {
    const cb = vi.fn();
    afterPaint(cb);
    vi.advanceTimersByTime(AFTER_PAINT_SAFETY_MS * 3);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("страховка: rAF не приходит (скрытая вкладка/WebKit без кадров) — колбэк всё равно выполняется", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const cb = vi.fn();
    afterPaint(cb);
    vi.advanceTimersByTime(AFTER_PAINT_SAFETY_MS - 1);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("нет requestAnimationFrame вовсе — работает на таймере", () => {
    vi.stubGlobal("requestAnimationFrame", undefined);
    const cb = vi.fn();
    afterPaint(cb);
    vi.advanceTimersByTime(AFTER_PAINT_SAFETY_MS);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("отмена до и после rAF гасит колбэк", () => {
    const a = vi.fn();
    const b = vi.fn();
    afterPaint(a)();
    const cancelB = afterPaint(b);
    vi.advanceTimersByTime(16); // rAF уже был, setTimeout(0) ещё нет
    cancelB();
    vi.advanceTimersByTime(AFTER_PAINT_SAFETY_MS * 2);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});

describe("useDeferredFocus", () => {
  let host: HTMLDivElement;
  let root: Root;
  function Harness({ active }: { active: boolean }) {
    const ref = useRef<HTMLElement>(null);
    useDeferredFocus(ref, active);
    return <section ref={ref} tabIndex={-1} data-testid="c" />;
  }
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const el = () => host.querySelector<HTMLElement>('[data-testid="c"]')!;

  it("неактивен — фокус не трогает; стал активным — фокус после кадра, без прокрутки", () => {
    act(() => root.render(<Harness active={false} />));
    act(() => void vi.advanceTimersByTime(AFTER_PAINT_SAFETY_MS * 2));
    expect(document.activeElement).not.toBe(el());
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    act(() => root.render(<Harness active />));
    expect(document.activeElement).not.toBe(el());
    act(() => void vi.advanceTimersByTime(20));
    expect(document.activeElement).toBe(el());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it("размонтирование до кадра отменяет фокус", () => {
    act(() => root.render(<Harness active />));
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    act(() => root.unmount());
    act(() => void vi.advanceTimersByTime(AFTER_PAINT_SAFETY_MS * 2));
    expect(focus).not.toHaveBeenCalled();
    focus.mockRestore();
    root = createRoot(host);
  });
});
