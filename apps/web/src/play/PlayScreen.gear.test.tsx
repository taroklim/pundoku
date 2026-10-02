// @vitest-environment jsdom
// PD-123: шестерёнка есть и на Play (на экране выбора партии, в игре и на карточке «решено»).
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { PlayScreen } from "./PlayScreen";

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

describe("PlayScreen: шестерёнка настроек", () => {
  it("шапка Play содержит шестерёнку, нажатие зовёт onOpenSettings", () => {
    const open = vi.fn();
    act(() => root.render(<PlayScreen onOpenSettings={open} />));
    const gear = host.querySelector<HTMLButtonElement>('header [data-testid="open-settings"]');
    expect(gear).not.toBeNull();
    act(() => gear!.click());
    expect(open).toHaveBeenCalledTimes(1);
  });
});
