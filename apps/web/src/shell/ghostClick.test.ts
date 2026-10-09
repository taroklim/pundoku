// @vitest-environment jsdom
// PD-94: хвост прерывающего касания (click) гасится; клавиатура/AT и следующие тапы не блокируются.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deferPastTabTap, GHOST_CLICK_GRACE_MS, swallowGhostClick } from "./ghostClick";
import { prewarmsOn } from "./TabBar";

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

// PD-276: WebKit iOS (ContentChangeObserver) не шлёт click, если между touchstart и click появилось кликабельное. Всё, что
// показывает касание ДРУГОЙ вкладки, откладывается до его click; таб-бар не прогревает панель на касании.
describe("deferPastTabTap (PD-276)", () => {
  const mkBar = (selected: boolean) => {
    const bar = document.createElement("div");
    bar.setAttribute("role", "tablist");
    const tabBtn = document.createElement("button");
    tabBtn.setAttribute("role", "tab");
    tabBtn.setAttribute("aria-selected", String(selected));
    const label = document.createElement("span");
    tabBtn.append(label);
    bar.append(tabBtn);
    document.body.append(bar);
    return { bar, tabBtn, label };
  };

  it("не вкладка или выбранная вкладка — null, reveal не трогается (вызывающий прерывает как раньше)", () => {
    const reveal = vi.fn();
    const down = ev("pointerdown");
    btn.dispatchEvent(down);
    expect(deferPastTabTap(down, reveal)).toBeNull();
    const { bar, label } = mkBar(true);
    const d2 = ev("pointerdown");
    label.dispatchEvent(d2);
    expect(deferPastTabTap(d2, reveal)).toBeNull();
    vi.advanceTimersByTime(20_000);
    expect(reveal).not.toHaveBeenCalled();
    bar.remove();
  });

  it("другая вкладка: до click ничего; click доходит до вкладки; reveal — следующей задачей, ровно один раз", () => {
    const { bar, tabBtn, label } = mkBar(false);
    const order: string[] = [];
    tabBtn.addEventListener("click", () => order.push("tab"));
    const reveal = vi.fn(() => order.push("reveal"));
    const down = ev("pointerdown");
    label.dispatchEvent(down);
    expect(deferPastTabTap(down, reveal)).toBeTypeOf("function");
    vi.advanceTimersByTime(5000); // палец держат: ничего не появляется
    expect(reveal).not.toHaveBeenCalled();
    tabBtn.dispatchEvent(ev("pointerup"));
    const c = new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
    tabBtn.dispatchEvent(c);
    expect(c.defaultPrevented).toBe(false);
    expect(order).toEqual(["tab"]);
    vi.advanceTimersByTime(0);
    expect(order).toEqual(["tab", "reveal"]);
    vi.advanceTimersByTime(20_000);
    expect(reveal).toHaveBeenCalledTimes(1);
    bar.remove();
  });

  it("click не пришёл: reveal по pointercancel, либо через GHOST_CLICK_GRACE_MS после pointerup, либо по страховке", () => {
    const { bar, label } = mkBar(false);
    const r1 = vi.fn();
    const d1 = ev("pointerdown");
    label.dispatchEvent(d1);
    deferPastTabTap(d1, r1);
    label.dispatchEvent(ev("pointercancel"));
    expect(r1).toHaveBeenCalledTimes(1);

    const r2 = vi.fn();
    const d2 = ev("pointerdown");
    label.dispatchEvent(d2);
    deferPastTabTap(d2, r2);
    label.dispatchEvent(ev("pointerup"));
    vi.advanceTimersByTime(GHOST_CLICK_GRACE_MS - 1);
    expect(r2).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(r2).toHaveBeenCalledTimes(1);

    const r3 = vi.fn();
    const d3 = ev("pointerdown");
    label.dispatchEvent(d3);
    deferPastTabTap(d3, r3);
    vi.advanceTimersByTime(10_000);
    expect(r3).toHaveBeenCalledTimes(1);
    bar.remove();
  });

  it("отмена (очистка эффекта / следующее касание) — reveal не вызывается, слушатели сняты", () => {
    const { bar, tabBtn, label } = mkBar(false);
    const reveal = vi.fn();
    const down = ev("pointerdown");
    label.dispatchEvent(down);
    const cancel = deferPastTabTap(down, reveal)!;
    tabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    cancel(); // отменили и уже запланированный после click показ
    vi.advanceTimersByTime(20_000);
    label.dispatchEvent(ev("pointercancel"));
    expect(reveal).not.toHaveBeenCalled();
    bar.remove();
  });
});

describe("prewarmsOn (PD-276)", () => {
  it("прогрев вкладки по нажатию — только мышь/трекпад; касание и перо — нет", () => {
    expect(prewarmsOn("mouse")).toBe(true);
    expect(prewarmsOn("touch")).toBe(false);
    expect(prewarmsOn("pen")).toBe(false);
    expect(prewarmsOn("")).toBe(false);
  });
});
