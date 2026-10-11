// @vitest-environment jsdom
/**
 * PD-298: реакция Питомца на тап — вариант A «Плюх» (макет PD-296 §1). Порог «тап, а не жест» (8 px / 500 мс), анти-спам (тап во
 * время реакции проглатывается; усталость в окне 5 с: 1–3 полная, 4–6 половина, 7+ только мигание брызг), во время «прилёта» тап
 * игнорируется, без preventDefault (прокрутка/свайп/жест «назад» не страдают), доступность (украшение, не кнопка), CSS зоны ≥ 44.
 * CSS (зона ≥ 44, жесты, keyframes дословно = макет, тождественны при Reduce Motion) — `pet.motion.test.ts`. Живьём — `design/pd298-check.mjs`.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { PetBlot } from "./PetBlot";
import { POKE_MS, POKE_WINDOW_MS, TAP_MAX_MS, TAP_SLOP_PX, isTap, pokeAmp, pokeEnd, pokeStart, resetPokes } from "./petPoke";
import { PetTap } from "./PetTap";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


let host: HTMLDivElement;
let root: Root;
let now = 1000;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  resetPokes();
  now = 1000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/** Касание: down → up со сдвигом `dx` и длительностью `ms` (timeStamp события). Возвращает отменено ли по умолчанию. */
function touch(el: Element, { dx = 0, ms = 80, id = 1, cancel = false } = {}): boolean {
  const ev = (type: string, x: number, t: number) => {
    const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, clientX: x, clientY: 20, isPrimary: true });
    Object.defineProperty(e, "timeStamp", { value: t });
    return e;
  };
  let prevented = false;
  act(() => {
    const d = ev("pointerdown", 20, 5000);
    el.dispatchEvent(d);
    prevented ||= d.defaultPrevented;
    if (cancel) el.dispatchEvent(ev("pointercancel", 20 + dx, 5000 + ms));
    const u = ev("pointerup", 20 + dx, 5000 + ms);
    el.dispatchEvent(u);
    prevented ||= u.defaultPrevented;
  });
  return prevented;
}
/** jsdom без AnimationEvent: React слушает animationend или webkitAnimationEnd — шлём оба. */
function animEnd(el: Element, name: string) {
  act(() => {
    for (const type of ["animationend", "webkitAnimationEnd"]) el.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), { animationName: name }));
  });
}
const zone = (id = "z") => host.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const pet = (id = "z") => zone(id).querySelector<HTMLElement>(".pet")!;
const render = (node: React.ReactNode) => act(() => root.render(node));

describe("логика: тап, а не жест; усталость", () => {
  it("порог: сдвиг < 8 px и < 500 мс, тот же указатель", () => {
    expect([TAP_SLOP_PX, TAP_MAX_MS, POKE_WINDOW_MS]).toEqual([8, 500, 5000]);
    expect(POKE_MS).toEqual([440, 200]);
    const d = { id: 1, x: 0, y: 0, t: 0 };
    expect(isTap(d, { id: 1, x: 5, y: 5, t: 499 })).toBe(true); // 7,07 px
    expect(isTap(d, { id: 1, x: 8, y: 0, t: 100 })).toBe(false);
    expect(isTap(d, { id: 1, x: 0, y: 0, t: 500 })).toBe(false);
    expect(isTap(d, { id: 2, x: 0, y: 0, t: 10 })).toBe(false);
    expect(isTap(null, { id: 1, x: 0, y: 0, t: 10 })).toBe(false);
  });
  it("амплитуда: 1–3 полная, 4–6 половина, 7+ ноль; во время реакции тап проглатывается и не считается; 5 с тишины — снова полная", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 12].map(pokeAmp)).toEqual([1, 1, 1, 0.5, 0.5, 0.5, 0, 0]);
    const a = Symbol("a");
    const b = Symbol("b");
    expect(pokeStart(a, 0)).toBe(1);
    expect(pokeStart(b, 100)).toBeNull(); // любая клякса занята — тап проглочен
    pokeEnd(a);
    const amps = [];
    for (let i = 1; i < 8; i++) {
      amps.push(pokeStart(a, i * 500));
      pokeEnd(a);
    }
    expect(amps).toEqual([1, 1, 0.5, 0.5, 0.5, 0, 0]); // 2-й … 8-й тап за 4 с
    expect(pokeStart(a, 4000 + POKE_WINDOW_MS + 1)).toBe(1);
  });
});

