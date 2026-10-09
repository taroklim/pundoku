// @vitest-environment jsdom
/**
 * PD-267: `inertOutside` — модальность оверлея, живущего не прямо в <body> (слой окна десктопа C внутри `.shell.desk`): inert
 * получают соседи по всей цепочке предков (сайдбар, стопка вкладок, другие порталы, прочие дети body), сам оверлей и его
 * предки — нет; уже inert-элементы не трогаются и после закрытия остаются inert. `usePortalHost` без провайдера — <body>.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { inertOutside, PortalHostContext, usePortalHost } from "./portalHost";

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
