// @vitest-environment jsdom
/** Year (PD-210, макет PD-209 Year A): день Фонаря — без отдельного знака на полотне, в шите дня строка «Mode · Lantern». */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { createPlay, enterDigit, setLanternMode } from "../play/logic";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import { YearScreen } from "./YearScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";

function lanternDay(date: string, solve = true): DayProgress {
  const base = progressOf(date);
  let p = setLanternMode(createPlay({ mission: base.play.mission.join(""), solution: base.play.solution.join("") }));
  let t = 0;
  for (let i = 0; i < 81; i++) {
    if (p.mission[i]) continue;
    t += 1000;
    p = enterDigit(p, i, p.solution[i]!, t);
    if (!solve) break;
  }
  return { ...base, play: p, elapsedMs: t, solved: p.solved };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (days: DayProgress[]) =>
  act(() => root.render(<YearScreen days={days} firstUse="2026-09-01" today={TODAY} onOpenToday={vi.fn()} onPlayDay={vi.fn()} />));
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const openDay = (date: string) => {
  click(host.querySelector('.year-month[data-month="8"]'));
  click(document.querySelector(`.ycell[data-date="${date}"]`));
};
const card = () => document.querySelector('[data-testid="day-card"]') as HTMLElement;
const rows = () => [...card().querySelectorAll(".rows .row")].map((r) => [r.querySelector("dt")!.textContent, r.querySelector("dd")!.textContent]);

describe("Year: день Фонаря", () => {
  it("на полотне знака нет — обычный класс качества", () => {
    render([lanternDay("2026-09-10")]);
    const mark = host.querySelector(`.year-month .ymark[data-date="2026-09-10"]`) as HTMLElement;
    expect(mark.className).toBe("ymark is-solved");
  });

  it("шит дня: строка «Mode · Lantern» (en/uk/ru); у обычного дня её нет", async () => {
    render([lanternDay("2026-09-11"), { ...progressOf("2026-09-12") }]);
    openDay("2026-09-11");
    expect(rows()).toContainEqual(["Mode", "Lantern"]);
    await act(() => i18n.changeLanguage("uk"));
    expect(rows()).toContainEqual(["Режим", "Ліхтар"]);
    await act(() => i18n.changeLanguage("ru"));
    expect(rows()).toContainEqual(["Режим", "Фонарь"]);
    await act(() => i18n.changeLanguage("en"));
  });

  it("незаконченный день Фонаря — строка режима тоже есть", () => {
    render([lanternDay("2026-09-11", false)]);
    openDay("2026-09-11");
    expect(rows()).toContainEqual(["Mode", "Lantern"]);
  });
});
