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

/**
 * PD-290: контекстное меню (строка режима, клетка Лжеца) в слое окна десктопа C — не шире `--w-menu` (desk-screens.css) и стоит
 * у своей строки/клетки, а не во всю область контента: левой кромкой по якорю, но не левее области (край затемнения + `gap`) и
 * не правее окна − `gap`. Телефон и компакт без слоя этого не вызывают — там меню, как раньше, во всю ширину.
 */
export function menuLeftInLayer(anchorLeft: number, menuWidth: number, areaLeft: number, viewportWidth: number, gap = 10): number {
  return Math.round(Math.max(areaLeft + gap, Math.min(anchorLeft, viewportWidth - gap - menuWidth)));
}

/**
 * PD-290: начало координат `position: fixed` для элемента внутри затемнения. `backdrop-filter` у `.ctx-scrim` (размытый фон
 * контекстного меню) делает затемнение containing block для fixed-потомков: в слое окна десктопа C затемнение начинается с
 * `--desk-x`, и копия строки/клетки и меню уезжали вправо на ширину сайдбара. Под Reduce Transparency / Increase Contrast
 * размытия нет — координаты снова от окна. Поэтому не угадываем по CSS, а меряем по факту: где элемент оказался минус его
 * `left`/`top`. Без раскладки (jsdom) — (0, 0).
 */
export function fixedOrigin(el: HTMLElement | null): { readonly x: number; readonly y: number } {
  if (!el) return { x: 0, y: 0 };
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return { x: 0, y: 0 };
  const cs = getComputedStyle(el);
  const x = r.left - parseFloat(cs.left) - (parseFloat(cs.marginLeft) || 0);
  const y = r.top - parseFloat(cs.top) - (parseFloat(cs.marginTop) || 0);
  const clean = (v: number) => (Number.isFinite(v) && Math.abs(v) >= 0.5 ? v : 0);
  return { x: clean(x), y: clean(y) };
}
