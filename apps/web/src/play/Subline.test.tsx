// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { Subline } from "./Subline";

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
const text = () => host.querySelector(".subline")!.textContent;

describe("Subline: слово режима в подписи дня (PD-74)", () => {
  it("«Wed 30 Sep · Medium · ink» — пробелы по обе стороны от каждой точки (дефект макета «Medium· Ink»)", async () => {
    await act(() => i18n.changeLanguage("en"));
    act(() => root.render(<Subline day="Wed 30 Sep" difficulty="Medium" ink />));
    expect(text()).toBe("Wed 30 Sep · Medium · ink");
    expect(text()).not.toMatch(/\S·|·\S/);
  });

  it("со временем: слово режима перед таймером; без режима строки как раньше", async () => {
    await act(() => i18n.changeLanguage("en"));
    act(() => root.render(<Subline day="Wed 30 Sep" difficulty="Medium" ink clock="4:12" />));
    expect(text()).toBe("Wed 30 Sep · Medium · ink · 4:12");
    act(() => root.render(<Subline day="Wed 30 Sep" difficulty="Medium" clock="4:12" />));
    expect(text()).toBe("Wed 30 Sep · Medium · 4:12");
    expect(host.querySelector(".inkmark")).toBeNull();
    act(() => root.render(<Subline day="Wed 30 Sep" difficulty={null} />));
    expect(text()).toBe("Wed 30 Sep");
  });

  it("uk/ru: слово режима локализовано", async () => {
    await act(() => i18n.changeLanguage("uk"));
    act(() => root.render(<Subline day="Ср 30 вер" difficulty="Середня" ink />));
    expect(text()).toBe("Ср 30 вер · Середня · чорнило");
    await act(() => i18n.changeLanguage("ru"));
    expect(text()).toBe("Ср 30 вер · Середня · чернила");
    await act(() => i18n.changeLanguage("en"));
  });
});
