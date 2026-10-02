// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { GEAR_PATH, GearIcon } from "./icons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// PD-113: иконка настроек — шестерёнка (зубчатое колесо с отверстием), а не «солнце» (круг + лучи отдельными штрихами).
describe("GearIcon", () => {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<GearIcon />));
  const svg = host.querySelector("svg") as SVGElement;

  it("декоративная, currentColor, штрих как у иконок вкладок", () => {
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("stroke-width")).toBe("1.7");
    expect(svg.getAttribute("fill")).toBe("none");
  });

  it("один замкнутый контур с 8 зубьями + отверстие", () => {
    const paths = svg.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    expect(GEAR_PATH.trim().endsWith("Z")).toBe(true);
    expect(GEAR_PATH.match(/M/g)).toHaveLength(1); // не набор отдельных лучей
    expect(GEAR_PATH.match(/A/g)).toHaveLength(8); // 8 дуг основания между зубьями
    expect(svg.querySelectorAll("circle")).toHaveLength(1);
  });
});
