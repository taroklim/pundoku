// @vitest-environment jsdom
/**
 * PD-295: перевзвод касательной прокрутки панели (rearmScroll.ts) — только у видимой прокручиваемой панели, позиция сохраняется,
 * inline-стиль возвращается как был; движок вкладок зовёт его по концу перехода.
 */
import { describe, expect, it } from "vitest";
import { rearmScroll, rearmTotal } from "./rearmScroll";

function pane(range: number, overflow = "auto"): { el: HTMLElement; seen: string[] } {
  const el = document.createElement("div");
  el.style.overflowY = overflow;
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => 800 + range });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 800 });
  const seen: string[] = [];
  // Каждая принудительная раскладка (offsetHeight) видит текущий overflow-y — так проверяется, что «выключенное» состояние
  // действительно прошло через раскладку.
  Object.defineProperty(el, "offsetHeight", { configurable: true, get: () => (seen.push(el.style.overflowY), 800) });
  document.body.appendChild(el);
  return { el, seen };
}

describe("PD-295: rearmScroll", () => {
  it("прокручиваемая панель: раскладка с overflow-y hidden, затем прежнее значение; scrollTop сохранён", () => {
    const { el, seen } = pane(46);
    el.scrollTop = 30;
    const n = rearmTotal();
    expect(rearmScroll(el)).toBe(true);
    expect(seen).toEqual(["hidden", "auto"]);
    expect(el.style.overflowY).toBe("auto");
    expect(el.scrollTop).toBe(30);
    expect(rearmTotal()).toBe(n + 1);
    el.remove();
  });

  it("без inline-стиля: после перевзвода inline overflow-y снова пустой (правило берётся из CSS)", () => {
    const { el, seen } = pane(10, "");
    el.style.overflowY = "";
    // jsdom без CSS: computed overflowY пустой — подставляем через класс со стилем
    const st = document.createElement("style");
    st.textContent = ".scrl{overflow-y:auto}";
    document.head.appendChild(st);
    el.className = "scrl";
    expect(rearmScroll(el)).toBe(true);
    expect(seen).toEqual(["hidden", ""]);
    expect(el.style.overflowY).toBe("");
    st.remove();
    el.remove();
  });

  it("не трогает: нечего прокручивать, overflow hidden (хаб/партия Play), нет элемента", () => {
    const a = pane(0);
    expect(rearmScroll(a.el)).toBe(false);
    expect(a.seen).toEqual([]);
    const b = pane(100, "hidden");
    expect(rearmScroll(b.el)).toBe(false);
    expect(b.seen).toEqual([]);
    expect(rearmScroll(null)).toBe(false);
    a.el.remove();
    b.el.remove();
  });
});
