// @vitest-environment jsdom
/**
 * PD-144: меню «⋯» в шапке партии. Роли и состояния ARIA, фокус (первый пункт, ↑/↓ по кругу, Home/End, ловушка Tab),
 * фон `inert`, Esc и возврат фокуса на «⋯», scrim на весь экран, недоступный пункт «Заполнить кандидатами»
 * (на месте, `aria-disabled`, причина, тап/Enter — no-op), закрытие при размонтировании (смена вкладки).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { FillState } from "./MoreMenu";
import { MoreMenu } from "./MoreMenu";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const onNew = vi.fn();
const onFill = vi.fn();

const button = () => document.querySelector<HTMLButtonElement>('[data-testid="more-button"]')!;
const menu = () => document.querySelector<HTMLElement>('[data-testid="more-menu"]');
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const click = (el: Element) => act(() => void el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init })));
const mount = (fill: FillState = "ready") =>
  act(() =>
    root.render(
      <>
        <header data-testid="behind">
          <MoreMenu fill={fill} onNew={onNew} onFill={onFill} />
        </header>
        <main data-testid="main">
          <button type="button">other</button>
        </main>
      </>,
    ),
  );

beforeEach(async () => {
  await i18n.changeLanguage("en");
  onNew.mockReset();
  onFill.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("кнопка «⋯»", () => {
  it("имя «More», aria-haspopup=menu, aria-expanded следует за состоянием; меню закрыто — пунктов нет", () => {
    mount();
    expect(button().getAttribute("aria-label")).toBe("More");
    expect(button().getAttribute("aria-haspopup")).toBe("menu");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(menu()).toBeNull();
    click(button());
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(menu()!.getAttribute("role")).toBe("menu");
    expect(button().getAttribute("aria-controls")).toBe(menu()!.id);
  });
});

describe("состав и порядок пунктов", () => {
  it("ровно два пункта в фиксированном порядке: «New puzzle», «Fill candidates»; третьего нет", () => {
    mount();
    click(button());
    expect(items().map((i) => i.getAttribute("data-testid"))).toEqual(["menu-new", "menu-fill"]);
    expect(items().map((i) => i.textContent)).toEqual(["New puzzle", "Fill candidates"]);
  });

  it("«New puzzle» закрывает меню и вызывает onNew; «Fill candidates» (доступен) — закрывает и вызывает onFill", () => {
    mount();
    click(button());
    click(items()[0]!);
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
    click(button());
    click(items()[1]!);
    expect(onFill).toHaveBeenCalledTimes(1);
    expect(menu()).toBeNull();
  });
});

describe("недоступный пункт «Fill candidates»", () => {
  it.each([
    ["ink", "Not available in Ink"],
    ["empty", "Nothing to fill in"],
  ] as const)("%s: на месте, aria-disabled, причина «%s»; тап и Enter — no-op, меню остаётся", (fill, why) => {
    mount(fill);
    click(button());
    const fillItem = items()[1]!;
    expect(fillItem.getAttribute("aria-disabled")).toBe("true");
    expect(fillItem.hasAttribute("disabled")).toBe(false); // остаётся фокусируемым (в круге фокуса)
    expect(document.querySelector('[data-testid="menu-fill-why"]')!.textContent).toBe(why);
    click(fillItem);
    fillItem.focus();
    key("Enter");
    expect(onFill).not.toHaveBeenCalled();
    expect(menu()).not.toBeNull();
    expect(items()).toHaveLength(2); // пункт не исчез
  });

  it("доступный пункт: aria-disabled=false и строки-причины нет", () => {
    mount("ready");
    click(button());
    expect(items()[1]!.getAttribute("aria-disabled")).toBe("false");
    expect(document.querySelector('[data-testid="menu-fill-why"]')).toBeNull();
  });
});

describe("клавиатура и фокус", () => {
  it("фокус — на первом пункте; ↓/↑ по кругу, Home/End", () => {
    mount();
    click(button());
    const [a, b] = items();
    expect(document.activeElement).toBe(a);
    key("ArrowDown");
    expect(document.activeElement).toBe(b);
    key("ArrowDown");
    expect(document.activeElement).toBe(a); // по кругу вниз
    key("ArrowUp");
    expect(document.activeElement).toBe(b); // по кругу вверх
    key("Home");
    expect(document.activeElement).toBe(a);
    key("End");
    expect(document.activeElement).toBe(b);
  });

  it("ловушка Tab: вперёд и назад по кругу внутри меню, фокус не уходит на фон", () => {
    mount();
    click(button());
    const [a, b] = items();
    key("Tab");
    expect(document.activeElement).toBe(b);
    key("Tab");
    expect(document.activeElement).toBe(a);
    key("Tab", { shiftKey: true });
    expect(document.activeElement).toBe(b);
  });

  it("фон inert, пока меню открыто; снимается при закрытии", () => {
    mount();
    expect(host.hasAttribute("inert")).toBe(false);
    click(button());
    expect(host.hasAttribute("inert")).toBe(true); // всё приложение (и шапка, и таб-бар) вне круга фокуса
    key("Escape");
    expect(host.hasAttribute("inert")).toBe(false);
  });

  it("Esc закрывает и возвращает фокус на «⋯»; тап по scrim — тоже закрывает, и тоже на «⋯»", () => {
    mount();
    click(button());
    key("Escape");
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button());
    click(button());
    click(document.querySelector('[data-testid="more-scrim"]')!);
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("тап внутри меню (не по пункту) его не закрывает", () => {
    mount();
    click(button());
    click(menu()!);
    expect(menu()).not.toBeNull();
  });
});

describe("слой на весь экран и смена вкладки", () => {
  it("scrim живёт в <body>, а не внутри шапки: накрывает экран целиком, включая таб-бар", () => {
    mount();
    click(button());
    const scrim = document.querySelector('[data-testid="more-scrim"]')!;
    expect(scrim.parentElement).toBe(document.body);
    expect(document.querySelector('[data-testid="behind"]')!.contains(scrim)).toBe(false);
  });

  it("смена вкладки (экран размонтируется) закрывает меню и снимает inert", () => {
    mount();
    click(button());
    expect(menu()).not.toBeNull();
    act(() =>
      root.render(
        <main data-testid="main">
          <button type="button">other tab</button>
        </main>,
      ),
    );
    expect(menu()).toBeNull();
    expect(document.querySelector('[data-testid="more-scrim"]')).toBeNull();
    expect(host.hasAttribute("inert")).toBe(false);
  });
});
