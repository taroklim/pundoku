import { describe, expect, it } from "vitest";
import { FIT, boardSide, chrome0, dockRoom, extra, keyGrow, keyMetrics, tabbarH } from "./fitModel";

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

describe("PD-300: клавиши 1–9 крупнее на больших iPhone (модель)", () => {
  // Safe-area PWA (viewport-fit=cover): верх/низ, как у устройства.
  const PHONES = [
    { name: "430x932 (15/16 Plus)", w: 430, h: 932, saTop: 59, saBot: 34, big: true },
    { name: "428x926 (14 Plus)", w: 428, h: 926, saTop: 47, saBot: 34, big: true },
    { name: "440x956 (16 Pro Max)", w: 440, h: 956, saTop: 62, saBot: 34, big: true },
    { name: "402x874 (16 Pro)", w: 402, h: 874, saTop: 62, saBot: 34, big: false },
    { name: "393x852 (15/16)", w: 393, h: 852, saTop: 59, saBot: 34, big: false },
    { name: "390x844", w: 390, h: 844, saTop: 47, saBot: 34, big: false },
    { name: "375x667 (SE/8)", w: 375, h: 667, saTop: 20, saBot: 0, big: false },
    { name: "320x568", w: 320, h: 568, saTop: 20, saBot: 0, big: false },
  ] as const;
  const at = (s: (typeof PHONES)[number], o: { rem?: number; sa?: boolean; hintable?: boolean; ax3?: boolean } = {}) => ({
    vh: s.h,
    width: s.w - 32,
    rem: o.rem ?? 17,
    saTop: o.sa === false ? 0 : s.saTop,
    saBot: o.sa === false ? 0 : s.saBot,
    hintable: o.hintable ?? true,
    ax3: o.ax3,
  });

  it("428/430/440: клавиша 68–76 px, цифра ≥ 1.6rem и не шире 7.5 % пада; поле — ширина колонки, как было", () => {
    for (const s of PHONES.filter((p) => p.big))
      for (const hintable of [true, false]) {
        const i = at(s, { hintable });
        const m = keyMetrics(i);
        expect(m.height, s.name).toBeGreaterThanOrEqual(68);
        expect(m.height, s.name).toBeLessThanOrEqual(FIT.keyH + FIT.growMax);
        expect(m.digit, s.name).toBeGreaterThanOrEqual(1.6 * 17);
        expect(m.digit, s.name).toBeLessThanOrEqual(FIT.digitCapCqi * i.width + 1e-9);
        expect(boardSide(i), s.name).toBe(i.width);
      }
  });

  it("393 и уже — прибавки нет ни с safe-area, ни без неё (вкладка браузера), клавиша 56, цифра min(1.24rem, 7.5cqi)", () => {
    for (const s of PHONES.filter((p) => !p.big))
      for (const sa of [true, false]) {
        const i = at(s, { sa });
        expect(keyGrow(i), `${s.name} sa ${sa}`).toBe(0);
        expect(keyMetrics(i)).toEqual({ height: 56, digit: Math.min(1.24 * 17, 0.075 * i.width) });
      }
  });

  it("клавиши берут не больше половины запаса минус 16 px: строке статуса и ряду действий остаётся место над таб-баром", () => {
    for (const s of PHONES)
      for (const rem of [17, 20, 23, 28])
        for (const sa of [true, false]) {
          const i = at(s, { rem, sa });
          const slack = i.vh - chrome0(i) - extra(i) - boardSide(i);
          const g = keyGrow(i);
          expect(g).toBeGreaterThanOrEqual(0);
          if (g > 0) expect(slack - g, `${s.name} rem ${rem}`).toBeGreaterThanOrEqual(FIT.growMargin + g - 1e-9);
        }
  });

  it("где поле ограничено высотой (запаса нет) — прибавки нет; при AX3 — 0 всегда", () => {
    for (const s of PHONES) {
      const i = at(s);
      if (boardSide(i) < i.width) expect(keyGrow(i), s.name).toBe(0);
      expect(keyGrow(at(s, { rem: 40, ax3: true })), s.name).toBe(0);
    }
    // Ширина Plus, но низкое окно: поле уступает высоте → клавиши прежние.
    expect(keyGrow({ vh: 700, width: 398, rem: 17, hintable: true })).toBe(0);
  });

  it("поле не зависит от прибавки: boardSide считается без неё (тот же --chrome с 56 px клавиш)", () => {
    expect(FIT.padSlot).toBe(FIT.keyH + 66);
    for (const s of PHONES) {
      const i = at(s);
      expect(boardSide(i)).toBe(Math.max(0, Math.min(i.width, i.vh - chrome0(i) - extra(i))));
    }
  });
});

