// @vitest-environment jsdom
/** PD-85: закрытие шита жестом вниз по grabber/заголовку — порог, бросок, возврат, Reduce Motion, тап по кнопке в ручке. */
import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DISMISS_MIN_PX, SETTLE_MS, shouldDismiss, useSheetSwipe } from "./useSheetSwipe";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("shouldDismiss", () => {
  it("вниз дальше порога (четверть высоты, не меньше минимума) — закрыть; ближе — вернуть", () => {
    expect(shouldDismiss(DISMISS_MIN_PX - 1, 200, 0)).toBe(false);
    expect(shouldDismiss(DISMISS_MIN_PX, 200, 0)).toBe(true);
    expect(shouldDismiss(150, 800, 0)).toBe(false); // 25 % от 800 = 200
    expect(shouldDismiss(200, 800, 0)).toBe(true);
  });
  it("бросок вниз закрывает и при малом пути; вверх и нулевой путь — никогда", () => {
    expect(shouldDismiss(30, 800, 1)).toBe(true);
    expect(shouldDismiss(4, 800, 5)).toBe(false);
    expect(shouldDismiss(-300, 800, 5)).toBe(false);
    expect(shouldDismiss(0, 800, 5)).toBe(false);
  });
});

function Harness({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const swipe = useSheetSwipe(ref, onClose);
  return (
    <section ref={ref} data-testid="sheet">
      <div data-testid="grab" className="sheet-handle" {...swipe} />
      <header data-testid="head" className="sheet-handle" {...swipe}>
        <button type="button" data-testid="done" onClick={onClose}>
          Done
        </button>
      </header>
      <div data-testid="body" />
    </section>
  );
}

let host: HTMLDivElement;
let root: Root;
let reduced = false;
beforeEach(() => {
  vi.useFakeTimers();
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("prefers-reduced-motion") ? reduced : false, media: q, addEventListener: () => {}, removeEventListener: () => {} }));
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

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const ptr = (el: Element, type: string, y: number, x = 100) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }), { pointerId: 1, pointerType: "touch" }) as Event));
/** Жест: вниз на `dy` за `ms` мс (время событий — `performance.now`, подменяем через fake timers). */
function drag(el: Element, dy: number, ms: number, x = 100) {
  ptr(el, "pointerdown", 100, x);
  vi.advanceTimersByTime(ms / 2);
  ptr(el, "pointermove", 100 + dy / 2, x);
  vi.advanceTimersByTime(ms / 2);
  ptr(el, "pointermove", 100 + dy, x);
  ptr(el, "pointerup", 100 + dy, x);
}

describe("useSheetSwipe", () => {
  it("медленный путь дальше порога: шит едет за пальцем, уезжает за экран и после анимации закрывается", () => {
    const onClose = vi.fn();
    act(() => root.render(<Harness onClose={onClose} />));
    ptr(q("grab"), "pointerdown", 100);
    ptr(q("grab"), "pointermove", 160);
    expect(q("sheet").style.transform).toBe("translateY(60px)");
    ptr(q("grab"), "pointermove", 220);
    ptr(q("grab"), "pointerup", 220);
    expect(q("sheet").style.transform).toBe("translateY(101%)");
    expect(onClose).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("указатель ушёл с ручки (мышь выскочила за её границы): жест продолжается, шит закрывается", () => {
    const onClose = vi.fn();
    act(() => root.render(<Harness onClose={onClose} />));
    ptr(q("head"), "pointerdown", 100);
    ptr(document.body, "pointermove", 130);
    ptr(document.body, "pointermove", 230);
    ptr(document.body, "pointerup", 230);
    expect(q("sheet").style.transform).toBe("translateY(101%)");
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("жест по заголовку тоже закрывает; короткий путь без броска — шит возвращается, не закрывается", () => {
    const onClose = vi.fn();
    act(() => root.render(<Harness onClose={onClose} />));
    drag(q("head"), 30, 1000);
    expect(q("sheet").style.transform).toBe("");
    act(() => void vi.advanceTimersByTime(SETTLE_MS * 2));
    expect(onClose).not.toHaveBeenCalled();
    expect(q("sheet").style.transition).toBe("");
    drag(q("head"), 120, 300);
    act(() => void vi.advanceTimersByTime(SETTLE_MS));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Reduce Motion: без анимации — закрытие и возврат мгновенные", () => {
    reduced = true;
    const onClose = vi.fn();
    act(() => root.render(<Harness onClose={onClose} />));
    drag(q("grab"), 200, 300);
    expect(q("sheet").style.transition).toBe("none");
    act(() => void vi.advanceTimersByTime(0));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("жест вверх или горизонтальный — не закрывает и не двигает шит", () => {
    const onClose = vi.fn();
    act(() => root.render(<Harness onClose={onClose} />));
    drag(q("grab"), -200, 200);
    expect(q("sheet").style.transform).toBe("");
    ptr(q("grab"), "pointerdown", 100, 100);
    ptr(q("grab"), "pointermove", 110, 200);
    ptr(q("grab"), "pointermove", 300, 200);
    ptr(q("grab"), "pointerup", 300, 200);
    act(() => void vi.advanceTimersByTime(SETTLE_MS * 2));
    expect(onClose).not.toHaveBeenCalled();
    expect(q("sheet").style.transform).toBe("");
  });

  it("обычный тап по Done в ручке работает (жест не включается без сдвига); после настоящего жеста клик гасится", () => {
    const onClose = vi.fn();
    act(() => root.render(<Harness onClose={onClose} />));
    ptr(q("done"), "pointerdown", 100);
    ptr(q("done"), "pointerup", 101);
    act(() => void q("done").click());
    expect(onClose).toHaveBeenCalledTimes(1);
    drag(q("head"), 10, 1000); // сдвиг ≥ slop, но короткий: возврат
    act(() => void q("head").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    act(() => void vi.advanceTimersByTime(SETTLE_MS * 2));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
