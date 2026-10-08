/** PD-225: числа и решения свайпа строки режима (design/pd224-swipe-gestures.md §A3). */
import { describe, expect, it } from "vitest";
import { SWIPE, claimGesture, dragX, nextArmed, releaseAction, swipeGeometry, velocity } from "./swipe";

describe("геометрия: A и T по ширине строки и подписи", () => {
  it("390 pt (W 358): en «Delete» ≈ 54 px → A = 86; T = max(55 % W, A + 72) = 197", () => {
    expect(swipeGeometry(358, 54)).toEqual({ W: 358, A: 86, T: 197, iconOnly: false });
  });
  it("320 pt (W 288): ru 96 / uk 104 → T 168 / 176; короткая подпись — не меньше 80", () => {
    expect(swipeGeometry(288, 64)).toMatchObject({ A: 96, T: 168 });
    expect(swipeGeometry(288, 72)).toMatchObject({ A: 104, T: 176 });
    expect(swipeGeometry(288, 30)).toMatchObject({ A: 80, T: 158 });
  });
  it("AX-размеры: подпись + 32 > 45 % W → только значок, A = 88; T всегда < W", () => {
    const g = swipeGeometry(288, 120);
    expect(g).toMatchObject({ A: 88, iconOnly: true });
    expect(g.T).toBeLessThan(g.W);
    expect(swipeGeometry(398, 200).T).toBeLessThan(398);
  });
});

describe("захват жеста: slop 10 px и угол 1,5 : 1", () => {
  it("до slop — не решено; горизонталь под пологим углом — свайп", () => {
    expect(claimGesture(-9, 0)).toBe("undecided");
    expect(claimGesture(-10, 0)).toBe("swipe");
    expect(claimGesture(-15, 9)).toBe("swipe"); // 31°
  });
  it("круче 34° — прокрутка (жест отдаётся вертикали до конца касания)", () => {
    expect(claimGesture(-12, 10)).toBe("scroll"); // 40°
    expect(claimGesture(0, 10)).toBe("scroll");
    expect(claimGesture(-12, 9)).toBe("undecided"); // вертикаль ещё не набрала slop, угол крутой — ждём
  });
});

describe("ведение: резинка и предел", () => {
  it("закрытая строка вправо не едет; открытая — резинка до 12 px; влево не дальше −W", () => {
    expect(dragX(0, 40, false, 358)).toBe(0);
    expect(dragX(-86, 86 + 30, true, 358)).toBe(6);
    expect(dragX(-86, 86 + 200, true, 358)).toBe(SWIPE.RUBBER_MAX);
    expect(dragX(0, -500, false, 358)).toBe(-358);
  });
  it("armed с гистерезисом 24 px: включается на T, гаснет ниже T − 24", () => {
    expect(nextArmed(false, -196, 197)).toBe(false);
    expect(nextArmed(false, -197, 197)).toBe(true);
    expect(nextArmed(true, -180, 197)).toBe(true);
    expect(nextArmed(true, -172, 197)).toBe(false);
  });
});

describe("решение по отпусканию (§A3)", () => {
  const A = 86;
  it("armed: удалить; бросок вправо — передумал, остаётся открытой", () => {
    expect(releaseAction({ x: -250, v: 0, armed: true, A })).toBe("delete");
    expect(releaseAction({ x: -250, v: -2, armed: true, A })).toBe("delete");
    expect(releaseAction({ x: -250, v: 0.3, armed: true, A })).toBe("open");
  });
  it("не armed: ≥ A/2 — открыта, меньше — закрыта; бросок влево от 16 px открывает, вправо закрывает", () => {
    expect(releaseAction({ x: -43, v: 0, armed: false, A })).toBe("open");
    expect(releaseAction({ x: -42, v: 0, armed: false, A })).toBe("close");
    expect(releaseAction({ x: -16, v: -0.3, armed: false, A })).toBe("open");
    expect(releaseAction({ x: -15, v: -0.9, armed: false, A })).toBe("close");
    expect(releaseAction({ x: -80, v: 0.3, armed: false, A })).toBe("close");
  });
  it("бросок никогда не удаляет; pointercancel никогда не удаляет", () => {
    expect(releaseAction({ x: -150, v: -5, armed: false, A })).toBe("open");
    expect(releaseAction({ x: -300, v: 0, armed: true, A, cancelled: true })).toBe("open");
    expect(releaseAction({ x: -20, v: 0, armed: false, A, cancelled: true })).toBe("close");
  });
});

describe("скорость по последним 100 мс", () => {
  it("берёт первую выборку в окне", () => {
    const s = [
      { t: 0, x: 300 },
      { t: 150, x: 280 },
      { t: 200, x: 250 },
    ];
    expect(velocity(s, 250, 200)).toBeCloseTo(-0.8);
    expect(velocity([], 10, 0)).toBe(0);
  });
});
