import { createContext, useContext } from "react";

/**
 * PD-267: куда рисуются шиты, меню и тост (`createPortal`). По умолчанию — `<body>`, как всегда (телефон, компакт, тесты экранов
 * без оболочки: DOM прежний). В раскладке с сайдбаром (десктоп C) App подставляет слой `.desk-layer` ВНУТРИ `.shell.desk`: так
 * оверлеи открываются «в контексте окна» — затемнение и шит ложатся на область контента, а не на сайдбар (styles/desk-play.css),
 * и наследуют переменные оболочки (`--desk-x`, `--tabbar-h: 0`). Слой — не containing block (ни transform, ни contain):
 * координаты меню по `getBoundingClientRect()` остаются координатами окна.
 */
export const PortalHostContext = createContext<HTMLElement | null>(null);

/** Контейнер для `createPortal`: слой окна десктопа C или `<body>`. */
export function usePortalHost(): HTMLElement {
  return useContext(PortalHostContext) ?? document.body;
}

/**
 * Модальный слой: `inert` на всех «соседях» цепочки его предков до `<body>` (то, что уже было inert, не трогаем). Возвращает
 * отмену. В `<body>` это ровно «все дети body, кроме слоя»; внутри `.desk-layer` — ещё и сайдбар, стопка вкладок и т. д.
 */
export function inertOutside(el: HTMLElement | null): () => void {
  const inerted: Element[] = [];
  for (let node: HTMLElement | null = el; node && node.parentElement && node !== document.body; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !sibling.hasAttribute("inert")) {
        sibling.setAttribute("inert", "");
        inerted.push(sibling);
      }
    }
  }
  return () => {
    for (const s of inerted) s.removeAttribute("inert");
  };
}
