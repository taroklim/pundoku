// @vitest-environment jsdom
// PD-161 (макет PD-158, вариант A «Лента»): три панели вкладок смонтированы постоянно, переход — слайд на WAAPI.
// В jsdom WAAPI нет: `Element.prototype.animate` замокан — проверяем, ЧТО и КАК запускается, и конечное состояние.
import { act, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "./i18n";

const mounts = vi.hoisted(() => ({ play: 0, today: 0, year: 0 }));
const activity = vi.hoisted(() => [] as string[]);
vi.mock("./play/PlayScreen", async () => {
  const { useTabActive } = await import("./shell/tabSlide");
  return {
    PlayScreen: () => {
      const active = useTabActive();
      // Локальное состояние экрана: раньше терялось при смене вкладки (панель размонтировалась).
      const [n, setN] = useState(0);
      useEffect(() => void mounts.play++, []);
      useEffect(() => void activity.push(`play:${active}`), [active]);
      return (
        <button type="button" data-testid="play-n" onClick={() => setN(n + 1)}>
          play {n}
        </button>
      );
    },
  };
});
vi.mock("./today/TodayScreen", () => ({
  TodayScreen: () => {
    useEffect(() => void mounts.today++, []);
    return <p>today</p>;
  },
}));
vi.mock("./today/ArchiveScreen", () => ({ ArchiveScreen: () => <p>archive</p> }));
vi.mock("./year/YearTab", () => ({
  YearTab: () => {
    useEffect(() => void mounts.year++, []);
    return <p>year</p>;
  },
}));
vi.mock("./recovery/SettingsScreen", () => ({
  BACK_LABEL: { today: "Today", play: "Play", year: "Year" },
  SettingsScreen: () => <p>settings</p>,
}));

import { App } from "./App";
import { FADE_MS, SLIDE_EASE, SLIDE_MS, translateXOf, WARM_MS } from "./shell/tabSlide";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface FakeAnim {
  el: Element;
  frames: Keyframe[];
  opts: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  finish: () => void;
  finished: Promise<void>;
}
let anims: FakeAnim[] = [];
let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  anims = [];
  activity.length = 0;
  mounts.play = mounts.today = mounts.year = 0;
  window.history.replaceState(null, "", "#/today");
  document.documentElement.style.removeProperty("--mo");
  (Element.prototype as { animate?: unknown }).animate = function (this: Element, frames: Keyframe[], opts: KeyframeAnimationOptions) {
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const finished = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    finished.catch(() => undefined);
    const a: FakeAnim = { el: this, frames, opts, cancel: vi.fn(() => reject(new Error("cancel"))), pause: vi.fn(), play: vi.fn(), finish: () => resolve(), finished };
    anims.push(a);
    return a as unknown as Animation;
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (Element.prototype as { animate?: unknown }).animate;
});

