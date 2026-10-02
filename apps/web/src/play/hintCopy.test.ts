import { createInstance } from "i18next";
import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";
import type { Hint, MistakeHint, StepHint } from "@pundoku/engine";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { HINT_FIXTURES, playOf, withValue } from "./hint.fixtures";
import type { FixtureName } from "./hint.fixtures";
import { capFirst, hintStepCopy, regionIn } from "./hintCopy";
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

/** Та же подсказка с подменёнными цифрами шага: ответ, цифры паттерна и вычёркиваний. */
function scramble(hint: StepHint): StepHint {
  const bump = (d: number) => ((d + 3) % 9) + 1;
  const ex = hint.explanation;
  const params = { ...ex.params } as Record<string, unknown>;
  if (typeof params["digit"] === "number") params["digit"] = bump(params["digit"] as number);
  if (Array.isArray(params["digits"])) params["digits"] = (params["digits"] as number[]).map(bump);
  return {
    ...hint,
    explanation: { ...ex, params } as StepHint["explanation"],
    ...(hint.placement ? { placement: { ...hint.placement, digit: bump(hint.placement.digit) } } : {}),
    ...(hint.eliminations ? { eliminations: hint.eliminations.map((e) => ({ ...e, digit: bump(e.digit) })) } : {}),
    ...(hint.leadsTo ? { leadsTo: { ...hint.leadsTo, digit: bump(hint.leadsTo.digit) } } : {}),
    assumes: hint.assumes.map((e) => ({ ...e, digit: bump(e.digit) })),
  } as StepHint;
}

describe("тексты лесенки: цифра шага не утекает ни на одной ступени", () => {
  for (const lng of Object.keys(LOCALES) as Lang[]) {
    it(`${lng}: подмена всех цифр шага не меняет ни одной строки`, async () => {
      const t = await tOf(lng);
      for (const name of NAMES) {
        const h = computeHint(playOf(name)) as StepHint;
        const s = scramble(h);
        // Проверка чувствительности: подмена правда меняет подсказку (иначе тест ничего не проверяет).
        expect(JSON.stringify(s)).not.toBe(JSON.stringify(h));
        for (const st of STEPS) expect(hintStepCopy(t, s, st), `${lng} ${name} шаг ${st}`).toEqual(hintStepCopy(t, h, st));
      }
    });
  }

  it("ветка ошибки: цифра дубликата не попадает в текст", async () => {
    const t = await tOf("en");
    const p = playOf("nakedSingle");
    const step = computeHint(p) as StepHint;
    const bad = computeHint(withValue(p, step.placement!.cell, (step.placement!.digit % 9) + 1)) as MistakeHint;
    expect(bad.kind).toBe("mistake");
    const other: Hint = { ...bad, explanation: { ...bad.explanation, params: { ...bad.explanation.params, digit: 9 } } as MistakeHint["explanation"] };
    expect(hintStepCopy(t, other, 1)).toEqual(hintStepCopy(t, bad, 1));
  });
});

describe("тексты лесенки: полнота и форма", () => {
  for (const lng of Object.keys(LOCALES) as Lang[]) {
    it(`${lng}: нет сырых ключей, незакрытых плейсхолдеров и пустых строк на всех техниках и ступенях`, async () => {
      const t = await tOf(lng);
      for (const name of NAMES) {
        const h = computeHint(playOf(name));
        for (const st of STEPS) {
          const c = hintStepCopy(t, h, st);
          for (const s of [c.title, c.body, ...c.key.map((k) => k.label)]) {
            expect(s.trim(), `${lng} ${name} ${st}`).not.toBe("");
            expect(s, `${lng} ${name} ${st}`).not.toMatch(/\{\{|\}\}|^hint\.|^technique\./);
          }
        }
      }
    });
  }

  it("в en ступень 4 одиночки с одним/несколькими свидетелями — разные формы (one/other)", async () => {
    const t = await tOf("en");
    const h = computeHint(playOf("hiddenSingle")) as StepHint;
    const one = { ...h, cells: { ...h.cells, witnesses: h.cells.witnesses.slice(0, 1) } };
    const many = { ...h, cells: { ...h.cells, witnesses: [...h.cells.witnesses, ...h.cells.witnesses].slice(0, 3) } };
    expect(hintStepCopy(t, one, 4).body).toMatch(/circled cell already holds/);
    expect(hintStepCopy(t, many, 4).body).toMatch(/circled cells already hold/);
  });

  it("с заметками-допущениями у одиночки отдельная формулировка, у паттерна — приписка", async () => {
    const t = await tOf("en");
    const single = computeHint(playOf("nakedSingle")) as StepHint;
    const assumes = [{ cell: 0, digit: 1 as const }];
    expect(hintStepCopy(t, { ...single, assumes }, 4).body).toMatch(/struck in your notes/);
    expect(hintStepCopy(t, { ...single, assumes }, 4).body).not.toMatch(/eight of the nine/);
    const pattern = computeHint(playOf("pointing")) as StepHint;
    expect(hintStepCopy(t, { ...pattern, assumes }, 4).body).toMatch(/already struck in your notes/);
    expect(hintStepCopy(t, pattern, 4).body).not.toMatch(/struck in your notes/);
  });

  it("«ничего не нашёл» и ошибка не зависят от ступени; у none есть подвал, у ошибки ключ одной метки", async () => {
    const t = await tOf("uk");
    const none = computeHint(playOf("beyond"));
    expect(hintStepCopy(t, none, 1)).toEqual(hintStepCopy(t, none, 4));
    expect(hintStepCopy(t, none, 1).foot).toBeTruthy();
    expect(hintStepCopy(t, none, 1).key).toEqual([]);
    const p = playOf("nakedSingle");
    const s = computeHint(p) as StepHint;
    const bad = computeHint(withValue(p, s.placement!.cell, (s.placement!.digit % 9) + 1));
    const c = hintStepCopy(t, bad, 2);
    expect(c.key).toHaveLength(1);
    expect(c).toEqual(hintStepCopy(t, bad, 4));
  });

  it("области: номера с 1, предлог внутри строки; capFirst для начала предложения", async () => {
    const t = await tOf("ru");
    expect(regionIn(t, { kind: "row", index: 5, unit: 5 })).toBe("в строке 6");
    expect(regionIn(t, { kind: "box", index: 0, unit: 18 })).toBe("в верхнем левом блоке");
    expect(capFirst("у рядку 6")).toBe("У рядку 6");
    expect(capFirst("")).toBe("");
  });

  it("ступень 3 называет клетки по строке и столбцу, но не цифру", async () => {
    const t = await tOf("en");
    const h = computeHint(playOf("nakedSingle")) as StepHint;
    const cell = h.cells.target[0]!;
    const c = hintStepCopy(t, h, 3);
    expect(c.title).toBe(`Row ${Math.floor(cell / 9) + 1}, column ${(cell % 9) + 1}.`);
  });
});
