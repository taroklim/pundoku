/**
 * PD-269: сторожа по тексту desk-screens.css (раскладку jsdom не считает; живая проверка ширин, наведения, курсора и фокуса,
 * а также «телефон и компакт не изменились» попиксельно — design/pd269-check.mjs). Держат: (1) каждый селектор — только для
 * раскладки с сайдбаром (начинается с `.shell.desk`); (2) наведение и курсор — только при точном указателе; (3) шкала ширин —
 * четыре значения §2 + потолок поля, колонки экранов стоят на них; (4) наведение — три производных значения §2 (светлая/тёмная),
 * нового оттенка нет; (5) файл подключён.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const raw = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
const css = strip(raw("./desk-screens.css"));

/** Правила верхнего уровня и внутри @-блоков: селекторы (без вложенных скобок в теле) и тело. */
function rules(text: string): { sel: string[]; body: string }[] {
  const out: { sel: string[]; body: string }[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = (m[1] ?? "").trim();
    if (!head || head.startsWith("@")) continue;
    // Запятые внутри :is()/:not() — не разделители списка селекторов.
    const sel: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of head) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        sel.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    sel.push(cur.trim());
    out.push({ sel, body: m[2] ?? "" });
  }
  return out;
}

/** Тело @-блока по заголовку (все вхождения). */
function blocks(head: string): string[] {
  const res: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(head, from);
    if (at < 0) return res;
    const open = css.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      if (css[i] === "}" && --depth === 0) {
        res.push(css.slice(open + 1, i));
        from = i;
        break;
      }
    }
  }
}

const HOVER = "@media (hover: hover) and (pointer: fine)";

describe("desk-screens.css", () => {
  it("каждый селектор начинается с .shell.desk — телефон, ландшафт и компакт правил не видят", () => {
    const all = rules(css).flatMap((r) => r.sel);
    expect(all.length).toBeGreaterThan(30);
    expect(all.filter((s) => !/^\.shell\.desk\b/.test(s))).toEqual([]);
  });

  it("наведение и курсор — только внутри (hover: hover) and (pointer: fine)", () => {
    const inside = blocks(HOVER);
    expect(inside.length).toBe(1);
    const hoverBody = inside[0]!;
    const outside = css.replace(hoverBody, "");
    expect(outside).not.toMatch(/:hover/);
    expect(outside).not.toMatch(/cursor:/);
    expect(hoverBody).toMatch(/\.shell\.desk \.board, \.shell\.desk \.board \.cell \{ cursor: default; \}/);
    expect(hoverBody).toMatch(/:is\(:disabled, \[aria-disabled="true"\]\) \{ cursor: default; \}/);
    expect(hoverBody).toMatch(/\.shell\.desk \.st-switch \{ cursor: pointer; \}/);
    // Наведение не перебивает нажатие.
    const hovers = rules(hoverBody).flatMap((r) => r.sel).filter((s) => s.includes(":hover"));
    expect(hovers.length).toBeGreaterThan(10);
    expect(hovers.filter((s) => !/:hover:not\(:active\)|:hover:not\(:has\(\.st-switch:active\)\)|button\.cell:not\(\.sel\):hover/.test(s))).toEqual([]);
  });

  it("шкала ширин — 320 / 560 / 640 / 780 и потолок поля 720; колонки экранов стоят на токенах", () => {
    expect(css).toMatch(/\.shell\.desk \{ --w-menu: 320px; --w-sheet: 560px; --w-read: 640px; --w-year: 780px; --w-field: 720px;/);
    const col = (sel: string) => rules(css).find((r) => r.sel.includes(sel))?.body ?? "";
    expect(col(".shell.desk .hub-scroll > :not(.mode-page)")).toContain("var(--w-read)");
    expect(col(".shell.desk .settings > :not(.settings-navbar)")).toContain("var(--w-read)");
    expect(col(".shell.desk .year > :not(.toolbar, .year-totals)")).toContain("var(--w-year)");
    expect(col(".shell.desk .today:not(.play-fit) > .card")).toContain("var(--w-read)");
    expect(col(".shell.desk .play-fit .board")).toMatch(/width: min\(100%, 100dvh - var\(--chrome\), var\(--w-field\)\);/);
    expect(col(".shell.desk .play-fit")).toContain("--desk-col: min(var(--w-field), 100dvh - var(--chrome))");
    expect(col(".shell.desk .play-fit > :not(.toolbar, .subline, .sr-only, .hint-dock)")).toContain("var(--desk-col)");
    // Никаких «во всю ширину окна»: ни vw, ни 100vw в колонках.
    expect(css).not.toMatch(/\d+vw\b/);
  });

  it("наведение — три производных значения §2, светлая и тёмная; без нового оттенка", () => {
    expect(css).toMatch(/\.shell\.desk \{[^}]*--hover: rgba\(60, 60, 67, 0\.06\); --key-hover: #f3f3f4; --hover-ring: rgba\(59, 72, 176, 0\.5\);/);
    const dark = blocks("@media (prefers-color-scheme: dark)");
    expect(dark.join(" ")).toMatch(/--hover: rgba\(235, 235, 245, 0\.08\); --key-hover: #2d2d2f; --hover-ring: rgba\(140, 150, 255, 0\.55\);/);
    // Все остальные цвета — токены (var(...)), системные цвета forced-colors или currentColor.
    const literals = css
      .replace(/--(hover|key-hover|hover-ring): [^;]+;/g, "")
      .match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi);
    expect(literals).toBeNull();
  });

  it("кольцо фокуса строк в карточках с overflow: hidden — внутрь; программный фокус заголовка без кольца", () => {
    expect(css).toMatch(/\.shell\.desk :is\(\.settings-row, \.settings-rowbtn\):focus-visible \{ outline: 2px solid transparent; outline-offset: -2px; border-radius: 0; box-shadow: inset 0 0 0 2px var\(--ink\); \}/);
    expect(css).toMatch(/\.shell\.desk \.ink-row:focus-visible \{[^}]*box-shadow: inset 0 0 0 2px var\(--ink\);/);
    expect(css).toContain('.shell.desk [tabindex="-1"]:focus:not(:focus-visible) { outline: none; }');
  });

  it("подключён в main.tsx после desk.css и до landscape.css (тот — последний)", () => {
    const main = raw("../main.tsx");
    const a = main.indexOf('import "./styles/desk.css";');
    const b = main.indexOf('import "./styles/desk-screens.css";');
    const c = main.indexOf('import "./styles/landscape.css";');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});