describe("PetTap + PetBlot: «Плюх»", () => {
  it("слой .poke между .pet и .breath; тап → data-poke=A, --amp=1; дыхание не перезапускается (тот же .breath)", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="happy" />
      </PetTap>,
    );
    const p = pet();
    const breath = p.querySelector(".breath");
    expect(p.firstElementChild!.className).toBe("poke");
    expect(p.querySelector(":scope > .poke > .breath > .pose.to")).not.toBeNull();
    expect(p.querySelector(":scope > .drops.to")).not.toBeNull(); // брызги — вне .poke: отскакивают своей анимацией
    expect(p.hasAttribute("data-poke")).toBe(false);
    expect(touch(zone())).toBe(false); // без preventDefault: прокрутка/свайп/«назад» не страдают
    expect(pet().dataset.poke).toBe("A");
    expect(pet().style.getPropertyValue("--amp")).toBe("1");
    expect(pet()).toBe(p);
    expect(p.querySelector(".breath")).toBe(breath);
    expect(p.dataset.mood).toBe("happy"); // настроение тапом не меняется
    animEnd(p.querySelector(".poke")!, "petPokeA");
    expect(p.hasAttribute("data-poke")).toBe(false);
  });

  it("тап во время реакции — без перезапуска и очереди; после конца — снова; 4-й за 5 с — половина, 7-й — только брызги", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="tired" />
      </PetTap>,
    );
    touch(zone());
    expect(pet().dataset.poke).toBe("A");
    touch(zone()); // во время реакции
    animEnd(pet(), "petPokeA");
    expect(pet().hasAttribute("data-poke")).toBe(false); // очереди нет
    const amps: string[] = [];
    for (let i = 0; i < 6; i++) {
      now += 300;
      touch(zone());
      amps.push(pet().style.getPropertyValue("--amp"));
      animEnd(pet(), "petPokeA");
    }
    expect(amps).toEqual(["1", "1", "0.5", "0.5", "0.5", "0"]); // 2-й…7-й засчитанный тап
    now += POKE_WINDOW_MS + 10;
    touch(zone());
    expect(pet().style.getPropertyValue("--amp")).toBe("1");
  });

  it("не тап: сдвиг ≥ 8 px (прокрутка/свайп), дольше 500 мс, pointercancel, чужой указатель — реакции нет", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="happy" />
      </PetTap>,
    );
    touch(zone(), { dx: 8 });
    touch(zone(), { ms: 520 });
    touch(zone(), { cancel: true });
    act(() => {
      zone().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, clientX: 0, clientY: 0 }));
      zone().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 2, clientX: 0, clientY: 0 }));
    });
    expect(pet().hasAttribute("data-poke")).toBe(false);
    touch(zone(), { dx: 7 });
    expect(pet().dataset.poke).toBe("A");
  });

  it("подстраховка: animationend не пришёл (клякса без анимаций) — реакция снимается по длине + запас, экран не «занят» навсегда", () => {
    vi.useFakeTimers();
    try {
      render(
        <PetTap testId="z">
          <PetBlot mood="happy" />
        </PetTap>,
      );
      touch(zone());
      expect(pet().dataset.poke).toBe("A");
      act(() => void vi.advanceTimersByTime(POKE_MS[0] + 200));
      expect(pet().hasAttribute("data-poke")).toBe(false);
      now += 100;
      touch(zone());
      expect(pet().dataset.poke).toBe("A");
    } finally {
      vi.useRealTimers();
    }
  });

  it("во время «прилёта» тап игнорируется; прилёт доиграл — тап работает, клякса та же (без перемонтажа, посадка не повторяется)", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="surprised" act="arrive" actDelay={300} />
      </PetTap>,
    );
    const p = pet();
    expect(p.dataset.act).toBe("arrive");
    touch(zone());
    expect(p.hasAttribute("data-poke")).toBe(false);
    animEnd(p.querySelector(".drop")!, "petSplashIn"); // брызги — не конец действия
    touch(zone());
    expect(p.hasAttribute("data-poke")).toBe(false);
    animEnd(p.querySelector(".pose.to")!, "petArriveBSurp");
    touch(zone());
    expect(pet()).toBe(p);
    expect(p.dataset.poke).toBe("A");
    expect(p.dataset.act).toBe("arrive"); // действие доиграно (fill-mode both — финальный кадр тождественный), заново не играет
    animEnd(p.querySelector(".poke")!, "petPokeA");
    expect(p.hasAttribute("data-poke")).toBe(false);
  });

  it("«проснуться» (лист дня Year) — так же: во время — нет, после — да", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="happy" act="wake" />
      </PetTap>,
    );
    touch(zone());
    expect(pet().hasAttribute("data-poke")).toBe(false);
    animEnd(pet(), "petGatherIn");
    touch(zone());
    expect(pet().dataset.poke).toBe("A");
  });

  it("брызги «Плюха» — внутренний кружок .drop > .dot (действие анимирует саму .drop — анимации не спорят)", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="tired" />
      </PetTap>,
    );
    const drops = [...pet().querySelectorAll(":scope > .drops.to > .drop")];
    expect(drops.length).toBe(2);
    for (const d of drops) expect(d.querySelector(":scope > .dot")).not.toBeNull();
  });

  it("disabled — не реагирует; размонтирование посреди реакции освобождает экран для другой кляксы", () => {
    render(
      <>
        <PetTap testId="z" disabled>
          <PetBlot mood="happy" />
        </PetTap>
        <PetTap testId="y">
          <PetBlot mood="asleep" />
        </PetTap>
      </>,
    );
    touch(zone());
    expect(pet().hasAttribute("data-poke")).toBe(false);
    touch(zone("y"));
    expect(pet("y").dataset.poke).toBe("A");
    render(
      <PetTap testId="z">
        <PetBlot mood="happy" />
      </PetTap>,
    );
    touch(zone());
    expect(pet().dataset.poke).toBe("A");
  });

  it("клякса без зоны (PetBlot сам по себе) — на тап не отвечает и data-poke не ставит", () => {
    render(<PetBlot mood="happy" />);
    const p = host.querySelector<HTMLElement>(".pet")!;
    touch(p);
    expect(p.hasAttribute("data-poke")).toBe(false);
  });

  it("доступность: зона — не кнопка, без role/tabindex/aria; клякса — role=img «Blot, pleased», как раньше; спящая — «Blot, asleep»", () => {
    render(
      <PetTap testId="z">
        <PetBlot mood="happy" />
      </PetTap>,
    );
    const z = zone();
    expect(z.tagName).toBe("SPAN");
    for (const a of ["role", "tabindex", "aria-label", "aria-hidden"]) expect(z.hasAttribute(a), a).toBe(false);
    expect(z.classList.contains("pet-hit")).toBe(true);
    expect(pet().getAttribute("role")).toBe("img");
    expect(pet().getAttribute("aria-label")).toBe("Blot, pleased");
    touch(z);
    expect(pet().getAttribute("aria-label")).toBe("Blot, pleased"); // реакция ничего не объявляет
    expect(host.querySelectorAll("button, [tabindex]")).toHaveLength(0);
  });
});
