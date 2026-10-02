// @vitest-environment jsdom
/** Year (PD-139): день «с помощью» — клетка has-help, в шите дня «Assist» и «Hints», полые клетки карты по журналу подсказок. */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import { YearScreen } from "./YearScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";

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

function helped(date: string, cells: (number | null)[], hints = cells.length): DayProgress {
  const base = progressOf(date);
  const log = cells.map((cell, i) => ({ t: 500 + i * 100, cell }));
  return { ...base, assisted: true, hints, play: { ...base.play, hintLog: log } };
}

describe("Year: день с подсказкой", () => {
  it("клетка has-help; в шите — строка Hints и полая середина у клеток, к которым вела подсказка", () => {
    const base = progressOf("2026-09-10");
    const empty = base.play.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
    render([helped("2026-09-10", [empty[0]!, null, empty[3]!])]);
    expect((host.querySelector('.year-month .ymark[data-date="2026-09-10"]') as HTMLElement).className).toBe("ymark is-solved has-help");
    openDay("2026-09-10");
    expect(rows()).toContainEqual([i18n.t("solved.hints"), "3"]);
    expect(card().querySelectorAll('.heat i[data-hinted="true"]')).toHaveLength(2);
  });

  it("запись без журнала (с другого устройства): счётчик есть, полых клеток нет", () => {
    render([{ ...progressOf("2026-09-10"), assisted: true, hints: 2 }]);
    openDay("2026-09-10");
    expect(rows()).toContainEqual([i18n.t("solved.hints"), "2"]);
    expect(card().querySelectorAll('.heat i[data-hinted="true"]')).toHaveLength(0);
  });

  it("день без подсказок: ни has-help, ни строки Hints", () => {
    render([progressOf("2026-09-10")]);
    expect((host.querySelector('.year-month .ymark[data-date="2026-09-10"]') as HTMLElement).className).toBe("ymark is-solved");
    openDay("2026-09-10");
    expect(rows().map((r) => r[0])).not.toContain(i18n.t("solved.hints"));
  });
});
