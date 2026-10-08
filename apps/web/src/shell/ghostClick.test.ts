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

  // PD-221: финал прерывается ЛЮБЫМ касанием, в том числе по таб-бару. Таб-бар под пальцем не перерисовывается, его click —
  // не призрак: раньше тап по вкладке в dim-фазе финала Play / во время полёта Today только прерывал финал, вкладка не менялась.
  it("касание ДРУГОЙ вкладки таб-бара: click по ней проходит (прерывание финала по-прежнему срабатывает у вызывающего)", () => {
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("role", "tab");
    tabBtn.setAttribute("aria-selected", "false");
    const label = document.createElement("span");
    tabBtn.append(label);
    bar.append(tabBtn);
    document.body.append(bar);
    let tabClicks = 0;
    tabBtn.addEventListener("click", () => tabClicks++);
    const down = ev("pointerdown");
    document.addEventListener("pointerdown", () => swallowGhostClick(down), { once: true, capture: true });
    label.dispatchEvent(down); // палец на подписи вкладки
    tabBtn.dispatchEvent(ev("pointerup"));
    tabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(tabClicks).toBe(1);
    // и перехват не «висит» до следующего касания вне таб-бара
    click(1);
    expect(clicks).toBe(1);
    bar.remove();
  });

  // PD-239 (QA PD-222): касание УЖЕ ВЫБРАННОЙ вкладки, прервавшее финал, — не повторный тап («Play → хаб», PD-144), а только
  // прерывание: его click гасится, как любой хвост (PD-94). Переключение на другую вкладку (PD-221) не затронуто.
  it("касание АКТИВНОЙ вкладки таб-бара: click гасится (только прерывание), клавиатура/AT — нет", () => {
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("role", "tab");
    tabBtn.setAttribute("aria-selected", "true");
    const label = document.createElement("span");
    tabBtn.append(label);
    bar.append(tabBtn);
    document.body.append(bar);
    let tabClicks = 0;
    tabBtn.addEventListener("click", () => tabClicks++);
    const down = ev("pointerdown");
    document.addEventListener("pointerdown", () => swallowGhostClick(down), { once: true, capture: true });
    label.dispatchEvent(down); // палец на подписи выбранной вкладки
    tabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
    expect(tabClicks).toBe(1); // клавиатура/VoiceOver не блокируются
    tabBtn.dispatchEvent(ev("pointerup"));
    const tail = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    tabBtn.dispatchEvent(tail);
    expect(tabClicks).toBe(1);
    expect(tail.defaultPrevented).toBe(true);
    // следующее касание той же вкладки — осознанный повторный тап, проходит
    tabBtn.dispatchEvent(ev("pointerdown"));
    tabBtn.dispatchEvent(ev("pointerup"));
    tabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(tabClicks).toBe(2);
    bar.remove();
  });
});
