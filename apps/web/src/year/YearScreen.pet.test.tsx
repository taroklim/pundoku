// @vitest-environment jsdom
/**
 * PD-299: Питомец в Year (макет PD-296 §2, решение владельца). Место 4 — пустой Year: спящая клякса 64 pt на месте знака P4. Место 5 —
 * шапка Year: Питомец сегодняшнего дня (спит до решения, потом настроение дня), пауза под открытым листом. Плюс зона тапа у кляксы
 * листа дня. Везде: тап — «Плюх», тумблер выкл — кляксы нет, на экране дышит не больше одной. CSS места 4 — `yearEmptyPet.css.test.ts`.
 * Живьём — `design/pd299-check.mjs`.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { resetPokes } from "../pet/petPoke";
import type { LiarInfo } from "../play/savedPlay";
import { setPetEnabled } from "../settings/prefs";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import { YearScreen } from "./YearScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear(); // PD-297: Питомец вкл по умолчанию
  resetPokes();
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

const render = (days: DayProgress[] | null, opts: { liar?: ReadonlyMap<string, LiarInfo>; today?: string } = {}) =>
  act(() =>
    root.render(<YearScreen days={days} firstUse="2026-09-01" today={opts.today ?? TODAY} liar={opts.liar} onOpenToday={vi.fn()} onPlayDay={vi.fn()} onOpenSettings={vi.fn()} />),
  );
const tid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const pet = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"] .pet`);
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const idle = (id: string) => pet(id)!.hasAttribute("data-idle");

function touch(el: Element) {
  const ev = (type: string, t: number) => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 20, clientY: 20, isPrimary: true });
    Object.defineProperty(e, "timeStamp", { value: t });
    return e;
  };
  let prevented = false;
  act(() => {
    const d = ev("pointerdown", 5000);
    el.dispatchEvent(d);
    const u = ev("pointerup", 5080);
    el.dispatchEvent(u);
    prevented = d.defaultPrevented || u.defaultPrevented;
  });
  return prevented;
}

const DAYS = [progressOf("2026-09-10"), progressOf("2026-09-11", { withFix: true })];
const LIAR_FIRST: LiarInfo = { caught: true, firstTry: true, wrongAccusations: 0, catchT: 4000, catchPlacement: 12 };

describe("место 4: пустой Year", () => {
  it("на месте знака P4 — спящая клякса 64 pt в зоне тапа, первой в блоке, перед строкой; знака нет; дышит", () => {
    render([]);
    const empty = tid("year-empty")!;
    const zone = tid("pet-year-empty")!;
    expect(empty.firstElementChild).toBe(zone);
    expect(zone.classList.contains("pet-hit")).toBe(true);
    expect(zone.nextElementSibling!.tagName).toBe("P");
    expect(empty.querySelector(".year-empty-mark")).toBeNull();
    const blot = pet("pet-year-empty")!;
    expect(blot.dataset.mood).toBe("asleep");
    expect(blot.style.width).toBe("64px");
    expect(blot.getAttribute("role")).toBe("img");
    expect(blot.getAttribute("aria-label")).toBe("Blot, asleep");
    expect(idle("pet-year-empty")).toBe(true);
  });

  it("одна клякса на экране: в шапке пустого года Питомца нет", () => {
    render([]);
    expect(tid("pet-year-head")).toBeNull();
    expect(document.querySelectorAll(".pet")).toHaveLength(1);
  });

  it("тумблер выкл — знак P4, как раньше, кляксы нет", () => {
    setPetEnabled(false);
    render([]);
    expect(tid("year-empty")!.firstElementChild!.matches("svg.year-empty-mark")).toBe(true);
    expect(document.querySelector(".pet")).toBeNull();
  });

  it("тумблер действует на открытом экране сразу", () => {
    render([]);
    act(() => setPetEnabled(false));
    expect(tid("pet-year-empty")).toBeNull();
    expect(document.querySelector(".year-empty-mark")).not.toBeNull();
    act(() => setPetEnabled(true));
    expect(tid("pet-year-empty")).not.toBeNull();
  });

  it("пока данные грузятся — ни пустого состояния, ни кляксы", () => {
    render(null);
    expect(document.querySelector(".pet")).toBeNull();
  });

  it("тап — «Плюх» без preventDefault; кнопка «Open today's puzzle» не нажимается", () => {
    render([]);
    expect(touch(tid("pet-year-empty")!)).toBe(false);
    expect(pet("pet-year-empty")!.dataset.poke).toBe("A");
    expect(pet("pet-year-empty")!.dataset.mood).toBe("asleep"); // настроение тапом не меняется
  });

  it("открыт лист (месяц → сегодня): клякса пустого года стоит, дышит только клякса листа", () => {
    render([]);
    click(document.querySelector('.year-month[data-month="8"]'));
    expect(idle("pet-year-empty")).toBe(false);
    click(document.querySelector(`.ycell[data-date="${TODAY}"]`));
    expect(idle("pet-year")).toBe(true);
    expect([...document.querySelectorAll(".pet[data-idle]")]).toHaveLength(1);
  });
});

describe("место 5: шапка Year — Питомец сегодняшнего дня", () => {
  it("сегодня не сыгран — спит; 40 pt; первым в группе действий, перед шестерёнкой", () => {
    render(DAYS);
    const zone = tid("pet-year-head")!;
    expect(zone.classList.contains("pet-head")).toBe(true);
    expect(zone.parentElement!.classList.contains("toolbar-end")).toBe(true);
    expect(zone.nextElementSibling).toBe(tid("open-settings"));
    expect(pet("pet-year-head")!.dataset.mood).toBe("asleep");
    expect(pet("pet-year-head")!.style.width).toBe("40px");
    expect(idle("pet-year-head")).toBe(true);
    expect(document.querySelectorAll(".pet")).toHaveLength(1);
  });

  it("сегодня решён — настроение дня, то же, что в листе дня (правило одно); с правкой → устал; «проснуться» здесь не играет", () => {
    render([...DAYS, progressOf(TODAY)]);
    const head = pet("pet-year-head")!.dataset.mood;
    expect(head).not.toBe("asleep");
    expect(pet("pet-year-head")!.hasAttribute("data-act")).toBe(false);
    click(document.querySelector('.year-month[data-month="8"]'));
    click(document.querySelector(`.ycell[data-date="${TODAY}"]`));
    expect(pet("pet-year")!.dataset.mood).toBe(head);
    render([...DAYS, progressOf(TODAY, { withFix: true })]);
    expect(pet("pet-year-head")!.dataset.mood).toBe("tired");
  });

  it("сегодня начат и брошен — спит; Лжец сегодня с первого обвинения — удивлён", () => {
    render([...DAYS, progressOf(TODAY, { solved: false, moves: 4 })]);
    expect(pet("pet-year-head")!.dataset.mood).toBe("asleep");
    render(DAYS, { liar: new Map([[TODAY, LIAR_FIRST]]) });
    expect(pet("pet-year-head")!.dataset.mood).toBe("surprised");
  });

  it("тумблер выкл — в шапке кляксы нет, шестерёнка на месте", () => {
    setPetEnabled(false);
    render(DAYS);
    expect(tid("pet-year-head")).toBeNull();
    expect(tid("open-settings")).not.toBeNull();
  });

  it("прошлый год в выборе года — кляксы «сегодня» нет; вернулись в текущий — есть", () => {
    render([progressOf("2025-12-30"), ...DAYS]);
    expect(tid("pet-year-head")).not.toBeNull();
    click(tid("year-title"));
    click([...document.querySelectorAll('[role="menuitemradio"]')].find((b) => b.textContent === "2025")!);
    expect(tid("pet-year-head")).toBeNull();
    click(tid("year-title"));
    click([...document.querySelectorAll('[role="menuitemradio"]')].find((b) => b.textContent === "2026")!);
    expect(tid("pet-year-head")).not.toBeNull();
  });

  it("тап — «Плюх», лист не открывает, без preventDefault", () => {
    render(DAYS);
    expect(touch(tid("pet-year-head")!)).toBe(false);
    expect(pet("pet-year-head")!.dataset.poke).toBe("A");
    expect(document.querySelector('[data-testid="year-sheet"]')).toBeNull();
  });

  it("под открытым листом клякса шапки замирает (дышит одна — в листе дня); лист закрыт — снова дышит", () => {
    vi.useFakeTimers();
    try {
      render(DAYS);
      click(document.querySelector('.year-month[data-month="8"]'));
      expect(idle("pet-year-head")).toBe(false);
      click(document.querySelector('.ycell[data-date="2026-09-11"]'));
      expect(pet("pet-year")!.dataset.mood).toBe("tired");
      expect([...document.querySelectorAll(".pet[data-idle]")].map((p) => p.parentElement!.closest("[data-testid]")!.getAttribute("data-testid"))).toEqual(["pet-year"]);
      act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      act(() => vi.advanceTimersByTime(1000));
      expect(document.querySelector('[data-testid="year-sheet"]')).toBeNull();
      expect(idle("pet-year-head")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("лист дня Year: зона тапа", () => {
  it("слот 44 — зона «Плюха» (pet-hit), не кнопка и не в порядке фокуса", () => {
    render(DAYS);
    click(document.querySelector('.year-month[data-month="8"]'));
    click(document.querySelector('.ycell[data-date="2026-09-10"]'));
    const zone = tid("pet-year")!;
    expect(zone.classList.contains("pet-slot")).toBe(true);
    expect(zone.classList.contains("pet-hit")).toBe(true);
    expect(zone.hasAttribute("tabindex")).toBe(false);
    expect(zone.getAttribute("role")).toBeNull();
    expect(touch(zone)).toBe(false);
    expect(pet("pet-year")!.dataset.poke).toBe("A");
  });
});
