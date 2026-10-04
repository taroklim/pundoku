/**
 * PD-152: вордмарк в режимах без палитры бренда. Клетки «Pun» — <rect> с fill, «doku» — <path> со stroke; правило
 * только про path (как до клеточных букв) оставило бы клетки без системного цвета. Страж по тексту CSS.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const read = (f: string) => fs.readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Тело @media-блока (с учётом вложенных скобок). */
function mediaBlock(css: string, query: string): string {
  const at = css.indexOf(`@media ${query}`);
  expect(at, `@media ${query}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
  }
  throw new Error("незакрытый @media");
}

function decl(block: string, sel: string): string {
  const m = block.match(new RegExp(`${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
  expect(m, `правило ${sel}`).not.toBeNull();
  return m![1]!;
}

describe("brand.css / settings.css: вордмарк в forced-colors и печати", () => {
  it("settings.css forced-colors: path красится stroke CanvasText, клетки rect — fill CanvasText", () => {
    const block = mediaBlock(read("settings.css"), "(forced-colors: active)");
    expect(decl(block, ".settings-about-word path")).toMatch(/stroke:\s*CanvasText/);
    expect(decl(block, ".settings-about-word rect")).toMatch(/fill:\s*CanvasText/);
  });

  it("brand.css forced-colors: то же для любого .wordmark", () => {
    const block = mediaBlock(read("brand.css"), "(forced-colors: active)");
    expect(decl(block, ".wordmark path")).toMatch(/stroke:\s*CanvasText/);
    expect(decl(block, ".wordmark rect")).toMatch(/fill:\s*CanvasText/);
  });

  it("PD-155 знак P4: forced-colors — клетки rect и сплошной path красятся CanvasText; печать — чёрные", () => {
    const fc = mediaBlock(read("brand.css"), "(forced-colors: active)");
    expect(fc).toMatch(/\.brand-mark rect,\s*\.brand-mark path\s*\{[^}]*fill:\s*CanvasText/);
    const pr = mediaBlock(read("brand.css"), "print");
    expect(pr).toMatch(/\.brand-mark rect,\s*\.brand-mark path\s*\{[^}]*fill:\s*#000/);
  });

  it("печать: клетки и штрихи чёрные (ч/б), независимо от темы", () => {
    const block = mediaBlock(read("brand.css"), "print");
    expect(decl(block, ".wordmark path")).toMatch(/stroke:\s*#000/);
    expect(decl(block, ".wordmark rect")).toMatch(/fill:\s*#000/);
  });

  it("brand.css подключён в main.tsx; прозрачности и фильтров у вордмарка нет (reduced-transparency нечего ломать)", () => {
    expect(fs.readFileSync(new URL("../main.tsx", import.meta.url), "utf8")).toContain('./styles/brand.css');
    expect(read("brand.css")).not.toMatch(/opacity|filter|backdrop/);
  });
});
