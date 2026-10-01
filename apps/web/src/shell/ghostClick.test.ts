// @vitest-environment jsdom
// PD-94: хвост прерывающего касания (click) гасится; клавиатура/AT и следующие тапы не блокируются.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GHOST_CLICK_GRACE_MS, swallowGhostClick } from "./ghostClick";

let btn: HTMLButtonElement;
let clicks: number;
const ev = (type: string) => new Event(type, { bubbles: true, cancelable: true });
const click = (detail: number) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
  btn.dispatchEvent(e);
  return e;
};

beforeEach(() => {
  vi.useFakeTimers();
  clicks = 0;
  btn = document.createElement("button");
  btn.addEventListener("click", () => clicks++);
  document.body.append(btn);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  btn.remove();
  vi.useRealTimers();
});

describe("swallowGhostClick", () => {
  it("гасит click касания, прервавшего анимацию (pointerdown -> pointerup -> click)", () => {
    const down = ev("pointerdown");
    btn.dispatchEvent(down);
    swallowGhostClick(down);
    btn.dispatchEvent(ev("pointerup"));
    const e = click(1);
    expect(clicks).toBe(0);
    expect(e.defaultPrevented).toBe(true);
  });

  it("одноразовый: второй click (следующий тап) проходит", () => {
    const down = ev("pointerdown");
    swallowGhostClick(down);
    btn.dispatchEvent(ev("pointerup"));
    click(1);
    click(1);
    expect(clicks).toBe(1);
  });

  it("следующий pointerdown снимает перехват: обычный тап сразу после паузы работает", () => {
    const down = ev("pointerdown");
    swallowGhostClick(down);
    btn.dispatchEvent(ev("pointerup"));
    btn.dispatchEvent(ev("pointerdown")); // новое касание, не дожидаясь окна
    btn.dispatchEvent(ev("pointerup"));
    click(1);
    expect(clicks).toBe(1);
  });

  it("само прерывающее событие перехват не снимает (слушатель добавлен посреди его диспетча)", () => {
    const down = ev("pointerdown");
    document.addEventListener("pointerdown", () => swallowGhostClick(down), { once: true, capture: true });
    btn.dispatchEvent(down);
    btn.dispatchEvent(ev("pointerup"));
    click(1);
    expect(clicks).toBe(0);
  });

  it("клавиатурная/AT-активация (detail 0) не блокируется и перехват не расходует", () => {
    const down = ev("pointerdown");
    swallowGhostClick(down);
    click(0);
    expect(clicks).toBe(1);
    btn.dispatchEvent(ev("pointerup"));
    click(1);
    expect(clicks).toBe(1); // а вот хвост касания всё ещё гасится
  });

  it("после окна (pointerup + GRACE) перехват снимается сам", () => {
    const down = ev("pointerdown");
    swallowGhostClick(down);
    btn.dispatchEvent(ev("pointerup"));
    vi.advanceTimersByTime(GHOST_CLICK_GRACE_MS + 1);
    click(1);
    expect(clicks).toBe(1);
  });

  it("долгое удержание до pointerup не снимает перехват раньше времени", () => {
    const down = ev("pointerdown");
    swallowGhostClick(down);
    vi.advanceTimersByTime(3000);
    btn.dispatchEvent(ev("pointerup"));
    click(1);
    expect(clicks).toBe(0);
  });

  it("pointercancel тоже запускает окно и снимает перехват", () => {
    const down = ev("pointerdown");
    swallowGhostClick(down);
    btn.dispatchEvent(ev("pointercancel"));
    vi.advanceTimersByTime(GHOST_CLICK_GRACE_MS + 1);
    click(1);
    expect(clicks).toBe(1);
  });

  it("повторный вызов заменяет прежний перехват (без накопления слушателей)", () => {
    const add = vi.spyOn(window, "removeEventListener");
    swallowGhostClick(ev("pointerdown"));
    swallowGhostClick(ev("pointerdown"));
    expect(add).toHaveBeenCalled();
    add.mockRestore();
    btn.dispatchEvent(ev("pointerup"));
    click(1);
    click(1);
    expect(clicks).toBe(1);
  });
});
