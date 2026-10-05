import { describe, expect, it } from "vitest";
import { PET_MOODS, PET_TIRED_CORRECTIONS, isPersonalBest, petMood } from "./index.js";
import type { PetDay, PetMood } from "./index.js";

const solved = (extra: Partial<PetDay> = {}): PetDay => ({ solved: true, corrections: 0, ...extra });

describe("petMood (PD-180, план §2) — таблица", () => {
  const table: [string, PetDay | null | undefined, PetMood][] = [
    ["нет записи (не играл)", null, "asleep"],
    ["undefined", undefined, "asleep"],
    ["начат, не решён", { solved: false, corrections: 0 }, "asleep"],
    ["не решён, хоть и Лжец с первого раза", { solved: false, corrections: 0, liarFirstTry: true }, "asleep"],
    ["не решён, но рекорд (невозможно — всё равно спит)", { solved: false, corrections: 0, personalBest: true }, "asleep"],
    ["решено чисто", solved(), "happy"],
    ["чисто, hints: 0 явно", solved({ hints: 0, blots: 0 }), "happy"],
    ["правки на пороге", solved({ corrections: PET_TIRED_CORRECTIONS }), "tired"],
    ["много правок", solved({ corrections: 7 }), "tired"],
    ["подсказка без правок", solved({ hints: 1 }), "tired"],
    ["кляксы Ink", solved({ ink: true, blots: 2, corrections: 2 }), "tired"],
    ["Ink: клякса без учтённой правки (страховка)", solved({ ink: true, blots: 1 }), "tired"],
    ["чистый Ink", solved({ ink: true }), "surprised"],
    ["Ink чисто, но с подсказкой — не особый", solved({ ink: true, hints: 1 }), "tired"],
    ["Лжец с первого обвинения", solved({ liarFirstTry: true }), "surprised"],
    ["Лжец с первого раза, но с правками — особый день сильнее", solved({ liarFirstTry: true, corrections: 3 }), "surprised"],
    ["Лжец не с первого раза, чисто", solved({ liarFirstTry: false }), "happy"],
    ["рекорд, чисто", solved({ personalBest: true }), "surprised"],
    ["рекорд с правками", solved({ personalBest: true, corrections: 2 }), "surprised"],
    ["рекорд с подсказкой — не рекорд", solved({ personalBest: true, hints: 2 }), "tired"],
    ["отрицательные счётчики — как ноль", solved({ corrections: -3, blots: -1, hints: -1 }), "happy"],
  ];
  it.each(table)("%s", (_name, day, mood) => {
    expect(petMood(day)).toBe(mood);
  });

  it("ровно 4 настроения, в порядке макета", () => {
    expect(PET_MOODS).toEqual(["happy", "tired", "surprised", "asleep"]);
  });

  it("порог правок — константа ≥ 1 (меньше порога — доволен)", () => {
    expect(PET_TIRED_CORRECTIONS).toBeGreaterThanOrEqual(1);
    expect(petMood(solved({ corrections: PET_TIRED_CORRECTIONS - 1 }))).toBe("happy");
  });
});

describe("isPersonalBest", () => {
  const table: [string, number, number[], boolean][] = [
    ["первое решение класса — не рекорд", 300_000, [], false],
    ["быстрее всех прежних", 299_000, [300_000, 410_000], true],
    ["равно лучшему — не рекорд", 300_000, [300_000, 410_000], false],
    ["медленнее лучшего", 350_000, [300_000, 410_000], false],
    ["мусор в истории игнорируется", 299_000, [Number.NaN, -5, 0, 300_000], true],
    ["только мусор в истории — как пусто", 299_000, [Number.NaN, 0], false],
    ["нулевое время — не рекорд", 0, [300_000], false],
    ["NaN — не рекорд", Number.NaN, [300_000], false],
  ];
  it.each(table)("%s", (_n, t, prev, out) => {
    expect(isPersonalBest(t, prev)).toBe(out);
  });
});
