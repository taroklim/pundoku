/**
 * PD-180: геометрия кляксы = согласованный макет PD-170 (вариант A «Капля») — исполняем собственный код рисования макета и сверяем;
 * стили — дыхание через --mo (Reduce Motion → статично), без новых цветов.
 */
import { describe, expect, it } from "vitest";
import { PET_MOODS } from "@pundoku/engine";
import type { PetMood } from "@pundoku/engine";
import { petShape } from "./petGeometry";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };

// ---- макет PD-170: исполняем его собственный код рисования и сверяем с нашим ------------------------------------------------
type MockShape = { ry: number; rx: number; widen: number; lift: number };
type Mock = {
  MOOD: Record<PetMood, MockShape>;
  bodyPath(pv: string, m: MockShape): { d: string; cx: number; cy: number };
  eyes(mood: PetMood, m: MockShape, cx: number, cy: number): string;
  drops(pv: string, mood: PetMood, m: MockShape, cx: number, cy: number): [number, number, number][];
};
const html = fs.readFileSync(new URL("../../../../design/pd170-pet-glyphs.html", import.meta.url), "utf8");
const code = html.slice(html.indexOf("const MOOD = {"), html.indexOf("let UID = 0;"));
const mock = new Function(`${code}; return { MOOD, bodyPath, eyes, drops };`)() as Mock;

describe("геометрия = макет PD-170, вариант A «Капля»", () => {
  it.each(PET_MOODS)("%s: тело, глаза и капельки совпадают с макетом", (mood) => {
    const m = mock.MOOD[mood];
    const b = mock.bodyPath("A", m);
    const ours = petShape(mood);
    expect(ours.body).toBe(b.d);
    const eyes = mock.eyes(mood, m, b.cx, b.cy);
    if (ours.eyes.kind === "circles") {
      const circles = [...eyes.matchAll(/cx="([^"]+)" cy="([^"]+)" r="([^"]+)"/g)].map((x) => x.slice(1).map(Number));
      expect(circles).toEqual([
        [ours.eyes.cx[0], ours.eyes.cy, ours.eyes.r],
        [ours.eyes.cx[1], ours.eyes.cy, ours.eyes.r],
      ]);
    } else {
      expect(eyes).toContain(`d="${ours.eyes.d}"`);
      expect(eyes.includes('fill="none"')).toBe(ours.eyes.kind === "stroke");
    }
    expect(ours.drops).toEqual(mock.drops("A", mood, m, b.cx, b.cy));
  });

  it("у варианта A 1–2 капельки на настроение, у «спит» — лужица (ниже и шире «доволен»)", () => {
    for (const m of PET_MOODS) expect(petShape(m).drops.length).toBeGreaterThanOrEqual(1);
    for (const m of PET_MOODS) expect(petShape(m).drops.length).toBeLessThanOrEqual(2);
    expect(mock.MOOD.asleep.ry).toBeLessThan(mock.MOOD.happy.ry);
    expect(mock.MOOD.asleep.rx).toBeGreaterThan(mock.MOOD.happy.rx);
  });
});

// ---- стили ----------------------------------------------------------------------------------------------------------------------
// PD-260: движение и стили кляксы (покой — PD-297: постоянное дыхание, посадка, Reduce Motion, цвета) — `pet.motion.test.ts`.

describe("габариты и центр тела (PD-260: масштаб перехода и векторы брызг)", () => {
  it.each(PET_MOODS)("%s: центр и габариты — как bodyPath/bodyOf макетов", (mood) => {
    const b = mock.bodyPath("A", mock.MOOD[mood]);
    const s = petShape(mood);
    expect([s.cx, s.cy]).toEqual([b.cx, b.cy]);
    expect(s.w).toBeGreaterThan(2 * mock.MOOD[mood].rx * 0.9);
    expect(s.h).toBeGreaterThan(mock.MOOD[mood].ry * 1.5);
  });
  it("«спит» — лужица: шире и ниже «доволен»", () => {
    expect(petShape("asleep").w).toBeGreaterThan(petShape("happy").w);
    expect(petShape("asleep").h).toBeLessThan(petShape("happy").h);
  });
});
