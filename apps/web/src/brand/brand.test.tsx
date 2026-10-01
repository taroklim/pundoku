// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import iconSvg from "../../public/icons/icon.svg?raw";
import { Mark, MARK_FULL_CELL, MARK_FULL_FIELD, MARK_SMALL_CELL, MARK_SMALL_FIELD, MARK_SMALL_MAX } from "./Mark";
import { Wordmark } from "./Wordmark";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const render = (el: ReactElement) => {
  act(() => root.render(el));
  return host.querySelector("svg")!;
};

describe("Mark (D5 «Унос»)", () => {
  it("порог оптики: <= 60 — 16-сеточная малая геометрия, > 60 — полная", () => {
    expect(MARK_SMALL_MAX).toBe(60);
    for (const size of [16, 29, 56, 60]) {
      const svg = render(<Mark size={size} />);
      expect(svg.dataset.optics, String(size)).toBe("small");
      expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
      const [field, cell] = [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d"));
      expect([field, cell]).toEqual([MARK_SMALL_FIELD, MARK_SMALL_CELL]);
    }
  });

  it("61 px и больше — полная геометрия d5-mark.svg (с вогнутым фелетом r=27)", () => {
    for (const size of [61, 120, 512]) {
      const svg = render(<Mark size={size} />);
      expect(svg.dataset.optics, String(size)).toBe("full");
      const [field, cell] = [...svg.querySelectorAll("path")].map((p) => p.getAttribute("d"));
      expect([field, cell]).toEqual([MARK_FULL_FIELD, MARK_FULL_CELL]);
      expect(field).toContain("A27 27 0 0 0 539 512"); // вогнутый угол выреза
    }
  });

  it("размер задаёт ширину и высоту, заливка — currentColor (цвет задаёт контекст), без анимаций и фильтров", () => {
    const svg = render(<Mark size={56} className="year-empty-mark" />);
    expect(svg.getAttribute("width")).toBe("56");
    expect(svg.getAttribute("height")).toBe("56");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("class")).toBe("year-empty-mark");
    expect(svg.querySelector("animate, animateTransform, filter, style")).toBeNull();
  });

  it("декоративный по умолчанию (aria-hidden, без role), с title — img с именем", () => {
    const deco = render(<Mark size={60} />);
    expect(deco.getAttribute("aria-hidden")).toBe("true");
    expect(deco.getAttribute("role")).toBeNull();
    expect(deco.getAttribute("focusable")).toBe("false");
    const named = render(<Mark size={60} title="Pundoku" />);
    expect(named.getAttribute("role")).toBe("img");
    expect(named.getAttribute("aria-label")).toBe("Pundoku");
    expect(named.getAttribute("aria-hidden")).toBeNull();
  });

  it("малые пути совпадают с public/icons/icon.svg (favicon = тот же знак: источник один)", () => {
    expect(iconSvg).toContain(`d="${MARK_SMALL_FIELD}"`);
    expect(iconSvg).toContain(`d="${MARK_SMALL_CELL}"`);
  });
});

describe("Wordmark", () => {
  it("пропорция 588:116: 28 px высотой = 142 px шириной; 7 букв-штрихов", () => {
    const svg = render(<Wordmark height={28} />);
    expect(svg.getAttribute("height")).toBe("28");
    expect(svg.getAttribute("width")).toBe("142");
    expect(svg.getAttribute("viewBox")).toBe("0 0 588 116");
    expect(svg.querySelectorAll("path")).toHaveLength(7);
    expect(svg.querySelector("text")).toBeNull(); // буквы нарисованы, шрифта нет
  });

  it("«Pun» — чернилами (--pun -> --ink), «doku» — графитом (--doku -> --doku-color)", () => {
    const svg = render(<Wordmark height={28} />);
    expect(svg.style.getPropertyValue("--pun")).toBe("var(--ink)");
    expect(svg.style.getPropertyValue("--doku")).toContain("--doku-color");
    const groups = [...svg.querySelectorAll("g > g")] as SVGGElement[];
    expect(groups).toHaveLength(2);
    expect(groups[0]!.getAttribute("style")).toContain("var(--pun");
    expect(groups[0]!.querySelectorAll("path")).toHaveLength(3); // P u n
    expect(groups[1]!.getAttribute("style")).toContain("var(--doku");
    expect(groups[1]!.querySelectorAll("path")).toHaveLength(4); // d o k u
  });

  it("декоративный по умолчанию, с title — img; анимаций нет", () => {
    const deco = render(<Wordmark height={28} />);
    expect(deco.getAttribute("aria-hidden")).toBe("true");
    expect(deco.querySelector("animate, animateTransform")).toBeNull();
    expect(render(<Wordmark height={28} title="Pundoku" />).getAttribute("role")).toBe("img");
  });
});
