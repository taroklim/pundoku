import { describe, expect, it } from "vitest";
import { FIT, boardSide, chrome0, dockRoom, extra, tabbarH } from "./fitModel";

const SCREENS = [
  { name: "320x568", w: 320, h: 568 },
  { name: "375x667", w: 375, h: 667 },
  { name: "390x844", w: 390, h: 844 },
  { name: "393x852", w: 393, h: 852 },
] as const;
const input = (s: (typeof SCREENS)[number], rem = 17, hintable = true) => ({ vh: s.h, width: s.w - 32, rem, hintable });

describe("PD-144 D-1: резерв под док подсказки (модель)", () => {
  it("поле не зависит от того, открыт ли док (любой экран, 17 px и AX3, с лампочкой и без)", () => {
    for (const s of SCREENS)
      for (const rem of [17, 40])
        for (const hintable of [true, false])
          expect(boardSide(input(s, rem, hintable), true), `${s.name} rem ${rem} hintable ${hintable}`).toBe(boardSide(input(s, rem, hintable), false));
  });

  it("320x568 при 17 px: поле не меньше пола 240 px (док без резерва сжал бы поле до ~183 при открытии у QA)", () => {
    const side = boardSide(input(SCREENS[0]));
    expect(side).toBeGreaterThanOrEqual(FIT.boardFloor - 0.5);
    expect(side).toBeLessThan(250);
  });

  it("резерв упирается в пол: поле 240 на самом коротком экране, высота дока ≥ места панели", () => {
    const i = input(SCREENS[0]);
    expect(chrome0(i) + extra(i) + FIT.boardFloor).toBeLessThanOrEqual(i.vh + 0.01);
    expect(dockRoom(i)).toBeGreaterThan(FIT.padSlot);
  });

  it("375x667: док получает полные 172 px, поле остаётся крупным", () => {
    const i = input(SCREENS[1]);
    expect(dockRoom(i)).toBeGreaterThanOrEqual(FIT.dockH - 0.5);
    expect(boardSide(i)).toBeGreaterThan(300);
  });

  it("высокие экраны (390x844, 393x852): поле упирается в ширину колонки, резерв не виден", () => {
    for (const s of SCREENS.slice(2)) {
      const i = input(s);
      expect(boardSide(i)).toBe(i.width);
      expect(boardSide(i)).toBe(boardSide({ ...i, hintable: false }));
    }
  });

  it("Ink и партии без лампочки резерва не имеют; прежнее поле не меняется", () => {
    for (const s of SCREENS) {
      expect(extra(input(s, 17, false))).toBe(0);
      expect(boardSide(input(s, 17, false))).toBeCloseTo(Math.min(s.w - 32, s.h - chrome0(input(s, 17, false))), 6);
    }
  });

  it("AX3 (rem 40): резерв ничтожен (0 на 320x568, ≤ 6 px на 375x667), поле 320x568 уже пола, док не меньше места панели", () => {
    const small = input(SCREENS[0], 40);
    expect(extra(small)).toBe(0);
    expect(boardSide(small)).toBeLessThan(FIT.boardFloor);
    const mid = input(SCREENS[1], 40);
    expect(extra(mid)).toBeLessThanOrEqual(6.01);
    for (const i of [small, mid]) expect(dockRoom(i)).toBeGreaterThan(FIT.padSlot);
  });

  it("резерв монотонен: чем выше экран, тем он не меньше, и никогда не отрицателен", () => {
    let prev = -1;
    for (let vh = 480; vh <= 1000; vh += 20) {
      const e = extra({ vh, width: 343, rem: 17, hintable: true });
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = e;
    }
  });

  it("таб-бар растёт с подписью вкладки: 64 px при 17 px, до 67 при крупном тексте", () => {
    expect(tabbarH(17)).toBeCloseTo(64 + (Math.min(13, Math.max(11, 0.65 * 17)) - 11) * 1.5, 6);
    expect(tabbarH(40)).toBeCloseTo(64 + 2 * 1.5, 6);
  });
});
