// @vitest-environment jsdom
/**
 * PD-295: скрытая диагностика #/diag — включение (адрес, 7 тапов по версии), аудит слушателей, строки панели; маршрута нет ни
 * в навигации (таб-бар, сайдбар), ни в списке маршрутов приложения, ни в манифесте/карте сайта.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { TabBar } from "../shell/TabBar";
import { parseRoute, TAB_IDS } from "../shell/tabs";
import { counters, installListenerAudit, installProbes, isGlobalTarget, labelOf, listenerReport, touchActionChain } from "./audit";
import { consumeDiagHash, DIAG_KEY, DIAG_TAPS, diagEnabled, diagTap, resetDiagTaps, setDiag } from "./flag";
import { collectDiag, mountHud } from "./hud";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  localStorage.clear();
  resetDiagTaps();
});
afterEach(() => {
  window.history.replaceState(null, "", "#/today");
});

describe("PD-295: включение диагностики", () => {
  it("#/diag ставит флаг и уводит на #/year; другие адреса не трогает", () => {
    window.history.replaceState(null, "", "#/today");
    expect(consumeDiagHash()).toBe(false);
    expect(diagEnabled()).toBe(false);
    window.history.replaceState(null, "", "#/diag");
    expect(consumeDiagHash()).toBe(true);
    expect(localStorage.getItem(DIAG_KEY)).toBe("1");
    expect(window.location.hash).toBe("#/year");
  });

  it(`${DIAG_TAPS} тапов по версии за 4 с переключают флаг и перезагружают; медленные тапы — нет`, () => {
    const reload = vi.fn();
    for (let i = 0; i < DIAG_TAPS; i++) diagTap(i * 5000, reload); // по одному в 5 с — окно не набирается
    expect(reload).not.toHaveBeenCalled();
    resetDiagTaps();
    let last: boolean | null = null;
    for (let i = 0; i < DIAG_TAPS; i++) last = diagTap(100_000 + i * 200, reload);
    expect(last).toBe(true);
    expect(diagEnabled()).toBe(true);
    expect(reload).toHaveBeenCalledWith("#/year");
    for (let i = 0; i < DIAG_TAPS; i++) last = diagTap(200_000 + i * 200, reload);
    expect(last).toBe(false);
    expect(diagEnabled()).toBe(false);
  });

  it("setDiag(false) снимает флаг", () => {
    setDiag(true);
    setDiag(false);
    expect(diagEnabled()).toBe(false);
  });
});

describe("PD-295: маршрута diag нет в навигации", () => {
  it("не вкладка и не маршрут приложения: #/diag разбирается как Today", () => {
    expect(TAB_IDS as readonly string[]).not.toContain("diag");
    expect(parseRoute("#/diag")).toEqual({ tab: "today", archiveDate: null, yearDate: null });
  });

  it("таб-бар — три вкладки, ни одна не ведёт в diag", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => root.render(createElement(TabBar, { active: "year", onSelect: () => undefined, onPrewarm: () => undefined, pillRef: { current: null } })));
    const tabs = host.querySelectorAll('[role="tab"]');
    expect(tabs).toHaveLength(3);
    expect(host.innerHTML.toLowerCase()).not.toContain("diag");
    act(() => root.unmount());
    host.remove();
  });
});

describe("PD-295: аудит слушателей и счётчики касаний", () => {
  it("обёртка учитывает touch/pointer/wheel на глобальных целях, снимает при remove, остальное не трогает", () => {
    installProbes();
    installListenerAudit();
    const fn = () => undefined;
    const fn2 = () => undefined;
    document.addEventListener("touchmove", fn, { passive: false });
    document.addEventListener("touchmove", fn2, { passive: false });
    document.addEventListener("click", fn);
    const el = document.createElement("div");
    el.addEventListener("pointerdown", fn);
    let r = listenerReport();
    expect(r.global).toContainEqual({ target: "document", type: "touchmove", capture: false, passive: false, n: 2 });
    document.body.addEventListener("wheel", fn, true);
    expect(listenerReport().global).toContainEqual({ target: "body", type: "wheel", capture: true, passive: null, n: 1 });
    document.body.removeEventListener("wheel", fn, true);
    expect(r.global.some((l) => l.type === "click")).toBe(false);
    expect(r.elements.pointerdown).toBeGreaterThanOrEqual(1);
    document.removeEventListener("touchmove", fn);
    document.removeEventListener("touchmove", fn2);
    document.removeEventListener("click", fn);
    r = listenerReport();
    expect(r.global.some((l) => l.target === "document" && l.type === "touchmove")).toBe(false);
    expect(r.global.some((l) => l.target === "body" && l.type === "wheel")).toBe(false);
  });

  it("метки целей и глобальные цели", () => {
    expect(labelOf(window)).toBe("window");
    expect(labelOf(document)).toBe("document");
    expect(labelOf(document.body)).toBe("body");
    const d = document.createElement("div");
    d.id = "root";
    expect(labelOf(d)).toBe("div#root");
    expect(isGlobalTarget("div#root")).toBe(true);
    expect(isGlobalTarget("button.year-month")).toBe(false);
  });

  it("цепочка touch-action: только значения ≠ auto, от цели до <html>", () => {
    const host = document.createElement("div");
    host.style.touchAction = "pan-y";
    const b = document.createElement("button");
    b.style.touchAction = "manipulation";
    host.appendChild(b);
    document.body.appendChild(host);
    expect(touchActionChain(b)).toMatch(/^button:manipulation < div:pan-y/);
    host.remove();
  });

  it("touchmove считается, отменённый чужим preventDefault — отдельно", () => {
    const win = new EventTarget();
    installProbes(win as unknown as Window, new EventTarget() as unknown as Document);
    const before = { ...counters };
    // На самой цели сначала capture-слушатели (проба, затем «глушитель»), потом обычные — проба отмены видит preventDefault.
    win.addEventListener("touchmove", (e) => e.preventDefault(), true);
    win.dispatchEvent(new Event("touchmove", { cancelable: true }));
    expect(counters.touchmove).toBe(before.touchmove + 1);
    expect(counters.touchmoveCancelable).toBe(before.touchmoveCancelable + 1);
    expect(counters.touchmovePrevented).toBe(before.touchmovePrevented + 1);
  });
});

describe("PD-295: панель диагностики", () => {
  it("строки: окружение, вьюпорт, safe-area, шрифт, панель Year, касания, слушатели", () => {
    const pane = document.createElement("div");
    pane.className = "scroll tab-pane";
    pane.dataset.tab = "year";
    document.body.appendChild(pane);
    const text = collectDiag().join("\n");
    for (const k of ["ua ", "standalone mm=", "inner ", "vv h=", "100dvh=", "100svh=", "100lvh=", "env sa t/r/b/l=", "html font-size=", "year pane sh=", "touch-action=", "overscroll=", "touch start=", "pointercancel=", "listeners can-block:"])
      expect(text, k).toContain(k);
    pane.remove();
    expect(collectDiag().join("\n")).toContain("year pane: not mounted");
  });

  it("панель прозрачна для касаний, кроме своих кнопок; снимается", () => {
    const off = mountHud();
    const box = document.getElementById("pd-diag")!;
    expect(box.style.pointerEvents).toBe("none");
    const buttons = [...box.querySelectorAll("button")];
    expect(buttons.map((b) => b.textContent)).toEqual(["re-arm Year", "reset counters", "diag off"]);
    for (const b of buttons) expect(b.style.pointerEvents).toBe("auto");
    off();
    expect(document.getElementById("pd-diag")).toBeNull();
  });
});
