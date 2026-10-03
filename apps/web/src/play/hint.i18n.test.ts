import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

type Tree = { [k: string]: string | Tree };
const hint = (l: object) => (l as { hint: Tree }).hint;
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");

function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const placeholders = (s: string) => [...new Set([...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]))].sort().join(",");
const bases = (f: Record<string, string>) => [...new Set(Object.keys(f).map(base))].sort();
const forms = (f: Record<string, string>, key: string) =>
  Object.keys(f)
    .filter((k) => base(k) === key && PLURAL.test(k))
    .map((k) => k.match(PLURAL)![1])
    .sort();

const E = flatten(hint(en));
const U = flatten(hint(uk));
const R = flatten(hint(ru));

describe("i18n: блок hint.* (PD-139)", () => {
  it("ключи en, uk и ru совпадают (с точностью до плюральных суффиксов)", () => {
    expect(bases(U)).toEqual(bases(E));
    expect(bases(R)).toEqual(bases(E));
  });

  it("hidden_single: en one/other, uk и ru one/few/many/other", () => {
    expect(forms(E, "s4.hidden_single")).toEqual(["one", "other"]);
    expect(forms(U, "s4.hidden_single")).toEqual(["few", "many", "one", "other"]);
    expect(forms(R, "s4.hidden_single")).toEqual(["few", "many", "one", "other"]);
  });

  it("нет пустых строк; плейсхолдеры каждой строки совпадают с английским образцом", () => {
    for (const [name, loc] of [["uk", U], ["ru", R]] as const) {
      for (const [k, v] of Object.entries(loc)) {
        expect(v.trim(), `${name} ${k}`).not.toBe("");
        const ref = E[k] ?? E[`${base(k)}_other`] ?? E[base(k)];
        expect(ref, `нет образца в en для ${name} ${k}`).toBeDefined();
        expect(placeholders(v), `${name} ${k}`).toBe(placeholders(ref!));
      }
    }
  });

  it("жирный «**…**» парный; девять названий блоков и девять предложных форм во всех языках", () => {
    for (const [name, loc] of [["en", E], ["uk", U], ["ru", R]] as const) {
      for (const [k, v] of Object.entries(loc)) expect((v.match(/\*\*/g) ?? []).length % 2, `${name} ${k}`).toBe(0);
      for (let i = 1; i <= 9; i++) {
        expect(loc[`box.${i}`], `${name} box.${i}`).toBeTruthy();
        expect(loc[`regionIn.box.${i}`], `${name} regionIn.box.${i}`).toBeTruthy();
      }
    }
  });

  it("термины: колонка поля — «стовпець/столбец», не «колонка»; в тексте шага нет слова «підказка/подсказка» как «clue»", () => {
    expect(Object.values(U).join(" ")).not.toMatch(/колонк/i);
    expect(Object.values(R).join(" ")).not.toMatch(/колонк/i);
    // Прежнее значение «clue» (заданная цифра, Grid ∞) переведено «клітинка/клетка»: «підказка» теперь только про лесенку.
    const today = (l: object) => flatten((l as { today: Tree }).today);
    const text = (l: object) => [today(l)["gridNotSolvable"], today(l)["gridSolvable"], today(l)["gridTap"], today(l)["gridExplain"]].join(" ");
    expect(text(uk)).not.toMatch(/підказ/i);
    expect(text(ru)).not.toMatch(/подсказ/i);
  });

  it("справка: блок help.hints есть во всех языках", () => {
    for (const l of [en, uk, ru]) {
      const h = flatten((l as unknown as { help: Tree }).help);
      for (const k of ["help.hints.title", "help.hints.p1", "help.hints.p2", "help.hints.p3"].map((x) => x.replace("help.", ""))) expect(h[k], k).toBeTruthy();
    }
  });
});
