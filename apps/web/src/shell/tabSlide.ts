import type { RefObject } from "react";
import { createContext, useContext, useLayoutEffect, useRef } from "react";
import type { TabId } from "./tabs";
import { TAB_IDS } from "./tabs";

/**
 * PD-161 (макет PD-158, вариант A «Лента»): переход между вкладками — оба экрана на всю ширину едут одной лентой
 * Today · Play · Year, 300 мс, `--e-ring`. Направление — по порядку вкладок; Today ↔ Year — напрямую (Play не пролетает).
 * Свайпа нет: только тап/клавиши таб-бара. Reduce Motion — кроссфейд 200 мс (источник правды — `--mo` на `:root`, как у
 * всего движения PD-89; `matchMedia` здесь не зовём).
 *
 * Движок — Web Animations API: CSS-анимацию нельзя подхватить с текущего места. Новый тап посреди перехода читает
 * computed transform/opacity видимых экранов и пилюли, отменяет анимации и запускает новые ОТ этого положения.
 * Ввод не блокируется никогда. Только transform/opacity.
 *
 * Главный риск (md §6.2): transform или will-change на предке делает его containing block для `position: fixed` (шиты).
 * Поэтому will-change — только на время перехода, а по концу анимации — `cancel()` (не `commitStyles()`): на панелях не
 * остаётся НИ inline transform, ни opacity.
 */
export const SLIDE_MS = 300;
export const SLIDE_EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const FADE_MS = 200;
export const FADE_EASE = "cubic-bezier(0.2, 0.7, 0.3, 1)";
/** Возврат с экрана поверх вкладки (Settings/справка/архив) на ту же вкладку — прежний M10 fadeRise (6 px, 200 мс × --mk). */
export const RISE_MS = 200;
export const RISE_PX = 6;

/** Атрибут «экран участвует в переходе»: снимает с неактивной панели `visibility: hidden` на время анимации (shell.css). */
export const SLIDE_ATTR = "data-slide";

/** Вкладка показана пользователю (не скрыта под соседней и не под Settings/справкой/архивом). Вне стопки вкладок — true. */
export const TabActiveContext = createContext(true);
export const useTabActive = (): boolean => useContext(TabActiveContext);

interface Pos {
  x: number;
  o: number;
}

const rootVar = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** Reduce Motion: `--mo: 0` (tokens.css). */
export const motionReduced = (): boolean => rootVar("--mo") === "0";

/** Сдвиг по X из computed transform (`none` / `matrix(...)` / `matrix3d(...)`); без DOMMatrix — его нет в jsdom. */
export function translateXOf(transform: string): number {
  const t = /^translateX\((-?[\d.]+)px\)$/.exec(transform.trim());
  if (t) return Number(t[1]);
  const m = /^matrix(3d)?\(([^)]*)\)$/.exec(transform.trim());
  if (!m) return 0;
  const v = (m[2] ?? "").split(",").map(Number);
  const x = m[1] ? v[12] : v[4];
  return Number.isFinite(x) ? (x as number) : 0;
}

function readPos(el: HTMLElement): Pos {
  const cs = getComputedStyle(el);
  const o = parseFloat(cs.opacity);
  return { x: translateXOf(cs.transform), o: Number.isFinite(o) ? o : 1 };
}

const frame = (p: Pos): Keyframe => ({ transform: `translateX(${p.x.toFixed(2)}px)`, opacity: p.o });
const canAnimate = (el: Element): boolean => typeof (el as HTMLElement).animate === "function";

/** Где лежит экран `i`, когда в кадре экран `ref` (вариант A — лента; Reduce Motion — на месте, прозрачный). */
export function offPos(i: number, ref: number, width: number, reduced: boolean): Pos {
  return reduced ? { x: 0, o: 0 } : { x: Math.sign(i - ref) * width, o: 1 };
}

const indexOf = (tab: TabId): number => TAB_IDS.indexOf(tab);

/**
 * Пилюля выбранной вкладки: геометрия — по первой вкладке (пересчёт на resize/Dynamic Type), положение — transform.
 * Пилюля не предок `fixed`-шитов, поэтому её inline transform в покое допустим.
 */
function pillX(bar: HTMLElement, tab: TabId): number {
  const tabs = bar.querySelectorAll<HTMLElement>('[role="tab"]');
  const first = tabs[0];
  const target = tabs[indexOf(tab)];
  return first && target ? target.offsetLeft - first.offsetLeft : 0;
}
function layoutPill(pill: HTMLElement, tab: TabId): void {
  const bar = pill.parentElement;
  const first = bar?.querySelector<HTMLElement>('[role="tab"]');
  if (!bar || !first) return;
  pill.style.width = `${first.offsetWidth}px`;
  pill.style.height = `${first.offsetHeight}px`;
  pill.style.top = `${first.offsetTop}px`;
  pill.style.left = `${first.offsetLeft}px`;
  pill.style.transform = `translateX(${pillX(bar, tab)}px)`;
}

interface Engine {
  tab: TabId;
  covered: boolean;
  /** Экраны, видимые сейчас (в покое — один; в переходе — уходящие и приходящий). */
  visible: Set<TabId>;
  running: Animation[];
  token: number;
}

/**
 * Переход между панелями стопки вкладок. `stack` — контейнер панелей (`[data-tab]`), `pill` — пилюля в таб-баре.
 * `covered` — поверх стопки открыт Settings/справка/архив (у них свой вход, M10): переход не играется.
 */
