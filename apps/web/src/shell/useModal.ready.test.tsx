// @vitest-environment jsdom
/**
 * PD-182 (QA PD-178): контекстные меню (`AccuseMenu` Лжеца, `ModeMenu` хаба) первый проход рендерят с `visibility:hidden`
 * до позиционирования. Браузер не фокусирует невидимый элемент — фокус уходил на <body>. jsdom этого не проверяет, поэтому
 * `focus()` здесь ведёт себя как в браузере: на элементе с невидимым предком — no-op. После открытия фокус обязан быть на
 * пункте меню, а при закрытии — вернуться на открывший элемент.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { AccuseMenu } from "../play/AccuseMenu";
import { ModeMenu } from "../play/ModeMenu";
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

beforeEach(() => {
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    if (hidden(this)) return; // как браузер: невидимый элемент фокус не принимает
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

const cases = [
  {
    name: "AccuseMenu",
    menu: '[data-testid="accuse-menu"]',
    el: () => <AccuseMenu cell={10} digit={5} anchor={ANCHOR} onAccuse={vi.fn()} onClose={vi.fn()} returnFocus={returnFocus} />,
  },
  {
    name: "ModeMenu",
    menu: '[data-testid="ctx-menu"]',
    el: () => (
      <ModeMenu
        mode={MODES[0]!}
        anchor={ANCHOR}
        preview={<span>row</span>}
        canContinue
        onContinue={vi.fn()}
        onNew={vi.fn()}
        onClose={vi.fn()}
        returnFocus={returnFocus}
      />
    ),
  },
];

describe("PD-182: фокус в контекстном меню после открытия", () => {
  for (const c of cases) {
    it(`${c.name}: фокус на первом пункте видимого меню, при закрытии — обратно на открывший элемент`, () => {
      act(() => root.render(c.el()));
      const menu = document.querySelector<HTMLElement>(c.menu)!;
      expect(menu.style.visibility).toBe("visible");
      const first = menu.querySelector<HTMLElement>('[role="menuitem"]')!;
      expect(document.activeElement).toBe(first);
      expect(document.activeElement).not.toBe(document.body);

      act(() => root.render(<></>));
      expect(document.querySelector(c.menu)).toBeNull();
      expect(document.activeElement).toBe(opener);
    });
  }
});
