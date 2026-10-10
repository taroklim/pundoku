// @vitest-environment jsdom
/**
 * PD-267: `inertOutside` — модальность оверлея, живущего не прямо в <body> (слой окна десктопа C внутри `.shell.desk`): inert
 * получают соседи по всей цепочке предков (сайдбар, стопка вкладок, другие порталы, прочие дети body), сам оверлей и его
 * предки — нет; уже inert-элементы не трогаются и после закрытия остаются inert. `usePortalHost` без провайдера — <body>.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { fixedOrigin, inertOutside, menuLeftInLayer, PortalHostContext, usePortalHost } from "./portalHost";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("inertOutside", () => {
  it("в слое окна: соседи по цепочке — inert, сам слой и предки — нет; отмена снимает только своё", () => {
    document.body.innerHTML = `
      <div id="root"><div class="shell"><nav class="sidebar"></nav><main class="stack"></main><div class="tabbar" inert></div>
        <div class="desk-layer"><p class="toast"></p><div class="sheet"></div></div></div></div>
      <div id="other"></div>`;
    const sheet = document.querySelector<HTMLElement>(".sheet")!;
    const undo = inertOutside(sheet);
    const inert = (sel: string) => document.querySelector(sel)!.hasAttribute("inert");
    expect([".sidebar", ".stack", ".tabbar", ".toast", "#other"].map(inert)).toEqual([true, true, true, true, true]);
    expect([".sheet", ".desk-layer", ".shell", "#root"].map(inert)).toEqual([false, false, false, false]);
    undo();
    expect([".sidebar", ".stack", ".toast", "#other"].map(inert)).toEqual([false, false, false, false]);
    expect(inert(".tabbar")).toBe(true); // был inert до открытия — так и остался
  });

  it("прямо в <body> — ровно «все дети body, кроме слоя» (как раньше у шитов)", () => {
    document.body.innerHTML = `<div id="root"></div><div class="sheet"></div><div id="x"></div>`;
    const undo = inertOutside(document.querySelector<HTMLElement>(".sheet"));
    expect(document.getElementById("root")!.hasAttribute("inert")).toBe(true);
    expect(document.getElementById("x")!.hasAttribute("inert")).toBe(true);
    expect(document.querySelector(".sheet")!.hasAttribute("inert")).toBe(false);
    undo();
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });
});

describe("usePortalHost", () => {
  it("без провайдера — <body>; с провайдером — его элемент", () => {
    const layer = document.createElement("div");
    const seen: HTMLElement[] = [];
    const Probe = () => {
      seen.push(usePortalHost());
      return null;
    };
    const host = document.createElement("div");
    document.body.append(host, layer);
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    act(() =>
      root.render(
        <PortalHostContext.Provider value={layer}>
          <Probe />
        </PortalHostContext.Provider>,
      ),
    );
    act(() => root.unmount());
    expect(seen[0]).toBe(document.body);
    expect(seen.at(-1)).toBe(layer);
  });
});

describe("menuLeftInLayer (PD-290)", () => {
  it("левой кромкой по якорю; не левее области контента + 10 и не правее окна − 10", () => {
    // 1920 × 1080, сайдбар: область с 248; меню 320.
    expect(menuLeftInLayer(700, 320, 248, 1920)).toBe(700);
    expect(menuLeftInLayer(100, 320, 248, 1920)).toBe(258);
    expect(menuLeftInLayer(1800, 320, 248, 1920)).toBe(1590);
    // Компакт без сайдбара: область с 0.
    expect(menuLeftInLayer(3.4, 320, 0, 1024)).toBe(10);
  });
});

describe("fixedOrigin (PD-290)", () => {
  const fixedAt = (left: number, top: number, rect: { left: number; top: number; width: number; height: number }) => {
    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    document.body.append(el);
    el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => null });
    return el;
  };
  afterEach(() => document.body.replaceChildren());

  it("затемнение с backdrop-filter — containing block: копия у left 700 оказалась на 948 → начало отсчёта (248, 0)", () => {
    expect(fixedOrigin(fixedAt(700, 300, { left: 948, top: 300, width: 79, height: 79 }))).toEqual({ x: 248, y: 0 });
  });
  it("от окна (телефон, Reduce Transparency) и без раскладки (jsdom) — (0, 0)", () => {
    expect(fixedOrigin(fixedAt(700, 300, { left: 700, top: 300, width: 79, height: 79 }))).toEqual({ x: 0, y: 0 });
    expect(fixedOrigin(fixedAt(700, 300, { left: 0, top: 0, width: 0, height: 0 }))).toEqual({ x: 0, y: 0 });
    expect(fixedOrigin(null)).toEqual({ x: 0, y: 0 });
  });
});
