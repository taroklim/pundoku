import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

type Tree = { [k: string]: string | Tree };
type Locale = { ink: Tree };

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
const ink = (l: unknown) => flatten((l as Locale).ink);
const bases = (l: unknown) => [...new Set(Object.keys(ink(l)).map(base))].sort();
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");

describe("i18n: блок ink.* (PD-74)", () => {
  it("ключи en, uk и ru совпадают (без пропусков и лишних)", () => {
    expect(bases(uk)).toEqual(bases(en));
    expect(bases(ru)).toEqual(bases(en));
  });

  it("плюральные формы: en one/other, uk и ru one/few/many/other", () => {
    const forms = (l: unknown, key: string) =>
      Object.keys(ink(l))
        .filter((k) => base(k) === key && PLURAL.test(k))
        .map((k) => k.match(PLURAL)![1])
        .sort();
    expect(forms(en, "yearValue")).toEqual(["one", "other"]);
    expect(forms(uk, "yearValue")).toEqual(["few", "many", "one", "other"]);
    expect(forms(ru, "yearValue")).toEqual(["few", "many", "one", "other"]);
  });

  it("плейсхолдеры одинаковы во всех локалях, значения непустые", () => {
    const e = ink(en);
    for (const l of [uk, ru]) {
      const o = ink(l);
      for (const [k, v] of Object.entries(o)) {
        expect(v.trim(), k).not.toBe("");
        const enKey = PLURAL.test(k) ? Object.keys(e).find((x) => base(x) === base(k)) : k;
        expect(placeholders(v), k).toBe(placeholders(e[enKey!]!));
      }
    }
  });
});
