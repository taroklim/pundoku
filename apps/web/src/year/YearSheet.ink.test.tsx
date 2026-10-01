// @vitest-environment jsdom
/** Year (PD-74): день в чернилах — без отдельного знака на полотне, в шите дня строка «Mode · Ink · N blots». */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { createPlay, enterDigit, setInkMode } from "../play/logic";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import { YearScreen } from "./YearScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";

function inkDay(date: string, blots: number): DayProgress {
  const base = progressOf(date);
  let p = setInkMode(createPlay({ mission: base.play.mission.join(""), solution: base.play.solution.join("") }), true);
  let t = 0;
  let made = 0;
  for (let i = 0; i < 81; i++) {
    if (p.mission[i]) continue;
    t += 1000;
    if (made < blots) {
      p = enterDigit(p, i, (p.solution[i]! % 9) + 1, t);
      made++;
      t += 1000;
      continue;
    }
    p = enterDigit(p, i, p.solution[i]!, t);
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

describe("Year: день в чернилах", () => {
  it("на полотне цвет по обычному правилу качества: чистый день — is-solved, с кляксами — has-corr (как исправления); отдельного знака нет", () => {
    render([inkDay("2026-09-10", 0), inkDay("2026-09-11", 2)]);
    const mark = (d: string) => host.querySelector(`.year-month .ymark[data-date="${d}"]`) as HTMLElement;
    expect(mark("2026-09-10").className).toBe("ymark is-solved");
    expect(mark("2026-09-11").className).toBe("ymark is-solved has-corr");
  });

  it("шит дня: «Mode · Ink · 2 blots» вместо «Corrections», кляксы в карте, подпись", () => {
    render([inkDay("2026-09-11", 2)]);
    openDay("2026-09-11");
    expect(rows()).toContainEqual(["Mode", "Ink · 2 blots"]);
    expect(rows().map((r) => r[0])).not.toContain("Corrections");
    expect(card().querySelectorAll(".heat i.b")).toHaveLength(2);
    expect(card().querySelector(".ink-caption")!.textContent).toBe("Notched cells are blots.");
  });

  it("PD-86: чистый чернильный день — «Ink · clean», а не «Ink · 0 blots» (как «clean» в карточке и PNG), en/uk/ru", async () => {
    render([inkDay("2026-09-11", 0)]);
    openDay("2026-09-11");
    expect(rows()).toContainEqual(["Mode", "Ink · clean"]);
    expect(card().textContent).not.toContain("0 blots");
    await act(() => i18n.changeLanguage("uk"));
    expect(card().querySelector('[data-testid="ink-mode-row"] dd')!.textContent).toBe("Чорнило · чисто");
    await act(() => i18n.changeLanguage("ru"));
    expect(card().querySelector('[data-testid="ink-mode-row"] dd')!.textContent).toBe("Чернила · чисто");
  });

  it("одна клякса — единственное число; uk/ru тоже склоняются", async () => {
    render([inkDay("2026-09-11", 1)]);
    openDay("2026-09-11");
    expect(rows()).toContainEqual(["Mode", "Ink · 1 blot"]);
    await act(() => i18n.changeLanguage("ru"));
    expect(card().querySelector('[data-testid="ink-mode-row"] dd')!.textContent).toBe(i18n.t("ink.yearValue", { count: 1 }));
  });

  it("обычный день не меняется: «Corrections», без строки режима", () => {
    render([progressOf("2026-09-10")]);
    openDay("2026-09-10");
    expect(rows().map((r) => r[0])).toContain("Corrections");
    expect(card().querySelector('[data-testid="ink-mode-row"]')).toBeNull();
    expect(card().querySelector(".ink-caption")).toBeNull();
  });
});
