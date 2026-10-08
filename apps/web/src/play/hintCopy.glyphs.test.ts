/**
 * PD-199: в Глифах ступени лесенки говорят «знак» / «shape», а не «цифра» / «digit». Классика без изменений.
 */
import { createInstance } from "i18next";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { Hint, StepHint } from "@pundoku/engine";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { HINT_FIXTURES, playOf, withValue } from "./hint.fixtures";
import type { FixtureName } from "./hint.fixtures";
import { hintStepCopy } from "./hintCopy";
import type { HintStepCopy } from "./hintCopy";
import { computeHint } from "./hintModel";
import type { HintStep } from "./hintModel";

const LOCALES = { en, uk, ru } as const;
type Lang = keyof typeof LOCALES;
const tOf = async (lng: Lang): Promise<TFunction> => {
  const i = createInstance();
  await i.init({ resources: { en: { translation: en }, uk: { translation: uk }, ru: { translation: ru } }, lng, fallbackLng: false, interpolation: { escapeValue: false } });
  return i.t.bind(i) as TFunction;
};

const STEPS: HintStep[] = [1, 2, 3, 4];
const NAMES = (Object.keys(HINT_FIXTURES) as FixtureName[]).filter((n) => n !== "beyond");
const DIGIT = { en: /\bdigits?\b/i, uk: /цифр/i, ru: /цифр/i } as const;
const GLYPH = { en: /\bshapes?\b/i, uk: /знак/i, ru: /знак/i } as const;

/** Все подсказки, которые видит игрок: каждая техника (с допущением и без) и ветка «ошибка на доске». */
function allHints(): Hint[] {
  const out: Hint[] = [];
  for (const name of NAMES) {
    const h = computeHint(playOf(name)) as StepHint;
    out.push(h, { ...h, assumes: [{ cell: 0, digit: 1 as const }] } as StepHint);
    if (name === "hiddenSingle") out.push({ ...h, cells: { ...h.cells, witnesses: h.cells.witnesses.slice(0, 1) } });
  }
  const p = playOf("nakedSingle");
  const s = computeHint(p) as StepHint;
  out.push(computeHint(withValue(p, s.placement!.cell, (s.placement!.digit % 9) + 1)));
  return out;
}
const texts = (c: HintStepCopy): string[] => [c.title, c.body, ...c.key.map((k) => k.label), c.foot ?? ""];

describe("PD-199: лесенка подсказок в Глифах", () => {
  for (const lng of Object.keys(LOCALES) as Lang[]) {
    it(`${lng}: в Глифах ни на одной ступени нет «цифры», знак назван; плейсхолдеры закрыты`, async () => {
      const t = await tOf(lng);
      let named = 0;
      for (const h of allHints()) {
        for (const st of STEPS) {
          for (const s of texts(hintStepCopy(t, h, st, true, true))) {
            expect(s, `${lng} ${h.kind} ${st}`).not.toMatch(DIGIT[lng]);
            expect(s, `${lng} ${h.kind} ${st}`).not.toMatch(/\{\{|\}\}|^hint\.|_glyphs/);
            if (GLYPH[lng].test(s)) named++;
          }
        }
      }
      expect(named).toBeGreaterThan(10);
    });

    it(`${lng}: Классика и прочие режимы без изменений — тексты по-прежнему про цифру, и glyphs=false совпадает с вызовом без флага`, async () => {
      const t = await tOf(lng);
      let digit = 0;
      for (const h of allHints()) {
        for (const st of STEPS) {
          const c = hintStepCopy(t, h, st, true);
          expect(hintStepCopy(t, h, st, true, false)).toEqual(c);
          for (const s of texts(c)) {
            expect(s).not.toMatch(GLYPH[lng]);
            if (DIGIT[lng].test(s)) digit++;
          }
        }
      }
      expect(digit).toBeGreaterThan(10);
    });
  }

  it("каждый ключ `_glyphs` имеет базовый ключ; набор ключей одинаков в en/uk/ru (с поправкой на формы множественного числа)", () => {
    const glyphKeys = (o: Record<string, unknown>, path = ""): string[] =>
      Object.entries(o).flatMap(([k, v]) =>
        v && typeof v === "object" ? glyphKeys(v as Record<string, unknown>, `${path}${k}.`) : k.includes("_glyphs") ? [`${path}${k}`] : [],
      );
    const norm = (k: string) => k.replace(/_(one|few|many|other)$/, "");
    const sets = (Object.keys(LOCALES) as Lang[]).map((lng) => {
      const keys = glyphKeys(LOCALES[lng] as Record<string, unknown>);
      const flat = (path: string): unknown => path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], LOCALES[lng]);
      for (const k of keys) expect(flat(k.replace("_glyphs", "")), `${lng} ${k}`).toBeTypeOf("string");
      return [...new Set(keys.map(norm))].sort();
    });
    expect(sets[0]!.length).toBeGreaterThan(10);
    expect(sets[1]).toEqual(sets[0]);
    expect(sets[2]).toEqual(sets[0]);
  });
});

describe("PD-215: шит правила подсказки в Глифах", () => {
  for (const lng of Object.keys(LOCALES) as Lang[]) {
    it(`${lng}: вступление шита в Глифах говорит «знак»/«shape», в Классике — прежняя строка`, async () => {
      const t = await tOf(lng);
      const g = t("hint.rule.lead", { context: "glyphs" });
      expect(g).not.toBe(t("hint.rule.lead"));
      expect(g).not.toMatch(DIGIT[lng]);
      expect(g).toMatch(GLYPH[lng]);
      expect(t("hint.rule.lead")).not.toMatch(GLYPH[lng]);
      if (lng !== "en") expect(t("hint.rule.lead")).toMatch(DIGIT[lng]);
    });
  }
});
