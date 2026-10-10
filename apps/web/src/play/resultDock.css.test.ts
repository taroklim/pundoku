/**
 * PD-285 (design/pd285-result-card.md §6): правила дока действий в play.css — текстом (геометрию проверяет живой прогон
 * design/pd285-check.mjs). Логика дока (где он есть) — resultDock.test.tsx.
 */
import { describe, expect, it } from "vitest";
import { DOCK_LANDSCAPE_QUERY } from "./resultDock";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const read = (f: string) => fs.readFileSync(new URL(`../styles/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
/** Все объявления селектора `sel` по файлу (в т. ч. из списков селекторов), склеенные. */
function rule(css: string, sel: string): string {
  let out = "";
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1]!.split(",").map((s) => s.trim()).includes(sel)) out += m[2]!;
  return out;
}
const css = read("play.css");

describe("play.css: правила дока (§6)", () => {
  it("док: sticky с bottom: 0 (а не tabbar + inset — отступ сложился бы дважды), непрозрачный фон, сетка 2 колонки", () => {
    const body = rule(css, ".result-dock");
    expect(body).toMatch(/position: sticky;/);
    expect(body).toMatch(/(^|\s)bottom: 0;/);
    expect(body).toMatch(/margin-top: auto;/);
    expect(body).toMatch(/background: var\(--bg\);/);
    expect(body).toMatch(/grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\);/);
    expect(body).toMatch(/z-index: 2;/);
    expect(body).not.toMatch(/backdrop-filter/); // стекло — только у таб-бара
  });
  it("прокрутка с доком: низ = таб-бар + inset (без запаса 16 px), маски 35 % нет; Watch и одинокая New puzzle — во всю ширину", () => {
    const sc = rule(css, ".scroll:has(.play-result-dock)");
    expect(sc).toMatch(/(^|\s)padding-bottom: calc\(var\(--tabbar-h\) \+ var\(--sa-bot\)\);/);
    expect(sc).toMatch(/(^|\s)mask-image: none;/);
    expect(rule(css, ".result-dock > .tl-watch")).toMatch(/grid-column: 1 \/ -1;/);
    const solo = rule(css, ".result-dock > .newgrid:only-child");
    expect(solo).toMatch(/grid-column: 1 \/ -1;/);
    expect(solo).toMatch(/background: var\(--ink-tint\);/);
  });
  it("под стеклом таб-бара — фон дока (::after высотой таб-бар + inset), а не проступающая карточка", () => {
    const after = rule(css, ".result-dock::after");
    expect(after).toMatch(/top: 100%;/);
    expect(after).toMatch(/height: calc\(var\(--tabbar-h\) \+ var\(--sa-bot\)\);/);
    expect(after).toMatch(/background: var\(--bg\);/);
    expect(after).toMatch(/pointer-events: none;/);
  });
  it("растушёвка 16 px; при Reduce Transparency / Increase Contrast и forced-colors — линия вместо неё", () => {
    expect(rule(css, ".result-dock::before")).toMatch(/height: 16px;/);
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{[^@]*\.result-dock::before \{\s*display: none;[^@]*box-shadow: 0 -1px 0 var\(--hairline\);/);
    expect(css).toMatch(/@media \(forced-colors: active\) \{[^@]*\.result-dock::before \{\s*display: none;[^@]*border-top: 1px solid CanvasText;/);
  });
  it("десктоп C и ландшафт дока не знают (условие — в JS, resultDock.ts)", () => {
    for (const f of ["landscape.css", "desk.css", "desk-play.css", "desk-result.css"]) expect(read(f), f).not.toMatch(/result-dock/);
  });
  it("ландшафт в resultDock.ts — то же условие, что landscape.css (один @media на весь файл)", () => {
    expect(read("landscape.css")).toContain(`@media ${DOCK_LANDSCAPE_QUERY} {`);
  });
});
