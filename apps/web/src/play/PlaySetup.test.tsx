// @vitest-environment jsdom
/**
 * PD-144: хаб Play. Два НЕЗАВИСИМЫХ слота «Продолжить» (день → вкладка Today, своя сетка → доска), подпись при пустом хабе,
 * сложность списком (radiogroup, числа/техника из DIFFICULTY_PROFILES), шит «Отбросить» ТОЛЬКО на «Начать» при незавершённой
 * СВОЕЙ сетке, строка «Режим» и повторный тап по вкладке Play (оверлеи закрываются, хаб прокручивается наверх).
 */
import { DIFFICULTIES, DIFFICULTY_PROFILES } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { SlotSummary } from "./daySlot";
import { PlaySetup } from "./PlaySetup";
import type { PlaySetupProps } from "./PlaySetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Слот дня — отдельный источник; здесь он задаётся напрямую (его сборка из стора/хранилища проверена в daySlot.test.tsx).
let daySlot: SlotSummary | null = null;
vi.mock("./daySlot", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useDaySlot: () => daySlot }));

const DAY: SlotSummary = { difficulty: "hard", left: 41, elapsedMs: 5 * 60_000 + 3_000, ink: false };
const OWN: SlotSummary = { difficulty: "medium", left: 28, elapsedMs: 12 * 60_000 + 4_000, ink: false };

