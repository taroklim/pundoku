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

describe("Wordmark (PD-152: клеточные P u n, вариант A)", () => {
  it("пропорция 614:116: 28 px высотой = 148 px шириной", () => {
    const svg = render(<Wordmark height={28} />);
    expect(svg.getAttribute("height")).toBe("28");
    expect(svg.getAttribute("width")).toBe("148");
    expect(svg.getAttribute("viewBox")).toBe("0 0 614 116");
    expect(svg.querySelector("text")).toBeNull(); // буквы нарисованы, шрифта нет
    expect(svg.querySelector("animate, animateTransform, filter")).toBeNull();
  });

  it("структура: «Pun» — 23 клетки (P 9 + u 7 + n 7) 23×23 rx 4, «doku» — 4 штриха; путей у «Pun» нет", () => {
    const svg = render(<Wordmark height={28} />);
    const [pun, doku] = [...svg.querySelectorAll<SVGGElement>("g[data-part]")];
    expect(pun!.dataset.part).toBe("pun");
    expect(doku!.dataset.part).toBe("doku");
    const rects = [...pun!.querySelectorAll("rect")];
    expect(rects).toHaveLength(23);
    expect(pun!.querySelectorAll("path")).toHaveLength(0);
    for (const r of rects) {
      expect(r.getAttribute("width")).toBe("23");
      expect(r.getAttribute("height")).toBe("23");
      expect(r.getAttribute("rx")).toBe("4");
    }
    expect(doku!.querySelectorAll("path")).toHaveLength(4); // d o k u (второе «u» — обычное)
    expect(doku!.querySelectorAll("rect")).toHaveLength(0);
    expect(svg.querySelectorAll("rect")).toHaveLength(23);
    expect(svg.querySelectorAll("path")).toHaveLength(4);
  });

  it("снимок геометрии (design/pd141-logo-round5.md §9.1): x/y клеток по буквам и сдвиги «doku»", () => {
    const svg = render(<Wordmark height={28} />);
    const xy = (r: Element) => `${r.getAttribute("x")},${r.getAttribute("y")}`;
    const rects = [...svg.querySelectorAll("rect")].map(xy);
    expect(rects).toEqual([
      "0,96", "27,96", "54,96", "0,123", "54,123", "0,150", "27,150", "54,150", "0,177", // P
      "91,123", "145,123", "91,150", "145,150", "91,177", "118,177", "145,177", // u
      "182,123", "209,123", "236,123", "182,150", "236,150", "182,177", "236,177", // n
    ]);
    expect([...svg.querySelectorAll("path")].map((p) => p.getAttribute("transform"))).toEqual([
      "translate(273 0)",
      "translate(365 0)",
      "translate(457 0)",
      "translate(542 0)",
    ]);
    expect(svg.querySelector("g[transform]")!.getAttribute("transform")).toBe("translate(2 -94)");
  });

  it("цвета через токены: клетки — fill var(--pun) -> --ink, «doku» — stroke var(--doku) -> --doku-color; без currentColor-зависимостей от темы в JS", () => {
    const svg = render(<Wordmark height={28} />);
    expect(svg.style.getPropertyValue("--pun")).toBe("var(--ink)");
    expect(svg.style.getPropertyValue("--doku")).toContain("--doku-color");
    const [pun, doku] = [...svg.querySelectorAll<SVGGElement>("g[data-part]")];
    expect(pun!.getAttribute("style")).toContain("fill: var(--pun");
    expect(doku!.getAttribute("style")).toContain("stroke: var(--doku");
    expect(doku!.getAttribute("fill")).toBe("none");
    expect(doku!.getAttribute("stroke-width")).toBe("22");
    expect(svg.getAttribute("class")).toContain("wordmark");
  });

  it("a11y: по умолчанию role=img + aria-label «Pundoku» на всём логотипе, клетки и буквы внутри aria-hidden", () => {
    const svg = render(<Wordmark height={28} />);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("Pundoku");
    expect(svg.getAttribute("aria-hidden")).toBeNull();
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector("g")!.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("title")).toBeNull();
    // клетки и штрихи достижимы только внутри aria-hidden-группы
    for (const shape of svg.querySelectorAll("rect, path")) expect(shape.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("decorative — aria-hidden без role (рядом есть текст с названием); title переопределяет имя", () => {
    const deco = render(<Wordmark height={28} decorative />);
    expect(deco.getAttribute("aria-hidden")).toBe("true");
    expect(deco.getAttribute("role")).toBeNull();
    expect(deco.getAttribute("aria-label")).toBeNull();
    expect(render(<Wordmark height={28} title="Pundoku!" />).getAttribute("aria-label")).toBe("Pundoku!");
  });

  it("без height размер берётся из CSS-переменной --wordmark-h (28 px по умолчанию), ширина по пропорции", () => {
    const svg = render(<Wordmark />);
    expect(svg.getAttribute("height")).toBeNull();
    expect(svg.style.height).toBe("var(--wordmark-h, 28px)");
    expect(svg.style.width).toBe("auto");
    expect(svg.style.aspectRatio.replace(/\s/g, "")).toBe("614/116");
  });
});
