/**
 * PD-295, #/diag: что может глушить касательную прокрутку — видно на одном скриншоте владельца.
 *  - аудит слушателей touch/pointer/wheel/gesture: обёртка `EventTarget.prototype.addEventListener/removeEventListener`,
 *    ставится ДО загрузки кода приложения (diag/boot.ts — первый импорт main.tsx) и только при включённом флаге;
 *  - счётчики событий: touchstart/touchmove (сколько отменяемых и сколько отменено чьим-то preventDefault), pointercancel
 *    (iOS шлёт его, когда браузер забрал жест под прокрутку), события scroll панели Year и прочих контейнеров;
 *  - касание: цель, ближайший контейнер прокрутки и цепочка touch-action от цели до <html> (только значения ≠ auto).
 * Собственные слушатели диагностики пассивные и в аудит не попадают (ставятся оригинальным addEventListener).
 */
export interface ListenerRec {
  target: string;
  type: string;
  capture: boolean;
  /** `null` — passive не указан явно (у touchstart/touchmove/wheel на window/document/html/body браузер считает его true). */
  passive: boolean | null;
  /** Сколько разных функций сейчас висит с этими target/type/capture. */
  n: number;
}

const TYPES = /^(touch|pointer|wheel|mousewheel|gesture)/;

export function labelOf(t: unknown): string {
  if (typeof window !== "undefined" && t === window) return "window";
  if (typeof document !== "undefined" && t === document) return "document";
  if (typeof Element !== "undefined" && t instanceof Element) {
    if (t === document.documentElement) return "html";
    if (t === document.body) return "body";
    const cls = typeof t.className === "string" ? t.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
    return t.tagName.toLowerCase() + (t.id ? `#${t.id}` : "") + cls.map((c) => `.${c}`).join("");
  }
  return "?";
}

const GLOBAL = new Set(["window", "document", "html", "body", "div#root"]);
/** Глобальная цель: window/document/html/body/#root — то, что может перехватить жест на любом экране. */
export const isGlobalTarget = (label: string): boolean => GLOBAL.has(label);

interface Entry {
  rec: Omit<ListenerRec, "n">;
  fns: Set<unknown>;
}
const entries = new Map<string, Entry>();
let installed = false;

function optsOf(o: unknown): { capture: boolean; passive: boolean | null } {
  if (typeof o === "boolean") return { capture: o, passive: null };
  if (o && typeof o === "object") {
    const x = o as { capture?: boolean; passive?: boolean };
    return { capture: !!x.capture, passive: typeof x.passive === "boolean" ? x.passive : null };
  }
  return { capture: false, passive: null };
}

/** Обернуть add/removeEventListener (один раз). `proto` — для тестов. */
export function installListenerAudit(proto: EventTarget = EventTarget.prototype): void {
  if (installed) return;
  installed = true;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | AddEventListenerOptions) {
    if (fn && TYPES.test(type)) {
      const { capture, passive } = optsOf(o);
      const target = labelOf(this);
      const key = `${target}|${type}|${capture}`;
      const e = entries.get(key) ?? { rec: { target, type, capture, passive }, fns: new Set() };
      if (passive !== null) e.rec.passive = passive;
      e.fns.add(fn);
      entries.set(key, e);
    }
    return add.call(this, type, fn, o);
  };
  proto.removeEventListener = function (this: EventTarget, type: string, fn: EventListenerOrEventListenerObject | null, o?: boolean | EventListenerOptions) {
    if (fn && TYPES.test(type)) {
      const key = `${labelOf(this)}|${type}|${optsOf(o).capture}`;
      const e = entries.get(key);
      if (e) {
        e.fns.delete(fn);
        if (e.fns.size === 0) entries.delete(key);
      }
    }
    return remove.call(this, type, fn, o);
  };
}

export const auditInstalled = (): boolean => installed;

