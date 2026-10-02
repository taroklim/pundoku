import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { HELP_BLOCKS } from "./blocks";

type Tree = { [k: string]: string | Tree };

function flatten(node: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(node)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}
const LOCALES = { en, uk, ru } as unknown as Record<string, { help: Tree; settings: Tree; today: Tree; year: Tree }>;
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");
const help = (l: string) => flatten(LOCALES[l]!.help, "help");
/** Ключи, которые добавили PD-120/PD-121/PD-123 вне блока `help.*`. */
const extra = (l: string) => {
  const s = flatten(LOCALES[l]!.settings, "settings");
  const t = flatten(LOCALES[l]!.today, "today");
  return {
    "settings.backLabelPlay": s["settings.backLabelPlay"],
    "settings.backLabelYear": s["settings.backLabelYear"],
    "settings.helpHead": s["settings.helpHead"],
    "settings.helpRow": s["settings.helpRow"],
    "today.gridExplain": t["today.gridExplain"],
  };
};

describe("i18n: справка «How Pundoku works» (PD-120)", () => {
  it("блок help.*: те же ключи и плейсхолдеры в en, uk и ru, без пустых строк", () => {
    const e = help("en");
    for (const l of ["uk", "ru"]) {
      expect(Object.keys(help(l)).sort(), l).toEqual(Object.keys(e).sort());
      for (const [k, v] of Object.entries(help(l))) {
        expect(v.trim(), `${l} ${k}`).not.toBe("");
        expect(placeholders(v), `${l} ${k}`).toBe(placeholders(e[k]!));
      }
    }
  });

  it("у каждого блока справки есть заголовок и текст; год описывает все шесть меток", () => {
    for (const l of Object.keys(LOCALES)) {
      const h = help(l);
      for (const id of HELP_BLOCKS) expect(h[`help.${id}.title`], `${l} ${id}`).toBeTruthy();
      for (const k of ["solved", "fixes", "help", "late", "unfinished", "missed"]) expect(h[`help.year.${k}`], `${l} year.${k}`).toBeTruthy();
      expect(h["help.technique.p2"], l).toBeTruthy();
    }
  });

  it("строки Settings, подписи «Back» и пояснение Grid ∞ есть во всех локалях", () => {
    const e = extra("en");
    for (const l of ["uk", "ru"]) {
      for (const [k, v] of Object.entries(extra(l))) {
        expect(v, `${l} ${k}`).toBeTruthy();
        expect(placeholders(v!), `${l} ${k}`).toBe(placeholders(e[k as keyof typeof e]!));
      }
    }
  });

  it("термины едины: «Fixes»/«Виправлення»/«Исправления», «Grid ∞» переведён; в справке нет «Corrections»", () => {
    const joined = (l: string) => Object.values(help(l)).join(" ");
    expect(joined("en")).not.toMatch(/corrections/i);
    expect(help("en")["help.fixes.title"]).toBe("Fixes");
    expect(help("uk")["help.fixes.title"]).toBe("Виправлення");
    expect(help("ru")["help.fixes.title"]).toBe("Исправления");
    expect(help("uk")["help.grid.title"]).toBe("Сітка ∞");
    expect(help("ru")["help.grid.title"]).toBe("Сетка ∞");
  });

  it("язык решателя не просачивается на Today: в пояснении Grid ∞ нет «solvable» / «розв’язн» / «решаем»", () => {
    for (const l of Object.keys(LOCALES)) {
      const t = flatten(LOCALES[l]!.today, "today");
      const text = [t["today.gridExplain"], t["today.gridNotSolvable"], t["today.gridSolvable"]].join(" ");
      expect(text, l).not.toMatch(/solvable|розв.язн|решаем|разрешим/i);
    }
  });
});
