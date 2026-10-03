// @vitest-environment jsdom
/**
 * PD-147 (b): Today (и архив) — тот же нескроллящийся экран с резервом под док подсказки, что и Play (PD-144): корень несёт
 * `play-fit play-hintable` (+ `play-docked` при открытом доке), док не докручивает страницу, карточка результата — снова прокрутка.
 * Раскладку jsdom не считает: живая проверка — design/today-fix-check.mjs (границы поля и заголовка на всех ступенях); тут —
 * классы корня и сторожа по тексту CSS (правила, на которых держится «одна строка» шапки и зазора).
 */
import { dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { fitClassName } from "../play/fitModel";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import { InMemoryProgressRepository } from "./repository";
import { DayView } from "./TodayScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 8, 29, 12, 0);

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const store = () => {
  const deps: DayDeps = {
    repo: new InMemoryProgressRepository(),
    fetchDay: vi.fn(async (d: string) => ({
      ok: true as const,
      puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 58.2 },
    })),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => true,
    slowFetchMs: 50,
  };
  return new DayStore(deps);
};
const q = (sel: string) => host.querySelector<HTMLElement>(sel);
const screen = () => q(".play.today")!;
const tap = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("fitClassName: общий для Play и Today", () => {
  it("партия на экране — нескроллящийся экран; резерв и «док открыт» — по флагам; иначе (карточка) — пусто", () => {
    expect(fitClassName({ fit: true, hintable: false, docked: false })).toBe(" play-fit");
    expect(fitClassName({ fit: true, hintable: true, docked: false })).toBe(" play-fit play-hintable");
    expect(fitClassName({ fit: true, hintable: true, docked: true })).toBe(" play-fit play-hintable play-docked");
    expect(fitClassName({ fit: false, hintable: true, docked: true })).toBe("");
  });
});

describe("PD-147 (b): корень Today", () => {
  it("с первого кадра (загрузка) и в игре: play-fit + play-hintable — поле не прыгает, когда приходит сетка", async () => {
    const s = store();
    await act(async () => root.render(<DayView store={s} />));
    expect(screen().className).toContain("play-fit play-hintable");
    await act(async () => s.ensureStarted());
    await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
    expect(screen().className).toContain("play-fit play-hintable");
    expect(screen().className).not.toContain("play-docked");
  });

  it("лампочка открывает док: play-docked; док не докручивает страницу (scrollIntoView не зовётся); закрытие снимает класс", async () => {
    const s = store();
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    await act(async () => root.render(<DayView store={s} />));
    await act(async () => s.ensureStarted());
    await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
    tap(q('[data-testid="hint-button"]')!);
    const go = document.querySelector<HTMLElement>('[data-testid="hint-rule-go"]'); // шит правила — в портале
    if (go) tap(go);
    await act(async () => vi.waitFor(() => expect(q('[data-testid="hint-dock"]')).not.toBeNull(), { timeout: 5000, interval: 25 }));
    expect(screen().className).toContain("play-docked");
    expect(scroll).not.toHaveBeenCalled();
    tap(q('[data-testid="hint-close"]')!);
    expect(screen().className).not.toContain("play-docked");
    expect(q('[data-testid="hint-dock"]')).toBeNull();
  });

  it("решённый день с показанной карточкой — прокручиваемый экран (без play-fit)", async () => {
    const s = store();
    await act(async () => root.render(<DayView store={s} />));
    await act(async () => s.ensureStarted());
    await act(async () => vi.waitFor(() => expect(s.getSnapshot().phase).toBe("playing"), { timeout: 20000, interval: 25 }));
    const { play } = s.getSnapshot();
    act(() => {
      for (let i = 0; i < 81; i++) {
        if (play!.mission[i]) continue;
        s.select(i);
        s.input(play!.solution[i]!);
      }
    });
    await act(async () => vi.waitFor(() => expect(q('[data-testid="winrate"]')).not.toBeNull(), { timeout: 40000, interval: 25 }));
    expect(screen().className).not.toContain("play-fit");
  }, 60000);
});
