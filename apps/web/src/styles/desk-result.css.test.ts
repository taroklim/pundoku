/**
 * PD-268: сторожа по тексту desk-result.css (раскладку jsdom не считает; живая проверка — design/pd268-check.mjs). Держат:
 * (1) каждое правило — только раскладке C (`.shell.desk`, в т. ч. компакт): телефон и его ландшафт их не видят; (2) решено:
 * карточка в инспекторе компактная (без подзаголовка, тепловая карта ≤ 150, цифры 2 колонки), Grid ∞ ≤ 150, маска края и
 * запас снизу телефонной «решено» сняты; (3) компакт: контент не сдвигается сайдбаром (`--desk-x: 0`), сайдбар поверх с тенью,
 * действия 2 × 2, клавиши ≥ 52, шпаргалки нет; (4) подключён сразу после desk-play.css, landscape.css — последним.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const raw = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
const css = strip(raw("./desk-result.css"));

function selectors(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = (m[1] ?? "").trim().replace(/^.*@[^{]*$/, "");
    if (!head || head.startsWith("@")) continue;
    for (const sel of head.split(/,(?![^(]*\))/)) out.push(sel.trim());
  }
  return out;
}
const rule = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at) + 1);
};

describe("desk-result.css", () => {
  it("каждый селектор — внутри `.shell.desk` (телефон этих правил не видит)", () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(30);
    expect(all.filter((s) => !s.startsWith(".shell.desk"))).toEqual([]);
  });

  it("решено: карточка компактная, Grid ∞ ≤ 150, телефонные маска и запас сняты", () => {
    expect(rule(".shell.desk .desk-insp .card > .sub")).toContain("display: none;");
    expect(rule(".shell.desk .desk-insp .card .heat, .shell.desk .desk-insp .card .legend")).toContain("width: min(100%, 150px);");
    expect(rule(".shell.desk .desk-insp .card .rows")).toContain("grid-template-columns: 1fr 1fr;");
    expect(rule(".shell.desk .desk-grid > .board-wrap")).toContain("width: 150px;");
    expect(rule(".shell.desk .scroll:has(.desk-play .card)")).toContain("mask-image: none;");
    expect(rule(".shell.desk .play.desk-play:has(.card)")).toContain("padding-bottom: 0;");
  });

  it("компакт: контент не сдвигается, сайдбар поверх; действия 2 × 2, клавиши ≥ 52, без шпаргалки", () => {
    expect(rule(".shell.desk.compact")).toContain("--desk-x: 0px;");
    expect(rule(".shell.desk.compact > .sidebar")).toContain("box-shadow:");
    expect(rule(".shell.desk.compact .desk-insp .actions")).toContain("grid-template-columns: 1fr 1fr;");
    expect(rule(".shell.desk.compact .desk-insp .key")).toContain("min-height: 52px;");
    expect(rule(".shell.desk.compact .insp-keys")).toContain("display: none;");
  });

  it("подключён сразу после desk-play.css; landscape.css — последним", () => {
    const imports = [...raw("../main.tsx").matchAll(/import "\.\/styles\/([\w-]+\.css)";/g)].map((m) => m[1]);
    const at = imports.indexOf("desk-result.css");
    expect(imports[at - 1]).toBe("desk-play.css");
    expect(imports.at(-1)).toBe("landscape.css");
  });
});