/** Активные слушатели: глобальные — по одному, остальные (элементы) — сводкой по типу. */
export function listenerReport(): { global: ListenerRec[]; elements: Record<string, number> } {
  const global: ListenerRec[] = [];
  const elements: Record<string, number> = {};
  for (const { rec, fns } of entries.values()) {
    if (isGlobalTarget(rec.target)) global.push({ ...rec, n: fns.size });
    else elements[rec.type] = (elements[rec.type] ?? 0) + fns.size;
  }
  global.sort((a, b) => (a.target + a.type).localeCompare(b.target + b.type));
  return { global, elements };
}

// ---------- счётчики событий ----------
export interface Counters {
  touchstart: number;
  touchstartPrevented: number;
  touchmove: number;
  touchmoveCancelable: number;
  touchmovePrevented: number;
  touchend: number;
  touchcancel: number;
  pointercancel: number;
  scrollYear: number;
  scrollOther: number;
  /** Цель последнего касания. */
  target: string;
  /** Ближайший контейнер прокрутки от цели касания: метка и диапазон (scrollHeight − clientHeight) в момент касания. */
  scroller: string;
  /** Цепочка touch-action от цели до <html>, только значения ≠ auto. */
  chain: string;
}
export const counters: Counters = blank();
function blank(): Counters {
  return { touchstart: 0, touchstartPrevented: 0, touchmove: 0, touchmoveCancelable: 0, touchmovePrevented: 0, touchend: 0, touchcancel: 0, pointercancel: 0, scrollYear: 0, scrollOther: 0, target: "-", scroller: "-", chain: "-" };
}
export function resetCounters(): void {
  Object.assign(counters, blank());
}

/** Цепочка touch-action от `el` вверх до <html>: «метка:значение» только там, где значение не auto. */
export function touchActionChain(el: Element | null): string {
  const out: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const ta = getComputedStyle(n).touchAction;
    if (ta && ta !== "auto") out.push(`${labelOf(n)}:${ta}`);
  }
  return out.join(" < ") || "all auto";
}

function nearestScroller(el: Element | null): string {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const cs = getComputedStyle(n);
    if (cs.overflowY === "auto" || cs.overflowY === "scroll") return `${labelOf(n)} range=${n.scrollHeight - n.clientHeight} st=${Math.round(n.scrollTop)} vis=${cs.visibility}`;
  }
  return "none";
}

const isYearPane = (t: EventTarget | null): boolean => t instanceof Element && t.matches('.tab-pane[data-tab="year"]');

const probed = new WeakSet<object>();
/**
 * Пассивные слушатели-счётчики. Ставить ДО `installListenerAudit` — тогда сами в аудит не попадают. `win` — цель касаний
 * (window; в тестах — подставная, jsdom vitest не доводит события до глобального window).
 */
export function installProbes(win: Pick<Window, "addEventListener"> = window, doc: Pick<Document, "addEventListener"> = document): void {
  if (probed.has(win)) return;
  probed.add(win);
  const cap = { capture: true, passive: true } as const;
  win.addEventListener(
    "touchstart",
    (e) => {
      counters.touchstart++;
      const t = e.target instanceof Element ? e.target : null;
      counters.target = t ? labelOf(t) : "-";
      counters.scroller = nearestScroller(t);
      counters.chain = touchActionChain(t);
    },
    cap,
  );
  win.addEventListener(
    "touchmove",
    (e) => {
      counters.touchmove++;
      if (e.cancelable) counters.touchmoveCancelable++;
    },
    cap,
  );
  // Всплытие на window — последним: видно, отменил ли кто-то касание (preventDefault глушит прокрутку).
  win.addEventListener("touchstart", (e) => void (e.defaultPrevented && counters.touchstartPrevented++), { passive: true });
  win.addEventListener("touchmove", (e) => void (e.defaultPrevented && counters.touchmovePrevented++), { passive: true });
  win.addEventListener("touchend", () => void counters.touchend++, cap);
  win.addEventListener("touchcancel", () => void counters.touchcancel++, cap);
  win.addEventListener("pointercancel", () => void counters.pointercancel++, cap);
  doc.addEventListener("scroll", (e) => void (isYearPane(e.target) ? counters.scrollYear++ : counters.scrollOther++), cap);
}
