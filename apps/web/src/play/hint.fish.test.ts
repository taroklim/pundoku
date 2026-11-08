/**
 * PD-305 (п. 7): лесенка подсказок рыб не знает (PD-304: X-Wing/Swordfish есть в решателе, но не в лесенке). На сетке класса
 * `expert_plus`, доведённой подсказками до места, где нужна рыба, лесенка отвечает `none/beyond` — UI не падает и честно пишет,
 * что нужна техника, которой Pundoku пока не учит (X-Wing и дальше), а на доске всё верно.
 */
import { createInstance } from "i18next";
import type { TFunction } from "i18next";
import type { Hint } from "@pundoku/engine";
import { generate, nextHint } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { hintStepCopy } from "./hintCopy";

const LOCALES = { en, uk, ru } as const;
const tOf = async (lng: keyof typeof LOCALES): Promise<TFunction> => {
  const i = createInstance();
  await i.init({ lng, resources: { [lng]: { translation: LOCALES[lng] } }, interpolation: { escapeValue: false } });
  return i.t;
};

/** Идём по лесенке, ставя цифры и вычёркивая кандидатов, пока она не остановится. */
function walk(mission: string, solution: string): { hint: Hint; values: number[] } {
  const values = [...mission].map(Number);
  const notes = new Array<number>(81).fill(0x3fe);
  for (let i = 0; i < 400; i++) {
    const hint = nextHint({ givens: mission, values: values.join(""), solution, notes });
    if (hint.kind !== "step") return { hint, values };
    const place = hint.placement ?? hint.leadsTo ?? null;
    if (place) values[place.cell] = place.digit;
    for (const e of hint.eliminations ?? []) notes[e.cell] = notes[e.cell]! & ~(1 << e.digit);
  }
  throw new Error("лесенка не остановилась");
}

describe("PD-305: подсказка на сетке, где нужна рыба", () => {
  it("expert_plus: лесенка доходит до none/beyond, не дорешав сетку; текст честный в en/uk/ru", async () => {
    let stuck: Hint | null = null;
    for (const seed of ["pd305-fish-a", "pd305-fish-b", "pd305-fish-c"]) {
      const p = generate({ difficulty: "expert_plus", seed });
      const { hint, values } = walk(p.mission, p.solution);
      if (hint.kind === "none" && hint.reason === "beyond") {
        expect(values.some((v) => v === 0)).toBe(true); // сетка не дорешана — остановились на рыбе
        expect(values.every((v, c) => v === 0 || v === Number(p.solution[c]))).toBe(true); // и всё поставленное верно
        stuck = hint;
        break;
      }
    }
    expect(stuck).not.toBeNull();
    const words = { en: /X-Wing/, uk: /X-Wing/, ru: /X-Wing/ } as const;
    for (const lng of ["en", "uk", "ru"] as const) {
      const t = await tOf(lng);
      const copy = hintStepCopy(t, stuck!, 1, true);
      expect(copy.title, lng).toBeTruthy();
      expect(copy.body, lng).toMatch(words[lng]);
      expect(copy.foot, lng).toBeTruthy();
    }
  });
});
