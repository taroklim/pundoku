// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { HelpScreen } from "./HelpScreen";
import { HELP_BLOCKS } from "./blocks";
import type { HelpBlockId } from "./blocks";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let scrolled: string[];

beforeEach(async () => {
  await i18n.changeLanguage("en");
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.id);
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (block: HelpBlockId | null = null, onBack = () => {}) =>
  act(() => root.render(<HelpScreen block={block} backName="Settings" backLabel="Back to Settings" onBack={onBack} />));

describe("HelpScreen (PD-120)", () => {
  it("заголовок и пять блоков по порядку; каждый — секция с заголовком h2", () => {
    render();
    expect(host.querySelector("h1")!.textContent).toBe("How Pundoku works");
    const ids = [...host.querySelectorAll("section")].map((s) => s.getAttribute("data-testid"));
    expect(ids).toEqual(HELP_BLOCKS.map((b) => `help-${b}`));
    expect([...host.querySelectorAll("h2")].map((h) => h.textContent)).toEqual(["Grid ∞", "Fixes", "Technique reached", "Year marks", "Numbers on the pad"]);
  });

  it("Grid ∞: текст честный — 30–60 клеток; «enough clues» подставлено из метки Today", () => {
    render();
    const text = host.querySelector('[data-testid="help-grid"]')!.textContent!;
    expect(text).toContain("30 to 60");
    expect(text).toContain("“enough clues”");
  });

  it("Technique reached: названия техник из движка", () => {
    render();
    const text = host.querySelector('[data-testid="help-technique"]')!.textContent!;
    for (const name of ["Naked Single", "Hidden Single", "Locked Candidates", "Pairs"]) expect(text).toContain(name);
  });

  it("Year: шесть меток с образцом (как в легенде) и описанием; «with help» остаётся", () => {
    render();
    const rows = [...host.querySelectorAll('[data-testid="help-year"] .help-mark')];
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.querySelector("dt")!.textContent)).toEqual(["Solved", "Fixes", "With help", "Late", "Unfinished", "Missed"]);
    expect(rows.every((r) => r.querySelector("i.ymark") !== null && r.querySelector("dd")!.textContent!.length > 5)).toBe(true);
    expect(rows[2]!.querySelector("i")!.className).toContain("has-help");
  });

  it("ссылка на блок: прокрутка и фокус на заголовок блока; без блока — фокус на h1", () => {
    render("technique");
    expect(scrolled).toEqual(["help-h-technique"]);
    expect(document.activeElement!.id).toBe("help-h-technique");
    render(null);
    // тот же компонент, другой блок — эффект перезапускается
    expect(document.activeElement!.tagName).toBe("H1");
  });

  it("«‹ Settings»: подпись и озвучка из пропсов, нажатие зовёт onBack", () => {
    const onBack = vi.fn();
    render(null, onBack);
    const back = host.querySelector<HTMLButtonElement>('[data-testid="help-back"]')!;
    expect(back.getAttribute("aria-label")).toBe("Back to Settings");
    expect(back.textContent).toBe("Settings");
    act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it.each(["uk", "ru"])("%s: все блоки на месте, без «Corrections»", async (lng) => {
    await i18n.changeLanguage(lng);
    render();
    expect(host.querySelectorAll("section")).toHaveLength(5);
    expect(host.textContent).not.toMatch(/Corrections|help\./);
    await i18n.changeLanguage("en");
  });
});
