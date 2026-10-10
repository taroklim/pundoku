/**
 * PD-292: прокручиваемые панели (вкладки `.scroll.tab-pane` и слой `.scroll.push-layer`) оставляют под элементом, к которому
 * прокручивают (фокус с клавиатуры, scrollIntoView), то же поле, что и под последним блоком: 16 px + таб-бар + нижний inset
 * (на десктопе C `--tabbar-h: 0`, остаётся 16 px). Иначе Firefox срезал нижнюю линию кольца фокуса на компакте C.
 * Док подсказки своего scroll-margin-bottom больше не держит — иначе отступы сложились бы. Живая проверка — design/pd292-check.mjs.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const read = (f: string) => fs.readFileSync(new URL(`../styles/${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(css: string, sel: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (m[1]!.split(",").map((s) => s.trim()).includes(sel)) return m[2]!;
  return "";
}

describe("PD-292: scroll-padding-bottom у прокручиваемых панелей", () => {
  it(".scroll: scroll-padding-bottom = padding-bottom = 16 px + таб-бар + нижний inset", () => {
    const body = rule(read("shell.css"), ".scroll");
    expect(body).toMatch(/(^|\s)padding-bottom: calc\(16px \+ var\(--tabbar-h\) \+ var\(--sa-bot\)\);/);
    expect(body).toMatch(/scroll-padding-bottom: calc\(16px \+ var\(--tabbar-h\) \+ var\(--sa-bot\)\);/);
  });
  it("док подсказки не добавляет свой scroll-margin-bottom (не складывается с полем панели)", () => {
    expect(read("hint.css")).not.toMatch(/scroll-margin-bottom/);
  });
  it("десктоп C: таб-бара нет — поле 16 px (--tabbar-h: 0px)", () => {
    expect(rule(read("desk.css"), ".shell.desk")).toMatch(/--tabbar-h: 0px;/);
  });
});