export function useTabSlide(stack: RefObject<HTMLElement | null>, pill: RefObject<HTMLElement | null>, tab: TabId, covered: boolean): void {
  const engine = useRef<Engine>({ tab, covered, visible: new Set([tab]), running: [], token: 0 });

  // Пилюля: первая раскладка до первой отрисовки и пересчёт при изменении размеров таб-бара (поворот, Dynamic Type).
  useLayoutEffect(() => {
    const el = pill.current;
    if (!el) return;
    layoutPill(el, engine.current.tab);
    const bar = el.parentElement;
    if (!bar || typeof ResizeObserver !== "function") return;
    const ro = new ResizeObserver(() => layoutPill(el, engine.current.tab));
    ro.observe(bar);
    return () => ro.disconnect();
  }, [pill]);

  // Без отмены при размонтировании оболочка исчезла бы вместе с панелями — отменять нечего; анимации держит только движок.
  useLayoutEffect(() => {
    const s = engine.current;
    const from = s.tab;
    const wasCovered = s.covered;
    s.tab = tab;
    s.covered = covered;
    const host = stack.current;
    if (!host) return;
    const paneOf = (id: TabId) => host.querySelector<HTMLElement>(`[data-tab="${id}"]`);

    const cancelAll = () => {
      for (const a of s.running) a.cancel();
      s.running = [];
    };
    const settle = (my: number) => {
      if (my !== s.token) return;
      cancelAll(); // fill:both снимается — на панелях не остаётся transform/opacity (md §6.2)
      for (const id of TAB_IDS) {
        const el = paneOf(id);
        if (!el) continue;
        el.removeAttribute(SLIDE_ATTR);
        el.style.willChange = "";
      }
      s.visible = new Set([s.tab]);
    };
    const run = (anims: Animation[], my: number) => {
      s.running = anims;
      if (anims.length === 0) return settle(my);
      Promise.all(anims.map((a) => a.finished)).then(
        () => settle(my),
        () => undefined, // отменена новым переходом — он и уберёт за собой
      );
    };

    if (from === tab) {
      // Вернулись с экрана поверх (Settings/справка/архив) на ту же вкладку — прежний вход M10 (fadeRise).
      if (!wasCovered || covered) return;
      const el = paneOf(tab);
      if (!el || !canAnimate(el)) return;
      cancelAll();
      const my = ++s.token;
      const mo = Number(rootVar("--mo") || "1");
      const mk = Number(rootVar("--mk") || "1");
      el.style.willChange = "transform, opacity";
      run(
        [
          el.animate([{ opacity: 0, transform: `translateY(${RISE_PX * (Number.isFinite(mo) ? mo : 1)}px)` }, { opacity: 1, transform: "none" }], {
            duration: RISE_MS * (Number.isFinite(mk) ? mk : 1),
            easing: FADE_EASE,
            fill: "both",
          }),
        ],
        my,
      );
      return;
    }

    const pillEl = pill.current;
    if (covered) {
      // Вкладка сменилась под экраном поверх (не бывает в штатных маршрутах) — без анимации.
      cancelAll();
      settle(++s.token);
      if (pillEl) layoutPill(pillEl, tab);
      return;
    }

    // ---------- Слайд from → to ----------
    const reduced = motionReduced();
    const width = host.clientWidth;
    const duration = reduced ? FADE_MS : SLIDE_MS;
    const easing = reduced ? FADE_EASE : SLIDE_EASE;
    // 1. Снимок ТЕКУЩЕГО положения видимых экранов и пилюли — до отмены анимаций. Из-под экрана поверх уходит вкладка-источник.
    const current = new Map<TabId, Pos>();
    for (const id of s.visible) {
      const el = paneOf(id);
      if (el) current.set(id, readPos(el));
    }
    const px0 = pillEl ? translateXOf(getComputedStyle(pillEl).transform) : 0;
    cancelAll();
    const my = ++s.token;

    const anims: Animation[] = [];
    const visible = new Set<TabId>([tab]);
    for (const id of TAB_IDS) {
      const el = paneOf(id);
      if (!el) continue;
      const i = indexOf(id);
      let start: Pos;
      let end: Pos;
      if (id === tab) {
        start = current.get(id) ?? offPos(i, indexOf(from), width, reduced);
        end = { x: 0, o: 1 };
      } else if (current.has(id)) {
        start = current.get(id) as Pos;
        end = offPos(i, indexOf(tab), width, reduced);
        visible.add(id);
      } else continue;
      el.setAttribute(SLIDE_ATTR, "");
      el.style.willChange = "transform, opacity"; // только на время перехода
      if (canAnimate(el)) anims.push(el.animate([frame(start), frame(end)], { duration, easing, fill: "both" }));
    }
    s.visible = visible;

    // 2. Пилюля: та же длительность и кривая; при Reduce Motion — встаёт мгновенно.
    if (pillEl) {
      layoutPill(pillEl, tab);
      const bar = pillEl.parentElement;
      if (!reduced && bar && canAnimate(pillEl)) {
        anims.push(pillEl.animate([{ transform: `translateX(${px0}px)` }, { transform: `translateX(${pillX(bar, tab)}px)` }], { duration, easing }));
      }
    }
    // 3. Риск первого кадра (md §7): скрытая панель разложена, но не нарисована — её отрисовка съедала бы первый кадр движения.
    // Экраны встают в стартовое положение сразу (анимация на паузе, fill both), а движение начинается кадром позже: отрисовка
    // приходится на кадр ДО хода, сам ход идёт ровно. 16 мс невидимы — цвет вкладки уже сменился в момент тапа.
    if (!current.has(tab) && anims.length > 0 && typeof requestAnimationFrame === "function") {
      for (const a of anims) a.pause();
      requestAnimationFrame(() => {
        if (my !== s.token) return;
        for (const a of anims) a.play();
      });
    }
    run(anims, my);
  }, [tab, covered, stack, pill]);
}
