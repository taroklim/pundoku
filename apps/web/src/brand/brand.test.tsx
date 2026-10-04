// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import iconSvg from "../../public/icons/icon.svg?raw";
import {
  Mark,
  MARK_CELLS_MIN,
  MARK_FULL_BOX,
  MARK_FULL_CELLS,
  MARK_FULL_CELL_SIZE,
  MARK_FULL_RX,
  MARK_FULL_STEP,
  MARK_FULL_VIEWBOX,
  MARK_PATTERN,
  MARK_SMALL_CELLS,
  MARK_SMALL_CELL_SIZE,
  MARK_SMALL_MAX,
  MARK_SMALL_STEP,
  MARK_SOLID_PATH,
} from "./Mark";
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

const xy = (r: Element) => `${r.getAttribute("x")},${r.getAttribute("y")}`;

describe("Mark (P4 «Девять клеток», PD-155)", () => {
  it("раскладка 3 + 2 + 3 + 1 = ровно девять клеток; контрформа — пустая клетка (строка 2, столбец 2)", () => {
    expect(MARK_PATTERN).toEqual(["XXX", "X.X", "XXX", "X.."]);
    expect(MARK_FULL_CELLS).toHaveLength(9);
    expect(MARK_SMALL_CELLS).toHaveLength(9);
    expect(MARK_PATTERN.map((r) => [...r].filter((c) => c === "X").length)).toEqual([3, 2, 3, 1]);
    // клетки (439, 356) в полной и (7, 5) в малой геометрии нет — это и есть контрформа буквы
    expect(MARK_FULL_CELLS.some((c) => c.x === 439 && c.y === 356)).toBe(false);
    expect(MARK_SMALL_CELLS.some((c) => c.x === 7 && c.y === 5)).toBe(false);
  });

  it("снимок полной геометрии (pd141-logo-round4.md §2): столбцы 272/439/606, строки 189/356/523/690, клетка 146, зазор 21, rx 30", () => {
    expect(MARK_FULL_CELL_SIZE).toBe(146);
    expect(MARK_FULL_RX).toBe(30);
    expect(MARK_FULL_STEP - MARK_FULL_CELL_SIZE).toBe(21); // зазор
    expect(MARK_FULL_CELLS.map((c) => `${c.x},${c.y}`)).toEqual([
      "272,189", "439,189", "606,189",
      "272,356", "606,356",
      "272,523", "439,523", "606,523",
      "272,690",
    ]);
    const xs = new Set(MARK_FULL_CELLS.map((c) => c.x));
    const ys = new Set(MARK_FULL_CELLS.map((c) => c.y));
    expect([...xs]).toEqual([272, 439, 606]);
    expect([...ys]).toEqual([189, 356, 523, 690]);
    // габарит: x 272..752, y 189..836
    expect(Math.max(...MARK_FULL_CELLS.map((c) => c.x + 146))).toBe(MARK_FULL_BOX.x + MARK_FULL_BOX.w);
    expect(Math.max(...MARK_FULL_CELLS.map((c) => c.y + 146))).toBe(MARK_FULL_BOX.y + MARK_FULL_BOX.h);
  });

  it("запас до круга maskable (радиус 409.6): дальняя точка 391.3 — дуга клетки-ножки; запас 18.3 (в макете round 4 заявлено 19.1 по верхнему правому углу 390.5)", () => {
    // самая дальняя точка знака от центра канвы: дуга скругления верхней правой клетки; центр дуги = угол клетки, сдвинутый на rx внутрь
    let far = 0;
    for (const c of MARK_FULL_CELLS) {
      for (const [ax, ay] of [[c.x + 30, c.y + 30], [c.x + 116, c.y + 30], [c.x + 30, c.y + 116], [c.x + 116, c.y + 116]] as const) {
        far = Math.max(far, Math.hypot(ax - 512, ay - 512) + 30);
      }
    }
    expect(far).toBeCloseTo(391.3, 1);
    expect(409.6 - far).toBeGreaterThan(18);
    // верхний правый угол, о котором говорит макет: 390.5
    const tr = MARK_FULL_CELLS.find((c) => c.x === 606 && c.y === 189)!;
    expect(Math.hypot(tr.x + 116 - 512, tr.y + 30 - 512) + 30).toBeCloseTo(390.5, 1);
  });

  it("снимок 16-сетки: клетки 3×3 в (3,1)(7,1)(11,1) / (3,5)(11,5) / (3,9)(7,9)(11,9) / (3,13), зазоры 1; сплошная — 4 прямоугольника одним контуром", () => {
    expect(MARK_SMALL_CELL_SIZE).toBe(3);
    expect(MARK_SMALL_CELLS.map((c) => `${c.x},${c.y}`)).toEqual(["3,1", "7,1", "11,1", "3,5", "11,5", "3,9", "7,9", "11,9", "3,13"]);
    expect(MARK_SMALL_STEP - MARK_SMALL_CELL_SIZE).toBe(1);
    for (const c of MARK_SMALL_CELLS) expect(Number.isInteger(c.x) && Number.isInteger(c.y)).toBe(true);
    // сплошная: внешний контур стойка + перекладина + стенка + донце, контрформа 5×3 (x 6..11, y 4..7)
    expect(MARK_SOLID_PATH).toBe("M3 1H14V10H6V15H3ZM6 4V7H11V4Z");
  });

  it("оптики по размеру: < 24 — сплошная (path), 24..60 — клетки на 16-сетке, > 60 — клетки со скруглением на канве 1024; порог 60 прежний", () => {
    expect(MARK_SMALL_MAX).toBe(60);
    expect(MARK_CELLS_MIN).toBe(24);
    for (const size of [16, 20, 23]) {
      const svg = render(<Mark size={size} />);
      expect(svg.dataset.optics, String(size)).toBe("solid");
      expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
      expect(svg.querySelectorAll("rect")).toHaveLength(0);
      expect([...svg.querySelectorAll("path")].map((p) => p.getAttribute("d"))).toEqual([MARK_SOLID_PATH]);
    }
    for (const size of [24, 29, 32, 56, 60]) {
      const svg = render(<Mark size={size} />);
      expect(svg.dataset.optics, String(size)).toBe("small");
      expect(svg.getAttribute("viewBox")).toBe("0 0 16 16");
      const rects = [...svg.querySelectorAll("rect")];
      expect(rects, String(size)).toHaveLength(9);
      expect(rects.map(xy)).toEqual(MARK_SMALL_CELLS.map((c) => `${c.x},${c.y}`));
      for (const r of rects) {
        expect(r.getAttribute("width")).toBe("3");
        expect(r.getAttribute("height")).toBe("3");
        expect(r.getAttribute("rx")).toBeNull();
      }
      expect(svg.querySelectorAll("path")).toHaveLength(0);
    }
    for (const size of [61, 120, 512]) {
      const svg = render(<Mark size={size} />);
      expect(svg.dataset.optics, String(size)).toBe("full");
      expect(svg.getAttribute("viewBox")).toBe(MARK_FULL_VIEWBOX);
      const rects = [...svg.querySelectorAll("rect")];
      expect(rects).toHaveLength(9);
      expect(rects.map(xy)).toEqual(MARK_FULL_CELLS.map((c) => `${c.x},${c.y}`));
      for (const r of rects) {
        expect(r.getAttribute("width")).toBe("146");
        expect(r.getAttribute("rx")).toBe("30");
      }
    }
  });

  it("размер задаёт ширину и высоту, заливка — currentColor (цвет задаёт контекст), класс brand-mark для forced-colors/печати, без анимаций и фильтров", () => {
    const svg = render(<Mark size={56} className="year-empty-mark" />);
    expect(svg.getAttribute("width")).toBe("56");
    expect(svg.getAttribute("height")).toBe("56");
    expect(svg.getAttribute("fill")).toBe("currentColor");
    expect(svg.getAttribute("class")).toBe("brand-mark year-empty-mark");
    expect(render(<Mark size={56} />).getAttribute("class")).toBe("brand-mark");
    expect(svg.querySelector("animate, animateTransform, filter, style, linearGradient")).toBeNull();
    expect(svg.querySelector("[fill-opacity], [opacity]")).toBeNull(); // reduced-transparency нечего ломать
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

  it("клетки совпадают с public/icons/icon.svg (favicon = тот же знак: источник один)", () => {
    const doc = new DOMParser().parseFromString(iconSvg, "image/svg+xml");
    expect(doc.documentElement.getAttribute("viewBox")).toBe("0 0 16 16");
    const rects = [...doc.querySelectorAll("rect")];
    expect(rects.map(xy)).toEqual(MARK_SMALL_CELLS.map((c) => `${c.x},${c.y}`));
    for (const r of rects) expect([r.getAttribute("width"), r.getAttribute("height")]).toEqual(["3", "3"]);
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
