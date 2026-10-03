// @vitest-environment jsdom
/**
 * PD-144: флаг крупного Dynamic Type для CSS. Размер шрифта читается из раскладки (media-queries его не видят);
 * `data-type="ax3"` ставится с 36 px на 1rem и снимается обратно; типографика им не ограничивается.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AX3_MIN_PX, applyDynamicType, isAx3, useDynamicTypeFlag } from "./dynamicType";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => document.documentElement.removeAttribute("data-type"));

describe("applyDynamicType", () => {
  it("17 и 23 px (по умолчанию и xxxL) — атрибута нет; 40 px (AX3) и крупнее — data-type=ax3; порог 36", () => {
    const html = document.documentElement;
    for (const px of [17, 23, AX3_MIN_PX - 1]) {
      applyDynamicType(html, px);
      expect(html.hasAttribute("data-type"), `${px}`).toBe(false);
    }
    for (const px of [AX3_MIN_PX, 40, 53]) {
      applyDynamicType(html, px);
      expect(html.getAttribute("data-type"), `${px}`).toBe("ax3");
    }
    applyDynamicType(html, 17); // вернули размер — атрибут снимается
    expect(html.hasAttribute("data-type")).toBe(false);
    expect(isAx3(35.9)).toBe(false);
    expect(isAx3(36)).toBe(true);
  });
});

describe("useDynamicTypeFlag", () => {
  const Probe = () => {
    useDynamicTypeFlag();
    return null;
  };

  it("не оставляет зонд и атрибут после размонтирования", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    expect(document.body.querySelectorAll('div[aria-hidden="true"][style*="1rem"]')).toHaveLength(1);
    document.documentElement.setAttribute("data-type", "ax3");
    act(() => root.unmount());
    host.remove();
    expect(document.body.querySelectorAll('div[aria-hidden="true"][style*="1rem"]')).toHaveLength(0);
    expect(document.documentElement.hasAttribute("data-type")).toBe(false);
  });
});
