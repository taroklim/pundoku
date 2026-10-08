// @vitest-environment jsdom
/**
 * PD-225 (design/pd224-swipe-gestures.md, часть A): строка режима с незаконченной игрой на хабе — свайп справа налево
 * («открыта» с кнопкой «Удалить» / полный свайп удаляет), кнопка «Удалить» для VoiceOver/клавиатуры сразу за строкой,
 * Delete/Backspace и Esc с клавиатуры, пункт «Удалить сетку» в меню строки. Строки без игры и «Продолжить» не свайпаются.
 * Геометрия (jsdom без раскладки): ширина строки задаётся `clientWidth` = 358 (390 pt) → A = 80, T = 197.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { LONG_PRESS_MS } from "./controls";
import type { SlotSummary } from "./daySlot";
import { availableModes } from "./modes";
import { PlaySetup } from "./PlaySetup";
import type { PlaySetupProps } from "./PlaySetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let daySlot: SlotSummary | null = null;
vi.mock("./daySlot", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useDaySlot: () => daySlot }));

const DAY: SlotSummary = { difficulty: "hard", left: 41, elapsedMs: 5 * 60_000 + 3_000, ink: false };
const CLASSIC: SlotSummary = { difficulty: "medium", left: 31, elapsedMs: 8 * 60_000 + 40_000, ink: false };
const INK: SlotSummary = { difficulty: "hard", left: 47, elapsedMs: 3 * 60_000 + 18_000, ink: true };

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);
const click = (el: Element, detail = 1) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true, detail })));
const pointer = (el: Element, type: string, x: number, y = 20, id = 1) =>
  act(() => void el.dispatchEvent(Object.assign(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 }), { pointerId: id })));
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));

const fns = { onOpenMode: vi.fn(), onNewInMode: vi.fn(), onOpenToday: vi.fn(), onDeleteMode: vi.fn(), onMenuOpen: vi.fn() };
const props = (over: Partial<PlaySetupProps> = {}): PlaySetupProps => ({ modes: availableModes(), slots: {}, reselect: 0, ...fns, ...over });
const render = (over: Partial<PlaySetupProps> = {}) => {
  act(() => root.render(<PlaySetup {...props(over)} />));
  for (const el of document.querySelectorAll(".srow")) Object.defineProperty(el, "clientWidth", { configurable: true, value: 358 });
};
const fg = (mode: string) => q(`mode-${mode}`)!;
const shift = (mode: string) => fg(mode).style.transform;

/** Свайп по строке: касание в `from`, захват на 10 px, дальше до `to`; `release` — отпустить. */
function swipe(mode: string, from: number, to: number, { release = true, y = 20 } = {}) {
  const el = fg(mode);
  pointer(el, "pointerdown", from, y);
  pointer(el, "pointermove", from - 10, y);
  pointer(el, "pointermove", to, y);
  if (release) pointer(el, "pointerup", to, y);
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  daySlot = null;
  for (const f of Object.values(fns)) f.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  window.dispatchEvent(new Event("pointerdown")); // снять одноразовый перехватчик призрачного клика, если остался от теста
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("кнопка «Удалить» для VoiceOver/Voice Control (§A8)", () => {
  it("у строки с игрой — сразу за строкой, с именем «Delete unfinished puzzle: Classic» (содержит видимое «Delete»)", () => {
    render({ slots: { classic: CLASSIC } });
    const del = q("del-classic")!;
    expect(fg("classic").nextElementSibling).toBe(del);
    expect(del.hidden).toBe(false);
    expect(del.getAttribute("aria-label")).toBe("Delete unfinished puzzle: Classic");
    expect(del.textContent).toBe("Delete");
    click(del, 0);
    expect(fns.onDeleteMode).toHaveBeenCalledWith("classic", true);
  });

  it("у строки без игры кнопки нет (hidden) — в порядке чтения ничего лишнего", () => {
    render({ slots: { classic: CLASSIC } });
    expect(q("del-ink")!.hidden).toBe(true);
  });

  it("uk/ru: «Видалити незавершену сітку: Класика» / «Удалить незаконченную сетку: Классика»", async () => {
    await act(() => i18n.changeLanguage("uk"));
    render({ slots: { classic: CLASSIC } });
    expect(q("del-classic")!.getAttribute("aria-label")).toBe(`Видалити незавершену сітку: ${i18n.t("modes.classic.name")}`);
    expect(q("del-classic")!.textContent).toBe("Видалити");
    await act(() => i18n.changeLanguage("ru"));
    expect(q("del-classic")!.getAttribute("aria-label")).toBe(`Удалить незаконченную сетку: ${i18n.t("modes.classic.name")}`);
    expect(q("del-classic")!.textContent).toBe("Удалить");
  });
});

describe("клавиатура (§A8 п. 3, §A11 п. 7)", () => {
  it("Delete на строке с игрой — фокус на «Удалить», строка открыта; Enter (click detail 0) — удалить путём клавиатуры", () => {
    render({ slots: { classic: CLASSIC } });
    fg("classic").focus();
    key(fg("classic"), "Delete");
    expect(document.activeElement).toBe(q("del-classic"));
    expect(shift("classic")).toBe("translateX(-80px)");
    click(q("del-classic")!, 0);
    expect(fns.onDeleteMode).toHaveBeenCalledWith("classic", true);
    expect(shift("classic")).toBe(""); // строка вернулась на место
  });

  it("Backspace — то же; Esc — строка закрыта, фокус на строке; ушёл фокус — закрылась", () => {
    render({ slots: { classic: CLASSIC } });
    fg("classic").focus();
    key(fg("classic"), "Backspace");
    expect(document.activeElement).toBe(q("del-classic"));
    key(q("del-classic")!, "Escape");
    expect(document.activeElement).toBe(fg("classic"));
    expect(shift("classic")).toBe("");
    key(fg("classic"), "Delete");
    expect(shift("classic")).toBe("translateX(-80px)");
    act(() => fg("ink").focus());
    expect(shift("classic")).toBe("");
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
  });

  it("PD-242 (QA PD-226 Low): Shift+Tab с «Удалить» на свою строку — строка закрылась; дальше назад — закрыта", () => {
    render({ slots: { classic: CLASSIC } });
    fg("classic").focus();
    key(fg("classic"), "Delete");
    expect(shift("classic")).toBe("translateX(-80px)");
    act(() => fg("classic").focus()); // Shift+Tab: фокус с «Удалить» назад на строку
    expect(document.activeElement).toBe(fg("classic"));
    expect(shift("classic")).toBe("");
    act(() => fg("ink").focus());
    expect(shift("classic")).toBe("");
    act(() => fg("classic").focus()); // Tab вперёд на «Удалить» снова открывает
    act(() => q("del-classic")!.focus());
    expect(shift("classic")).toBe("translateX(-80px)");
    act(() => (document.activeElement as HTMLElement).blur()); // фокус ушёл в никуда (WebKit: body)
    expect(shift("classic")).toBe("");
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
  });

  it("Delete на строке без игры — ничего", () => {
    render({ slots: { classic: CLASSIC } });
    fg("ink").focus();
    key(fg("ink"), "Delete");
    expect(document.activeElement).toBe(fg("ink"));
    expect(shift("ink")).toBe("");
  });

  it("фокус на «Удалить» от касания (не клавиатура) строку не открывает", () => {
    render({ slots: { classic: CLASSIC } });
    pointer(document.body, "pointerdown", 5);
    act(() => q("del-classic")!.focus());
    expect(shift("classic")).toBe("");
  });
});

describe("пункт «Удалить сетку» в меню строки (§A8 п. 1, §A11 п. 8)", () => {
  it("при игре — последним пунктом, красным (danger), «Delete puzzle»; с клавиатуры — удаление путём клавиатуры", () => {
    render({ slots: { classic: CLASSIC } });
    act(() => void fg("classic").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(fns.onMenuOpen).toHaveBeenCalledTimes(1);
    const items = [...q("ctx-menu")!.querySelectorAll('[role="menuitem"]')];
    expect(items.at(-1)).toBe(q("ctx-delete"));
    expect(q("ctx-delete")!.classList.contains("danger")).toBe(true);
    expect(q("ctx-delete")!.textContent).toBe("Delete puzzle");
    click(q("ctx-delete")!, 0);
    expect(fns.onDeleteMode).toHaveBeenCalledWith("classic", true);
    expect(q("ctx-menu")).toBeNull();
  });

  it("долгое нажатие → «Удалить сетку» новым касанием — удаление касанием; хвост жеста пункт не нажимает", () => {
    render({ slots: { classic: CLASSIC } });
    pointer(fg("classic"), "pointerdown", 200);
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    pointer(fg("classic"), "pointerup", 200);
    click(q("ctx-delete")!);
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
    pointer(q("ctx-delete")!, "pointerdown", 200);
    click(q("ctx-delete")!);
    expect(fns.onDeleteMode).toHaveBeenCalledWith("classic", false);
  });

  it("у режима без игры пункта нет", () => {
    render({ slots: { classic: CLASSIC } });
    act(() => void fg("ink").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    expect(q("ctx-delete")).toBeNull();
  });
});

describe("свайп строки (§A3–A5, §A11 пп. 1–6)", () => {
  it("свайп ≥ A/2 — строка открыта (−A), игра на месте; < A/2 — закрылась", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 300, 250); // −50 ≥ 40
    expect(shift("classic")).toBe("translateX(-80px)");
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
    expect(fns.onOpenMode).not.toHaveBeenCalled();
    click(fg("classic")); // хвост свайпа — не тап
    expect(fns.onOpenMode).not.toHaveBeenCalled();
    render({ slots: { ink: INK } });
    swipe("ink", 300, 270); // −30 < 40
    expect(shift("ink")).toBe("");
  });

  it("при открытой строке тап по другой строке её закрывает, другая НЕ открывается; тап по открытой — закрывает", () => {
    render({ slots: { classic: CLASSIC, ink: INK } });
    swipe("classic", 300, 240);
    expect(shift("classic")).toBe("translateX(-80px)");
    pointer(fg("ink"), "pointerdown", 200);
    expect(shift("classic")).toBe("");
    pointer(fg("ink"), "pointerup", 200);
    click(fg("ink"));
    expect(fns.onOpenMode).not.toHaveBeenCalled();
    swipe("classic", 300, 240);
    pointer(fg("classic"), "pointerdown", 100);
    pointer(fg("classic"), "pointerup", 100);
    click(fg("classic"));
    expect(shift("classic")).toBe("");
    expect(fns.onOpenMode).not.toHaveBeenCalled();
  });

  it("PD-242 (QA PD-226 Major): click тача через 2–10 мс после pointerup по открытой строке партию не открывает", () => {
    render({ slots: { classic: CLASSIC } });
    for (const lag of [0, 2, 6, 10, 40]) {
      swipe("classic", 300, 240);
      expect(shift("classic")).toBe("translateX(-80px)");
      pointer(fg("classic"), "pointerdown", 100);
      pointer(fg("classic"), "pointerup", 100);
      act(() => void vi.advanceTimersByTime(lag)); // тач шлёт click не сразу: в cr-touch через 2–6 мс
      click(fg("classic"));
      expect(shift("classic")).toBe("");
      expect(fns.onOpenMode).not.toHaveBeenCalled();
    }
  });

  it("PD-242: после тапа, закрывшего строку, следующий тап по закрытой строке открывает партию (как раньше)", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 300, 240);
    pointer(fg("classic"), "pointerdown", 100);
    pointer(fg("classic"), "pointerup", 100);
    act(() => void vi.advanceTimersByTime(4));
    click(fg("classic"));
    expect(fns.onOpenMode).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(120));
    pointer(fg("classic"), "pointerdown", 100);
    pointer(fg("classic"), "pointerup", 100);
    act(() => void vi.advanceTimersByTime(4));
    click(fg("classic"));
    expect(fns.onOpenMode).toHaveBeenCalledTimes(1);
  });

  it("PD-242: закрытая строка с партией — тап (click через 6 мс) открывает партию; клавиатура/VO (detail 0) по открытой — только закрывает", () => {
    render({ slots: { classic: CLASSIC } });
    pointer(fg("classic"), "pointerdown", 100);
    pointer(fg("classic"), "pointerup", 100);
    act(() => void vi.advanceTimersByTime(6));
    click(fg("classic"));
    expect(fns.onOpenMode).toHaveBeenCalledTimes(1);
    swipe("classic", 300, 240);
    click(fg("classic"), 0);
    expect(shift("classic")).toBe("");
    expect(fns.onOpenMode).toHaveBeenCalledTimes(1);
  });

  it("открытая строка: тап по «Удалить» — удаление касанием", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 300, 240);
    pointer(q("del-classic")!, "pointerdown", 330);
    pointer(q("del-classic")!, "pointerup", 330);
    click(q("del-classic")!);
    expect(fns.onDeleteMode).toHaveBeenCalledWith("classic", false);
  });

  it("полный свайп за T — «armed», отпускание удаляет; строка возвращается на место (§A11 п. 3)", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 330, 100, { release: false }); // −230 ≥ 197
    expect(q("srow-classic")!.classList.contains("armed")).toBe(true);
    pointer(fg("classic"), "pointerup", 100);
    expect(fns.onDeleteMode).toHaveBeenCalledWith("classic", false);
    expect(shift("classic")).toBe("");
    expect(q("srow-classic")!.classList.contains("armed")).toBe(false);
  });

  it("вперёд за T и назад ниже T − 24 — не удаляет (остаётся открытой) (§A11 п. 4)", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 330, 100, { release: false });
    expect(q("srow-classic")!.classList.contains("armed")).toBe(true);
    pointer(fg("classic"), "pointermove", 160); // −160 < 173
    expect(q("srow-classic")!.classList.contains("armed")).toBe(false);
    pointer(fg("classic"), "pointerup", 160);
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
    expect(shift("classic")).toBe("translateX(-80px)");
  });

  it("pointercancel посреди «armed» не удаляет", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 330, 100, { release: false });
    pointer(fg("classic"), "pointercancel", 100);
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
  });

  it("вертикальный жест круче 34° — строка не двигается (прокрутке), долгое нажатие отменено (§A11 п. 5)", () => {
    render({ slots: { classic: CLASSIC } });
    const el = fg("classic");
    pointer(el, "pointerdown", 300, 20);
    pointer(el, "pointermove", 292, 34); // dx −8, dy 14
    pointer(el, "pointermove", 200, 60);
    pointer(el, "pointerup", 200, 60);
    expect(shift("classic")).toBe("");
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(q("ctx-menu")).toBeNull();
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
  });

  it("слева направо на закрытой, строка без игры, касание у края экрана — ничего (§A11 п. 6)", () => {
    render({ slots: { classic: CLASSIC } });
    const el = fg("classic");
    pointer(el, "pointerdown", 100);
    pointer(el, "pointermove", 110);
    pointer(el, "pointermove", 250);
    pointer(el, "pointerup", 250);
    expect(shift("classic")).toBe("");
    swipe("ink", 300, 100);
    expect(shift("ink")).toBe("");
    const right = window.innerWidth - 10;
    swipe("classic", right, right - 250);
    expect(shift("classic")).toBe("");
    expect(fns.onDeleteMode).not.toHaveBeenCalled();
  });

  it("строки «Продолжить» не свайпаются: у них нет обёртки и кнопки «Удалить»", () => {
    daySlot = DAY;
    render({ slots: { classic: CLASSIC }, liarDay: DAY });
    expect(q("continue-day")!.closest(".srow")).toBeNull();
    expect(q("continue-liar-day")!.closest(".srow")).toBeNull();
    expect(q("hub-continue")!.querySelector(".del")).toBeNull();
  });

  it("повторный тап по вкладке закрывает открытую строку", () => {
    render({ slots: { classic: CLASSIC } });
    swipe("classic", 300, 240);
    render({ slots: { classic: CLASSIC }, reselect: 1 });
    expect(shift("classic")).toBe("");
  });

  it("касание вне хаба (таб-бар, шестерёнка) закрывает открытую строку мгновенно, а тап проходит", () => {
    render({ slots: { classic: CLASSIC } });
    const outside = document.createElement("button");
    const tapped = vi.fn();
    outside.addEventListener("click", tapped);
    document.body.append(outside);
    swipe("classic", 300, 240);
    pointer(outside, "pointerdown", 50, 800);
    expect(shift("classic")).toBe("");
    expect(fg("classic").style.transition).toBe("none");
    click(outside);
    expect(tapped).toHaveBeenCalledTimes(1);
    outside.remove();
  });
});