let host: HTMLDivElement;
let root: Root;
const q = <T extends Element = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`);
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');

const fns = { onPick: vi.fn(), onInk: vi.fn(), onStart: vi.fn(), onResume: vi.fn(), onOpenToday: vi.fn() };
const props = (over: Partial<PlaySetupProps> = {}): PlaySetupProps => ({ pick: "medium", ink: false, own: null, reselect: 0, ...fns, ...over });
const render = (over: Partial<PlaySetupProps> = {}) => act(() => root.render(<PlaySetup {...props(over)} />));

beforeEach(async () => {
  await i18n.changeLanguage("en");
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
});

describe("«Продолжить»: два независимых слота", () => {
  it("нет ни дня, ни своей сетки — секции нет, под заголовком подпись «A puzzle of your own, any time.»", () => {
    render();
    expect(q("hub-continue")).toBeNull();
    expect(q("hub-sub")!.textContent).toBe("A puzzle of your own, any time.");
  });

  it("только своя сетка: одна строка, подпись «Medium · 28 cells left · 12:04», подписи под заголовком нет", () => {
    render({ own: OWN });
    expect(q("continue-day")).toBeNull();
    expect(q("hub-sub")).toBeNull();
    expect(q("continue-own")!.textContent).toContain("Your own puzzle");
    expect(q("continue-own")!.textContent).toContain("Medium · 28 cells left · 12:04");
  });

  it("только день: одна строка дня; своей строки нет", () => {
    daySlot = DAY;
    render();
    expect(q("continue-own")).toBeNull();
    expect(q("continue-day")!.textContent).toContain("Today’s puzzle");
    expect(q("continue-day")!.textContent).toContain("Hard · 41 cells left · 5:03");
  });

  it("оба слота рядом, независимо: тап по дню открывает Today (и не трогает свою сетку), тап по своей — доску", () => {
    daySlot = DAY;
    render({ own: OWN });
    expect(host.querySelectorAll(".hub-card .hub-row.two")).toHaveLength(2);
    click(q("continue-day")!);
    expect(fns.onOpenToday).toHaveBeenCalledTimes(1);
    expect(fns.onResume).not.toHaveBeenCalled();
    click(q("continue-own")!);
    expect(fns.onResume).toHaveBeenCalledTimes(1);
    expect(fns.onOpenToday).toHaveBeenCalledTimes(1);
  });

  it("чип Ink у слота, где идёт чернильная партия; у классического слота чипа нет", () => {
    daySlot = { ...DAY, ink: false };
    render({ own: { ...OWN, ink: true } });
    expect(q("continue-own")!.querySelector(".mode-chip")!.textContent).toBe("Ink");
    expect(q("continue-day")!.querySelector(".mode-chip")).toBeNull();
  });
});

describe("шит «Отбросить эту сетку?» — только «Начать» при своей сетке", () => {
  it("без своей сетки «Начать» запускает сразу, без шита", () => {
    render();
    click(q("setup-start")!);
    expect(dialog()).toBeNull();
    expect(fns.onStart).toHaveBeenCalledTimes(1);
  });

  it("слот ДНЯ шит не вызывает: день «Начать» не затрагивает", () => {
    daySlot = DAY;
    render();
    click(q("setup-start")!);
    expect(dialog()).toBeNull();
    expect(fns.onStart).toHaveBeenCalledTimes(1);
  });

  it("со своей сеткой «Начать» спрашивает; «Keep playing» оставляет всё как есть, «Discard» запускает", () => {
    render({ own: OWN });
    click(q("setup-start")!);
    expect(dialog()).not.toBeNull();
    expect(fns.onStart).not.toHaveBeenCalled();
    click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Keep playing")!);
    expect(dialog()).toBeNull();
    expect(fns.onStart).not.toHaveBeenCalled();
    click(q("setup-start")!);
    click([...dialog()!.querySelectorAll("button")].find((b) => b.textContent === "Discard")!);
    expect(fns.onStart).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
  });

  it("выбор сложности, режима и тап по слотам шит не вызывают", () => {
    render({ own: OWN });
    click(q("difficulty-easy")!);
    click(q("continue-own")!);
    click(q("mode-row")!);
    expect(dialog()?.getAttribute("data-testid")).toBe("mode-sheet");
    expect(document.querySelector("[data-testid=mode-sheet]")).not.toBeNull();
    expect(host.textContent).not.toContain("Discard this puzzle?");
  });
});

describe("сложность списком", () => {
  it("radiogroup из пяти radio, нативного select нет; выбранная — aria-checked, остальные нет", () => {
    render({ pick: "hard" });
    expect(host.querySelector("select")).toBeNull();
    const group = q("difficulty-list")!;
    expect(group.getAttribute("role")).toBe("radiogroup");
    const radios = [...group.querySelectorAll('[role="radio"]')];
    expect(radios).toHaveLength(5);
    expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(DIFFICULTIES.map((d) => String(d === "hard")));
  });

  it("числа клеток и техника берутся из DIFFICULTY_PROFILES, а не зашиты в интерфейс", () => {
    render();
    for (const d of DIFFICULTIES) {
      const sub = q(`difficulty-${d}`)!.querySelector(".sub")!.textContent!;
      expect(sub, d).toContain(`${DIFFICULTY_PROFILES[d].clues} clues`);
    }
    expect(q("difficulty-easy")!.querySelector(".sub")!.textContent).toContain("singles");
    expect(q("difficulty-hard")!.querySelector(".sub")!.textContent).toContain("locked candidates");
    expect(q("difficulty-expert")!.querySelector(".sub")!.textContent).toContain("pairs");
    expect(q("difficulty-master")!.querySelector(".sub")!.textContent).toContain("beyond pairs");
  });

  it("тап выбирает; стрелки/Home/End двигают выбор по кругу; roving tabindex", () => {
    render({ pick: "medium" });
    expect(q("difficulty-medium")!.getAttribute("tabindex")).toBe("0");
    expect(q("difficulty-easy")!.getAttribute("tabindex")).toBe("-1");
    click(q("difficulty-expert")!);
    expect(fns.onPick).toHaveBeenLastCalledWith("expert");
    key(q("difficulty-medium")!, "ArrowDown");
    expect(fns.onPick).toHaveBeenLastCalledWith("hard");
    key(q("difficulty-medium")!, "ArrowUp");
    expect(fns.onPick).toHaveBeenLastCalledWith("easy");
    key(q("difficulty-medium")!, "End");
    expect(fns.onPick).toHaveBeenLastCalledWith("master");
    render({ pick: "easy" });
    key(q("difficulty-easy")!, "ArrowUp");
    expect(fns.onPick).toHaveBeenLastCalledWith("master"); // по кругу
    key(q("difficulty-easy")!, "Home");
    expect(fns.onPick).toHaveBeenLastCalledWith("easy");
  });
});

describe("строка «Режим»", () => {
  it("значение «Classic»/«Ink», сноска зависит от режима; шит с двумя вариантами и описаниями", () => {
    render({ ink: false });
    expect(q("mode-value")!.textContent).toBe("Classic");
    const classic = q("mode-foot")!.textContent;
    click(q("mode-row")!);
    const sheet = document.querySelector('[data-testid="mode-sheet"]')!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.querySelectorAll('[role="radio"]')).toHaveLength(2);
    expect(sheet.querySelector('[data-testid="mode-classic"]')!.getAttribute("aria-checked")).toBe("true");
    expect(sheet.textContent).toContain("Undo, the eraser and notes all work.");
    expect(sheet.textContent).toContain("No undo and no eraser for digits. A wrong digit leaves a blot.");
    render({ ink: true });
    expect(q("mode-value")!.textContent).toBe("Ink");
    expect(q("mode-foot")!.textContent).not.toBe(classic);
    expect(q("mode-foot")!.textContent).toContain("no undo");
  });

  it("выбор Ink сначала показывает правило PD-74; «Classic» ставится сразу", () => {
    render({ ink: false });
    click(q("mode-row")!);
    click(document.querySelector('[data-testid="mode-ink"]')!);
    expect(fns.onInk).not.toHaveBeenCalled();
    click(document.querySelector('[data-testid="ink-rule-start"]')!);
    expect(fns.onInk).toHaveBeenCalledWith(true);
  });

  it("Esc закрывает шит и возвращает фокус на строку «Режим»", () => {
    render();
    click(q("mode-row")!);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[data-testid="mode-sheet"]')).toBeNull();
    expect(document.activeElement).toBe(q("mode-row"));
  });
});

describe("повторный тап по вкладке Play (reselect)", () => {
  it("закрывает шит «Режим» и шит «Отбросить» без подтверждений; хаб прокручивается наверх", () => {
    render({ own: OWN });
    const scroller = q("hub-scroll")!;
    const scrollTo = vi.fn();
    scroller.scrollTo = scrollTo as never;
    click(q("mode-row")!);
    expect(document.querySelector('[data-testid="mode-sheet"]')).not.toBeNull();
    render({ own: OWN, reselect: 1 });
    expect(document.querySelector('[data-testid="mode-sheet"]')).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    click(q("setup-start")!);
    expect(dialog()).not.toBeNull();
    render({ own: OWN, reselect: 2 });
    expect(dialog()).toBeNull();
    expect(fns.onStart).not.toHaveBeenCalled(); // «Начать» не выполнено
  });

  it("без изменения счётчика ничего не закрывается", () => {
    render({ own: OWN });
    click(q("mode-row")!);
    render({ own: OWN, reselect: 0 });
    expect(document.querySelector('[data-testid="mode-sheet"]')).not.toBeNull();
  });
});

describe("«Начать» и позиция раздела режимов релиза 2", () => {
  it("«Начать» закреплена в .hub-bar вне прокручиваемого списка; раздела режимов релиза 2 нет — только пустой .hub-slot-gap", () => {
    render();
    expect(q("setup-start")!.closest(".hub-bar")).not.toBeNull();
    expect(q("hub-scroll")!.contains(q("setup-start"))).toBe(false);
    const gap = host.querySelector(".hub-slot-gap")!;
    expect(gap.textContent).toBe("");
    expect(gap.children).toHaveLength(0);
  });
});
