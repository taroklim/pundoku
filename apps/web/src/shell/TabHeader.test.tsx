// @vitest-environment jsdom
// PD-123: шестерёнка настроек — в шапке каждой из трёх вкладок, один общий компонент.
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { TabHeader } from "./TabHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("TabHeader", () => {
  it("заголовок слева, шестерёнка справа с подписью «Settings»; нажатие открывает Settings", () => {
    const open = vi.fn();
    act(() => root.render(<TabHeader title={<h1 className="title">Play</h1>} onOpenSettings={open} />));
    const gear = host.querySelector<HTMLButtonElement>('[data-testid="open-settings"]')!;
    expect(gear.getAttribute("aria-label")).toBe("Settings");
    expect(host.querySelector("header")!.firstElementChild!.tagName).toBe("H1");
    act(() => gear.click());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("контролы вкладки стоят слева от шестерёнки; без onOpenSettings шестерёнки нет", () => {
    act(() => root.render(<TabHeader title={<h1>Play</h1>} actions={<button data-testid="act">x</button>} onOpenSettings={() => {}} />));
    const end = host.querySelector(".toolbar-end")!;
    expect([...end.children].map((c) => c.getAttribute("data-testid"))).toEqual(["act", "open-settings"]);
    act(() => root.render(<TabHeader title={<h1>Today</h1>} />));
    expect(host.querySelector('[data-testid="open-settings"]')).toBeNull();
  });
});
