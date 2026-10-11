/**
 * PD-295, #/diag: панель диагностики поверх приложения (обычный DOM, не React — не зависит от состояния экранов и их ошибок).
 * Прозрачна для касаний (`pointer-events: none`), кроме своих трёх кнопок: свайп по месяцам Year сквозь неё идёт в приложение,
 * а числа обновляются вживую (каждые 250 мс и на каждом scroll). Владелец делает ОДИН скриншот после попытки прокрутить Year.
 * Тексты — en (технический экран, без i18n).
 */
import { auditInstalled, counters, labelOf, listenerReport, resetCounters } from "./audit";
import { setDiag } from "./flag";
import { rearmScroll, rearmTotal } from "../shell/rearmScroll";

const r1 = (v: number): string => String(Math.round(v * 10) / 10);

/** Высота/отступ CSS-выражения: временный невидимый блок с таким стилем. */
function probe(css: string, read: (cs: CSSStyleDeclaration, r: DOMRect) => string): string {
  const el = document.createElement("div");
  el.style.cssText = `position:fixed;left:0;top:0;width:1px;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(el);
  const out = read(getComputedStyle(el), el.getBoundingClientRect());
  el.remove();
  return out;
}

const hitAt = (x: number, y: number): string => {
  const el = typeof document.elementFromPoint === "function" ? document.elementFromPoint(x, y) : null;
  return el ? labelOf(el) : "-";
};
const yearPane = (): HTMLElement | null => document.querySelector<HTMLElement>('.tab-pane[data-tab="year"]');

/**
 * Неизменные строки (окружение, вьюпорт, safe-area, шрифт) — считаются при показе и на resize, а не каждые 250 мс: пробные блоки
 * вызывают раскладку, а диагностика не должна сама «чинить» то, что ищет (раскладка панели Year — как раз подозреваемое).
 */
export function collectStatic(): string[] {
  const out: string[] = [];
  const mm = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
  const nav = navigator as Navigator & { standalone?: boolean };
  out.push(`ua ${navigator.userAgent}`);
  out.push(`standalone mm=${mm("(display-mode: standalone)")} nav=${String(nav.standalone)} · motion-reduce=${mm("(prefers-reduced-motion: reduce)")} dark=${mm("(prefers-color-scheme: dark)")}`);
  const vv = window.visualViewport;
  out.push(`inner ${innerWidth}x${innerHeight} · vv h=${vv ? r1(vv.height) : "-"} top=${vv ? r1(vv.offsetTop) : "-"} scale=${vv ? r1(vv.scale) : "-"} · dpr ${devicePixelRatio}`);
  const h = (u: string) => probe(`height:100${u}`, (_cs, r) => r1(r.height));
  out.push(`100dvh=${h("dvh")} 100svh=${h("svh")} 100lvh=${h("lvh")} 100vh=${h("vh")}`);
  const env = probe(
    "padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
    (cs) => `${r1(parseFloat(cs.paddingTop) || 0)}/${r1(parseFloat(cs.paddingRight) || 0)}/${r1(parseFloat(cs.paddingBottom) || 0)}/${r1(parseFloat(cs.paddingLeft) || 0)}`,
  );
  const tabbar = probe("height:var(--tabbar-h)", (_cs, r) => r1(r.height));
  const root = getComputedStyle(document.documentElement);
  out.push(`env sa t/r/b/l=${env} · --sa-top=${root.getPropertyValue("--sa-top").trim() || "-"} --sa-bot=${root.getPropertyValue("--sa-bot").trim() || "-"} --tabbar-h=${tabbar}`);
  out.push(`html font-size=${root.fontSize} data-type=${document.documentElement.dataset.type ?? "-"}`);
  return out;
}

/** Живые строки: панель Year, касания, слушатели. */
export function collectLive(): string[] {
  const out: string[] = [`route ${location.hash || "-"}`];
  const pane = yearPane();
  if (!pane) out.push("year pane: not mounted (open Year)");
  else {
    const cs = getComputedStyle(pane);
    out.push(
      `year pane sh=${pane.scrollHeight} ch=${pane.clientHeight} range=${pane.scrollHeight - pane.clientHeight} st=${r1(pane.scrollTop)} · vis=${cs.visibility} ovY=${cs.overflowY} pb=${cs.paddingBottom}`,
    );
    out.push(
      `  touch-action=${cs.touchAction} overscroll=${cs.overscrollBehaviorY || "-"} inert=${pane.hasAttribute("inert")} transform=${cs.transform} slide=${pane.hasAttribute("data-slide")} cls=${pane.className} rearm=${rearmTotal()}`,
    );
    const months = pane.querySelectorAll<HTMLElement>(".year-month");
    const dec = months[months.length - 1]?.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>(".tabbar")?.getBoundingClientRect();
    if (dec) {
      out.push(`  Dec top=${r1(dec.top)} bottom=${r1(dec.bottom)} · tabbar top=${bar ? r1(bar.top) : "-"} · hit@Dec=${hitAt(dec.left + dec.width / 2, Math.min(dec.top + 8, innerHeight - 1))}`);
    }
    out.push(`  hit@60%=${hitAt(innerWidth / 2, innerHeight * 0.6)}`);
  }

  const c = counters;
  out.push(
    `touch start=${c.touchstart}(prev ${c.touchstartPrevented}) move=${c.touchmove}(cancelable ${c.touchmoveCancelable}, prev ${c.touchmovePrevented}) end=${c.touchend} cancel=${c.touchcancel} · pointercancel=${c.pointercancel} · scroll year=${c.scrollYear} other=${c.scrollOther}`,
  );
  out.push(`last touch ${c.target} · scroller ${c.scroller}`);
  out.push(`  touch-action chain ${c.chain}`);
  if (!auditInstalled()) out.push("listeners: audit off (reload with diag on)");
  else {
    const { global, elements } = listenerReport();
    // Глушить прокрутку может только НЕпассивный touchstart/touchmove/wheel (pointer-события прокрутку не отменяют) — их поимённо.
    const block = global.filter((l) => /^(touchstart|touchmove|wheel|mousewheel|gesture)/.test(l.type) && l.passive !== true);
    const other: Record<string, number> = {};
    for (const l of global) if (!block.includes(l)) other[l.target] = (other[l.target] ?? 0) + l.n;
    out.push(`listeners can-block: ${block.map((l) => `${l.target} ${l.type}${l.capture ? " cap" : ""}${l.passive === false ? " ACTIVE" : " dflt"}${l.n > 1 ? ` x${l.n}` : ""}`).join("; ") || "none"}`);
    out.push(`listeners other: ${Object.entries(other).map(([t, n]) => `${t} x${n}`).join(", ") || "none"} · elements: ${Object.entries(elements).map(([t, n]) => `${t} x${n}`).join(", ") || "none"}`);
  }
  return out;
}

/** Все строки панели — отдельно от отрисовки (юнит-тест в jsdom). */
export const collectDiag = (): string[] => [...collectStatic(), ...collectLive()];

const HUD_ID = "pd-diag";

export function mountHud(): () => void {
  document.getElementById(HUD_ID)?.remove();
  const box = document.createElement("div");
  box.id = HUD_ID;
  box.setAttribute("aria-hidden", "true");
  box.style.cssText = [
    "position:fixed",
    "z-index:2147483000",
    "left:4px",
    "right:4px",
    "top:calc(env(safe-area-inset-top) + 2px)",
    "max-height:50vh",
    "overflow:hidden",
    "pointer-events:none",
    "padding:4px 6px",
    "border-radius:8px",
    "background:rgba(0,0,0,0.78)",
    "color:#fff",
    "font:10px/1.25 ui-monospace,Menlo,monospace",
    "white-space:pre-wrap",
    "word-break:break-all",
    "-webkit-text-size-adjust:100%",
  ].join(";");
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:6px;margin-bottom:3px";
  const text = document.createElement("div");
  const button = (label: string, onTap: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = "pointer-events:auto;font:inherit;color:#000;background:#ffd60a;border:0;border-radius:6px;padding:4px 8px;min-height:28px";
    b.addEventListener("click", onTap);
    bar.appendChild(b);
  };
  button("re-arm Year", () => {
    rearmScroll(yearPane());
    render();
  });
  button("reset counters", () => {
    resetCounters();
    render();
  });
  button("diag off", () => {
    setDiag(false);
    window.location.reload();
  });
  const title = document.createElement("span");
  title.textContent = "PD-295 diag";
  title.style.cssText = "align-self:center;opacity:.7";
  bar.appendChild(title);
  box.append(bar, text);
  document.body.appendChild(box);

  let fixed: string[] = [];
  const safe = (f: () => string[]): string[] => {
    try {
      return f();
    } catch (e) {
      return [`diag error: ${String(e)}`];
    }
  };
  const refreshStatic = () => {
    fixed = safe(collectStatic);
    render();
  };
  function render() {
    text.textContent = [...fixed, ...safe(collectLive)].join("\n");
  }
  refreshStatic();
  const id = window.setInterval(render, 250);
  const onScroll = () => render();
  document.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", refreshStatic);
  window.visualViewport?.addEventListener("resize", refreshStatic);
  return () => {
    window.clearInterval(id);
    document.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", refreshStatic);
    window.visualViewport?.removeEventListener("resize", refreshStatic);
    box.remove();
  };
}
