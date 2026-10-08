// @vitest-environment jsdom
/**
 * PD-254: WebKit на iOS применяет :active к элементу от касания, только если на нём или на предке есть touchstart-
 * слушатель. Отдельного обработчика у таб-бара нет — условие выполняет корневой слушатель React на контейнере приложения
 * (предок таб-бара). Тест держит это допущение: если React перестанет слушать touchstart на корне, отклик нажатия
 * (`.tab:active`, shell.css) на iPhone пропадёт молча.
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("корень React вешает touchstart на контейнер — предок таб-бара (условие WebKit для :active на touch)", () => {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const types: string[] = [];
  const orig = host.addEventListener.bind(host);
  host.addEventListener = ((type: string, ...rest: [EventListenerOrEventListenerObject, (boolean | AddEventListenerOptions)?]) => {
    types.push(type);
    return orig(type, ...rest);
  }) as typeof host.addEventListener;
  const root = createRoot(host);
  act(() => root.render(createElement("div")));
  expect(types).toContain("touchstart");
  act(() => root.unmount());
  host.remove();
});
