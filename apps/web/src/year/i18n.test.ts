import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

type Tree = { [k: string]: string | Tree };

/** Плоские ключи блока `year.*` → значения. */
function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");
const year = (l: { year: Tree }) => flatten(l.year);
const bases = (l: { year: Tree }) => [...new Set(Object.keys(year(l)).map(base))].sort();
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");

describe("i18n: блок year.* (PD-25)", () => {
  it("ключи en, uk и ru совпадают (без пропусков и лишних)", () => {
    expect(bases(uk as { year: Tree })).toEqual(bases(en as { year: Tree }));
    expect(bases(ru as { year: Tree })).toEqual(bases(en as { year: Tree }));
  });

  it("плюральные формы: en one/other, uk и ru one/few/many/other", () => {
    const forms = (l: { year: Tree }, key: string) =>
      Object.keys(year(l))
        .filter((k) => base(k) === key && PLURAL.test(k))
        .map((k) => k.match(PLURAL)![1])
        .sort();
    for (const key of ["totalsDays", "monthSummary"]) {
      expect(forms(en as { year: Tree }, key)).toEqual(["one", "other"]);
      expect(forms(uk as { year: Tree }, key)).toEqual(["few", "many", "one", "other"]);
      expect(forms(ru as { year: Tree }, key)).toEqual(["few", "many", "one", "other"]);
    }
  });

  it("нет пустых строк; плейсхолдеры одинаковы во всех локалях", () => {
    const e = year(en as { year: Tree });
    for (const l of [uk, ru] as { year: Tree }[]) {
      for (const [k, v] of Object.entries(year(l))) {
        expect(v, k).not.toBe("");
        const ref = e[k] ?? e[`${base(k)}_other`] ?? e[base(k)];
        expect(ref, `нет образца в en для ${k}`).toBeDefined();
        expect(placeholders(v), k).toBe(placeholders(ref as string));
      }
    }
  });
});