const pane = (id: string) => host.querySelector<HTMLElement>(`[data-tab="${id}"]`);
const tab = (i: number) => host.querySelectorAll<HTMLElement>('[role="tab"]')[i]!;
const paneAnims = () => anims.filter((a) => (a.el as HTMLElement).dataset.tab);
const x = (f: Keyframe) => translateXOf(String(f.transform));
const finishAll = async () => {
  await act(async () => {
    for (const a of anims) a.finish();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("PD-161: стопка вкладок", () => {
  it("первый показ без анимации; панель вкладки монтируется при первом посещении и больше не размонтируется", async () => {
    act(() => root.render(<App />));
    expect(anims).toHaveLength(0);
    expect(pane("today")).not.toBeNull();
    expect(pane("play")).toBeNull(); // ленивый первый маунт
    act(() => tab(1).click());
    act(() => tab(0).click());
    act(() => tab(2).click());
    act(() => tab(1).click());
    expect(mounts).toEqual({ today: 1, play: 1, year: 1 });
    expect(host.querySelectorAll('[role="tabpanel"]')).toHaveLength(3);
  }, 20_000); // первый тест файла платит импорт App (под нагрузкой — дольше 5 с)

  it("неактивные панели: visibility скрыта классом off, inert и aria-hidden; активная — без них", () => {
    act(() => root.render(<App />));
    act(() => tab(2).click());
    for (const id of ["today", "year"]) {
      const el = pane(id)!;
      const on = id === "year";
      expect(el.classList.contains("off")).toBe(!on);
      expect(el.hasAttribute("inert")).toBe(!on); // jsdom не знает свойства `inert` — проверяем атрибут
      expect(el.getAttribute("aria-hidden")).toBe(on ? "false" : "true");
      expect(el.classList.contains("scroll")).toBe(true); // своя прокрутка у каждой панели
    }
  });

  it("локальное состояние экрана переживает смену вкладки", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    act(() => host.querySelector<HTMLElement>('[data-testid="play-n"]')!.click());
    act(() => tab(0).click());
    act(() => tab(1).click());
    expect(host.querySelector('[data-testid="play-n"]')!.textContent).toBe("play 1");
  });

  it("сигнал «вкладка активна»: Play знает, когда она на экране", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    act(() => tab(2).click());
    act(() => tab(1).click());
    expect(activity).toEqual(["play:true", "play:false", "play:true"]);
  });
});

describe("PD-161: слайд «Лента»", () => {
  it("Today → Play: оба экрана едут на всю ширину, 300 мс, --e-ring; новый приходит справа, старый уходит влево", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    const a = paneAnims();
    expect(a).toHaveLength(2);
    const play = a.find((v) => v.el === pane("play"))!;
    const today = a.find((v) => v.el === pane("today"))!;
    expect(play.opts).toMatchObject({ duration: SLIDE_MS, easing: SLIDE_EASE, fill: "both" });
    // В jsdom ширина 0: проверяем знак через ширину-заглушку ниже; здесь — что конец входящего ровно в кадре.
    expect(x(play.frames[1]!)).toBe(0);
    expect(x(today.frames[0]!)).toBe(0);
    // Во время перехода уходящая панель видима (data-slide) и с will-change.
    expect(pane("today")!.hasAttribute("data-slide")).toBe(true);
    expect(pane("today")!.style.willChange).toContain("transform");
  });

  it("направление по порядку вкладок и прыжок Today ↔ Year напрямую (Play не участвует)", () => {
    act(() => root.render(<App />));
    const stack = host.querySelector<HTMLElement>(".stack")!;
    Object.defineProperty(stack, "clientWidth", { value: 390, configurable: true });
    act(() => tab(2).click());
    let a = paneAnims();
    expect(a.map((v) => (v.el as HTMLElement).dataset.tab).sort()).toEqual(["today", "year"]);
    expect(x(a.find((v) => v.el === pane("year"))!.frames[0]!)).toBe(390); // справа
    expect(x(a.find((v) => v.el === pane("today"))!.frames[1]!)).toBe(-390); // влево
    anims = [];
    act(() => tab(0).click()); // назад — зеркально
    a = paneAnims();
    expect(x(a.find((v) => v.el === pane("today"))!.frames[1]!)).toBe(0);
    expect(x(a.find((v) => v.el === pane("year"))!.frames[1]!)).toBe(390);
  });

  it("PD-175: движение стартует сразу — без паузы на кадр и play() из rAF (pending-старт браузера)", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    const a = anims.slice();
    expect(a.length).toBeGreaterThan(0);
    for (const v of a) {
      expect(v.pause).not.toHaveBeenCalled();
      expect(v.play).not.toHaveBeenCalled();
    }
  });

  it("после конца перехода на панелях нет ни transform, ни will-change, ни data-slide: анимации отменены (cancel, не commitStyles)", async () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    const a = paneAnims();
    await finishAll();
    for (const v of a) expect(v.cancel).toHaveBeenCalled();
    for (const id of ["today", "play"]) {
      const el = pane(id)!;
      expect(el.hasAttribute("data-slide")).toBe(false);
      expect(el.style.willChange).toBe("");
      expect(el.style.transform).toBe("");
      expect(el.style.opacity).toBe("");
    }
  });

  it("прерывание: новый тап отменяет текущие анимации и стартует от текущего положения; повторный тап по цели игнорируется", () => {
    act(() => root.render(<App />));
    act(() => tab(1).click());
    const first = paneAnims();
    act(() => tab(1).click()); // Play уже цель: reselect, не переход
    expect(paneAnims()).toHaveLength(2);
    // Имитация середины: computed transform читается из стиля (в jsdom WAAPI-значений нет).
    pane("today")!.style.transform = "translateX(-200px)";
    pane("play")!.style.transform = "translateX(190px)";
    anims = [];
    act(() => tab(2).click());
    for (const v of first) expect(v.cancel).toHaveBeenCalled();
    const next = paneAnims();
    expect(next.map((v) => (v.el as HTMLElement).dataset.tab).sort()).toEqual(["play", "today", "year"]);
    expect(x(next.find((v) => v.el === pane("today"))!.frames[0]!)).toBe(-200);
    expect(x(next.find((v) => v.el === pane("play"))!.frames[0]!)).toBe(190);
  });

  it("Reduce Motion (--mo: 0): кроссфейд 200 мс без сдвига, пилюля встаёт мгновенно", () => {
    document.documentElement.style.setProperty("--mo", "0");
    act(() => root.render(<App />));
    act(() => tab(1).click());
    const a = paneAnims();
    expect(a).toHaveLength(2);
    for (const v of a) {
      expect(v.opts.duration).toBe(FADE_MS);
      expect(x(v.frames[0]!)).toBe(0);
      expect(x(v.frames[1]!)).toBe(0);
    }
    expect(a.find((v) => v.el === pane("play"))!.frames[0]!.opacity).toBe(0);
    expect(anims.some((v) => (v.el as HTMLElement).classList.contains("tab-pill"))).toBe(false);
  });

  it("пилюля едет той же кривой и длительностью", () => {
    act(() => root.render(<App />));
    act(() => tab(2).click());
    const pill = anims.find((v) => (v.el as HTMLElement).classList.contains("tab-pill"));
    expect(pill?.opts).toMatchObject({ duration: SLIDE_MS, easing: SLIDE_EASE });
  });
});

