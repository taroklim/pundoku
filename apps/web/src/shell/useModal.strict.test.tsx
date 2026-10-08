// @vitest-environment jsdom
/**
 * PD-185 (QA PD-183): в dev под `<React.StrictMode>` эффекты слоя прогоняются дважды (mount → симулированный unmount →
 * remount). Флаг «начальный фокус уже поставлен» переживал симулированный unmount, а cleanup основного эффекта при этом
 * возвращал фокус на открывший элемент — после remount слой оставался без фокуса (MoreMenu/ModeSheet). Проверяем и обычных
 * потребителей `useModal`, и ready-потребителей (PD-182: AccuseMenu/ModeMenu): после открытия фокус внутри слоя.
 * `focus()` — как в браузере: на элементе с невидимым предком — no-op.
 */
import { StrictMode, act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { AccuseMenu } from "../play/AccuseMenu";
import { ModeMenu } from "../play/ModeMenu";
import { ModeSheet } from "../play/ModeSheet";
import { MoreMenu } from "../play/MoreMenu";
import { MODES } from "../play/modes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ANCHOR = { top: 100, bottom: 140, left: 20, width: 40, height: 40 };
const realFocus = HTMLElement.prototype.focus;
let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;
const returnFocus = { current: null as HTMLElement | null };

const hidden = (el: HTMLElement | null): boolean => {
  for (let n = el; n; n = n.parentElement) if (n.style.visibility === "hidden") return true;
  return false;
};
const strict = (node: ReactNode) => act(() => root.render(<StrictMode>{node}</StrictMode>));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (hidden(this)) return;
    realFocus.call(this, options);
  };
  opener = document.createElement("button");
  opener.textContent = "opener";
  document.body.appendChild(opener);
  opener.focus();
  returnFocus.current = opener;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  opener.remove();
  HTMLElement.prototype.focus = realFocus;
});

describe("PD-185: начальный фокус слоя под StrictMode", () => {
  it("MoreMenu (обычный потребитель): фокус на первом пункте, при закрытии — на «⋯»", () => {
    strict(<MoreMenu fill="ready" onNew={vi.fn()} onFill={vi.fn()} />);
    const btn = document.querySelector<HTMLButtonElement>('[data-testid="more-button"]')!;
    act(() => void btn.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const menu = document.querySelector<HTMLElement>('[data-testid="more-menu"]')!;
    expect(menu).not.toBeNull();
    expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'));
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
    expect(document.querySelector('[data-testid="more-menu"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it("ModeSheet (обычный потребитель, initialFocus): фокус на «Начать» (PD-232: отбрасывать нечего), при закрытии — на открывший элемент", () => {
    strict(<ModeSheet mode={MODES[0]!} pick={MODES[0]!.difficulties[0]!} discard={null} onPick={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} returnFocus={returnFocus} />);
    expect(document.activeElement).toBe(document.querySelector('[data-testid="sheet-start"]'));
    act(() => root.render(<StrictMode />));
    expect(document.activeElement).toBe(opener);
  });

  const ready = [
    {
      name: "AccuseMenu",
      menu: '[data-testid="accuse-menu"]',
      el: () => <AccuseMenu cell={10} digit={5} anchor={ANCHOR} onAccuse={vi.fn()} onClose={vi.fn()} returnFocus={returnFocus} />,
    },
    {
      name: "ModeMenu",
      menu: '[data-testid="ctx-menu"]',
      el: () => (
        <ModeMenu mode={MODES[0]!} anchor={ANCHOR} preview={<span>row</span>} canContinue onContinue={vi.fn()} onNew={vi.fn()} onClose={vi.fn()} returnFocus={returnFocus} />
      ),
    },
  ];
  for (const c of ready) {
    it(`${c.name} (ready-потребитель): фокус на первом пункте видимого меню, при закрытии — на открывший элемент`, () => {
      strict(c.el());
      const menu = document.querySelector<HTMLElement>(c.menu)!;
      expect(menu.style.visibility).toBe("visible");
      expect(document.activeElement).toBe(menu.querySelector('[role="menuitem"]'));
      act(() => root.render(<StrictMode />));
      expect(document.querySelector(c.menu)).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  }
});
