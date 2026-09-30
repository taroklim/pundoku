import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

type Block = Record<string, string>;
const tl = (l: object) => (l as { timelapse: Block }).timelapse;
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");
const bases = (b: Block) => [...new Set(Object.keys(b).map(base))].sort();
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");

describe("i18n: блок timelapse.* (PD-75)", () => {
  it("ключи en, uk и ru совпадают", () => {
    expect(bases(tl(uk))).toEqual(bases(tl(en)));
    expect(bases(tl(ru))).toEqual(bases(tl(en)));
  });

  it("плюральные формы: en one/other, uk и ru one/few/many/other", () => {
    const forms = (b: Block, key: string) =>
      Object.keys(b)
        .filter((k) => base(k) === key && PLURAL.test(k))
        .map((k) => k.match(PLURAL)![1])
        .sort();
    for (const key of ["fpMoves", "fpBlots", "fpCorrections"]) {
      expect(forms(tl(en), key)).toEqual(["one", "other"]);
      expect(forms(tl(uk), key)).toEqual(["few", "many", "one", "other"]);
      expect(forms(tl(ru), key)).toEqual(["few", "many", "one", "other"]);
    }
  });

  it("нет пустых строк; плейсхолдеры одинаковы во всех локалях", () => {
    const e = tl(en);
    for (const l of [uk, ru]) {
      for (const [k, v] of Object.entries(tl(l))) {
        expect(v, k).not.toBe("");
        const ref = e[k] ?? e[`${base(k)}_other`] ?? e[base(k)];
        expect(ref, `нет образца в en для ${k}`).toBeDefined();
        expect(placeholders(v), k).toBe(placeholders(ref as string));
      }
    }
  });

  it("решение владельца: en «Watch your solve», строка «нет повтора» без «warning»", () => {
    expect(tl(en).watch).toBe("Watch your solve");
    expect(tl(en).none).toBe("Replay isn’t available for this day — moves weren’t kept.");
  });
});