describe("PD-175: прогрев экрана по касанию вкладки", () => {
  const touch = (i: number) => act(() => void tab(i).dispatchEvent(new Event("pointerdown", { bubbles: true })));
  /** Today активна, Play и Year уже посещены (смонтированы), переходы закончены; ширина стопки 390. */
  const ready = async () => {
    act(() => root.render(<App />));
    Object.defineProperty(host.querySelector(".stack")!, "clientWidth", { value: 390, configurable: true });
    act(() => tab(1).click());
    act(() => tab(2).click());
    act(() => tab(0).click());
    await finishAll();
    anims = [];
  };
  afterEach(() => void vi.useRealTimers());

  it("касание посещённой вкладки: экран-цель видим за краем (стартовое положение слайда), без анимаций; без тапа — снят через WARM_MS", async () => {
    await ready();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    touch(1);
    const play = pane("play")!;
    expect(anims).toHaveLength(0);
    expect(play.hasAttribute("data-slide")).toBe(true);
    expect(translateXOf(play.style.transform)).toBe(390);
    expect(play.style.willChange).toContain("transform");
    expect(play.hasAttribute("inert")).toBe(true); // по-прежнему неактивна
    act(() => void vi.advanceTimersByTime(WARM_MS));
    expect(play.hasAttribute("data-slide")).toBe(false);
    expect(play.style.transform).toBe("");
    expect(play.style.willChange).toBe("");
  });

  it("касание + тап: слайд стартует с того же места за краем; после конца на панелях нет inline-стилей", async () => {
    await ready();
    touch(2);
    act(() => tab(2).click());
    const year = paneAnims().find((v) => v.el === pane("year"))!;
    expect(x(year.frames[0]!)).toBe(390);
    await finishAll();
    for (const id of ["today", "play", "year"]) {
      const el = pane(id)!;
      expect(el.hasAttribute("data-slide")).toBe(false);
      expect(el.style.transform).toBe("");
      expect(el.style.opacity).toBe("");
      expect(el.style.willChange).toBe("");
    }
  });

  it("тап ушёл на другую вкладку — прогрев снимается сразу; касание активной или ещё не посещённой вкладки ничего не делает", async () => {
    act(() => root.render(<App />));
    touch(0); // активная
    touch(1); // Play ещё не смонтирована
    expect(host.querySelectorAll("[data-slide]")).toHaveLength(0);
    await ready();
    touch(1);
    expect(pane("play")!.hasAttribute("data-slide")).toBe(true);
    act(() => tab(2).click()); // клавиатура/другой палец — на Year
    const play = pane("play")!;
    expect(play.hasAttribute("data-slide")).toBe(false);
    expect(play.style.transform).toBe("");
    expect(paneAnims().map((v) => (v.el as HTMLElement).dataset.tab).sort()).toEqual(["today", "year"]);
  });

  it("Reduce Motion: прогретый экран прозрачен и на месте (кроссфейд)", async () => {
    document.documentElement.style.setProperty("--mo", "0");
    await ready();
    touch(1);
    const play = pane("play")!;
    expect(translateXOf(play.style.transform)).toBe(0);
    expect(play.style.opacity).toBe("0");
  });
});

describe("PD-161: экраны поверх вкладки", () => {
  it("Settings — поверх стопки (панели под ним скрыты и inert, не размонтированы); вход M10 только после навигации", () => {
    act(() => root.render(<App />));
    act(() => host.querySelector<HTMLElement>('[role="tab"]')!.click()); // повторный тап по Today — не переход
    expect(anims).toHaveLength(0);
    window.history.pushState({ pdSettings: true, pdFrom: "today" }, "", "#/settings");
    act(() => void window.dispatchEvent(new PopStateEvent("popstate")));
    const layer = host.querySelector<HTMLElement>(".push-layer")!;
    expect(layer.textContent).toBe("settings");
    expect(layer.querySelector(".panel")!.classList.contains("enter")).toBe(true);
    const stack = host.querySelector<HTMLElement>(".stack")!;
    expect(stack.classList.contains("covered")).toBe(true);
    expect(stack.hasAttribute("inert")).toBe(true);
    expect(mounts.today).toBe(1);
    expect(paneAnims()).toHaveLength(0); // открытие Settings — не слайд
  });
});
