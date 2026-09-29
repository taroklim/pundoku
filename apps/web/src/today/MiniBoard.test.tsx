// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../i18n";
import { MiniBoard } from "./MiniBoard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MiniBoard (Grid ∞)", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = (props: Partial<Parameters<typeof MiniBoard>[0]> = {}) =>
    act(() =>
      root.render(
        <MiniBoard clues={new Map([[3, 7], [40, 2]])} target={null} landed={false} pulse={false} label="grid" {...props} />,
      ),
    );

  it("показывает открытые клетки как подсказки, остальные пусты", () => {
    render();
    expect(host.querySelectorAll(".cell").length).toBe(81);
    expect(host.querySelectorAll(".d.given").length).toBe(2);
    expect(host.querySelector('[data-i="40"] .d')?.textContent).toBe("2");
    expect(host.querySelector(".board")?.getAttribute("role")).toBe("img");
  });

  it("целевая клетка: пунктир до посадки, сплошное кольцо после (pulse — только при прилёте)", () => {
    render({ target: 12 });
    const cell = () => host.querySelector('[data-i="12"]')!;
    expect(cell().classList.contains("target")).toBe(true);
    expect(cell().classList.contains("landed")).toBe(false);
    render({ target: 12, landed: true, pulse: true });
    expect(cell().classList.contains("landed") && cell().classList.contains("pulse")).toBe(true);
    render({ target: 12, landed: true, pulse: false });
    expect(cell().classList.contains("still") && !cell().classList.contains("pulse")).toBe(true);
    expect(host.querySelectorAll(".target").length).toBe(1);
  });
});
