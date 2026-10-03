/**
 * PD-144: строки хаба Play и меню «⋯» — одинаковые ключи/плюральные формы/плейсхолдеры в en, uk, ru; единственное имя нового
 * пазла (`play.newPuzzle`): `solved.newGame` удалён из локалей и из исходников.
 */
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";

// @types/node в этом пакете нет — файловую систему берём через динамический импорт (как в hint.ring.css.test.ts).
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
  readdirSync(p: string): string[];
  readFileSync(p: string | URL, enc: "utf8"): string;
  statSync(p: string): { isDirectory(): boolean };
};
const { readdirSync, readFileSync, statSync } = fs;

const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (k: string) => k.replace(PLURAL, "");
const placeholders = (s: string) => [...s.matchAll(/{{(\w+)}}/g)].map((m) => m[1]).sort().join(",");

type Tree = { [k: string]: string | Tree };
const flat = (t: Tree, prefix = ""): Record<string, string> =>
  Object.entries(t).reduce<Record<string, string>>((acc, [k, v]) => (typeof v === "string" ? { ...acc, [prefix + k]: v } : { ...acc, ...flat(v, `${prefix}${k}.`) }), {});
const locales = { en: en as unknown as Tree, uk: uk as unknown as Tree, ru: ru as unknown as Tree };
const hub = (l: Tree) => flat(l.play as Tree);

describe("play.hub.* и play.cellsLeftShort", () => {
  it("базовые ключи и вложенные группы совпадают во всех локалях", () => {
    const keys = (l: Tree) => [...new Set(Object.keys(hub(l)).filter((k) => k.startsWith("hub.") || k.startsWith("cellsLeftShort")).map(base))].sort();
    expect(keys(locales.uk)).toEqual(keys(locales.en));
    expect(keys(locales.ru)).toEqual(keys(locales.en));
    expect(keys(locales.en)).toContain("cellsLeftShort");
    expect(keys(locales.en)).toContain("hub.more");
  });

  it("плюральные формы: en one/other; uk и ru one/few/many/other", () => {
    const forms = (l: Tree, key: string) =>
      Object.keys(hub(l))
        .filter((k) => base(k) === key && PLURAL.test(k))
        .map((k) => k.match(PLURAL)![1])
        .sort();
    for (const key of ["hub.left", "hub.clues"]) {
      expect(forms(locales.en, key)).toEqual(["one", "other"]);
      expect(forms(locales.uk, key)).toEqual(["few", "many", "one", "other"]);
      expect(forms(locales.ru, key)).toEqual(["few", "many", "one", "other"]);
    }
  });

  it("нет пустых строк; плейсхолдеры одинаковы", () => {
    const e = hub(locales.en);
    for (const l of [locales.uk, locales.ru]) {
      for (const [k, v] of Object.entries(hub(l))) {
        if (!k.startsWith("hub.") && !k.startsWith("cellsLeftShort")) continue;
        expect(v, k).not.toBe("");
        const ref = e[k] ?? e[`${base(k)}_other`] ?? e[base(k)];
        expect(ref, `нет образца в en для ${k}`).toBeDefined();
        expect(placeholders(v), k).toBe(placeholders(ref as string));
      }
    }
  });

  it("причина недоступного Fill в Ink и имя кнопки «⋯» заданы во всех локалях", () => {
    for (const l of Object.values(locales)) {
      expect(hub(l)["hub.fillInkOff"]).toBeTruthy();
      expect(hub(l)["hub.more"]).toBeTruthy();
      expect(hub(l)["fillNone"] ?? hub(l)["hint.fillNone"]).toBeTruthy();
    }
  });
});

describe("один «New puzzle»", () => {
  it("`solved.newGame` нет ни в одной локали; `play.newPuzzle` есть во всех", () => {
    for (const l of Object.values(locales)) {
      expect((l.solved as Tree).newGame).toBeUndefined();
      expect((l.play as Tree).newPuzzle).toBeTruthy();
    }
  });

  it("ключ `solved.newGame` не упоминается в исходниках (кроме этого теста)", () => {
    const root = new URL("..", import.meta.url).pathname;
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = `${dir}/${name}`;
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|json|css)$/.test(name) && name !== "hub.i18n.test.ts" && readFileSync(p, "utf8").includes("solved.newGame")) hits.push(p);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
