/**
 * PD-266: состояние оболочки десктопа без браузера (node: ни window, ни matchMedia, ни localStorage) — раскладка прежняя,
 * скрытие сайдбара живёт в памяти до перезагрузки, подписчики узнают об изменениях, одинаковое значение их не будит.
 */
import { describe, expect, it, vi } from "vitest";
import { deskStore, isDeskLayout } from "./desk";

describe("desk без браузера", () => {
  it("без matchMedia — не десктоп (прежняя оболочка)", () => {
    expect(isDeskLayout()).toBe(false);
  });

  it("без localStorage скрытие живёт в памяти; подписчик зовётся только на изменение", () => {
    const fn = vi.fn();
    const off = deskStore.subscribe(fn);
    expect(deskStore.getSnapshot().hidden).toBe(false);
    deskStore.toggleHidden();
    expect(deskStore.getSnapshot().hidden).toBe(true);
    deskStore.setHidden(true);
    expect(fn).toHaveBeenCalledTimes(1);
    deskStore.reset();
    expect(deskStore.getSnapshot().hidden).toBe(true); // перечитано из памяти
    deskStore.showModePage("ink");
    deskStore.showModePage("ink");
    expect(deskStore.getSnapshot().modePage).toBe("ink");
    expect(fn).toHaveBeenCalledTimes(3); // toggle, reset, showModePage
    off();
    deskStore.setHidden(false);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
