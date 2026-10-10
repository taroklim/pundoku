/**
 * PD-266: сторожа по тексту desk.css (раскладку jsdom не считает; живая проверка и сравнение телефона до/после —
 * design/pd266-check.mjs). Держат: (1) каждое правило файла достаётся только раскладке с сайдбаром — селектор начинается с
 * `.shell.desk` или с классов, которые существуют только в ней (`.sidebar`, `.side-*`, `.mode-page`): телефон, его ландшафт
 * и компакт этих правил не видят; (2) таб-бар скрыт и его место отдано; (3) стекло сайдбара с непрозрачным фолбэком на всех
 * трёх условиях, как у таб-бара; (4) файл подключён.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const raw = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
const css = strip(raw("./desk.css"));

/** Все селекторы всех правил (включая вложенные в @media/@supports). */
function selectors(text: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of text.matchAll(re)) {
    const head = (m[1] ?? "").trim().replace(/^.*@[^{]*$/, "");
    if (!head || head.startsWith("@")) continue;
    for (const sel of head.split(",")) out.push(sel.trim());
  }
  return out;
}
const DESK_ONLY = /^(\.shell\.desk\b|\.sidebar\b|\.side-[a-z-]+\b|\.mode-page\b)/;

/** Тело блока (@media/@supports) по его заголовку. */
function block(head: string): string {
  const at = css.indexOf(head);
  expect(at, head).toBeGreaterThanOrEqual(0);
  let depth = 0;
  const open = css.indexOf("{", at);
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("незакрытый блок");
}

describe("desk.css", () => {
  it("каждый селектор — только для раскладки с сайдбаром", () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(20);
    expect(all.filter((s) => !DESK_ONLY.test(s))).toEqual([]);
  });

  it("таб-бар скрыт, его высота отдана (--tabbar-h: 0), контент отступает на --desk-x", () => {
    expect(css).toContain(".shell.desk > .tabbar { display: none; }");
    expect(css).toMatch(/\.shell\.desk \{[^}]*--tabbar-h: 0px;/);
    expect(css).toContain(".shell.desk > .stack { margin-left: var(--desk-x); }");
    expect(css).toContain(".shell.desk > .push-layer { left: var(--desk-x); }");
    expect(css).toMatch(/\.shell\.desk\.side-off \{ --desk-x: 0px; \}/);
    expect(css).toContain(".sidebar[hidden] { display: none; }");
  });

  it("стекло сайдбара — с непрозрачным фолбэком: без backdrop-filter, Reduce Transparency, Increase Contrast", () => {
    expect(css).toMatch(/\.sidebar \{[^}]*background: var\(--glass-fill\);[^}]*backdrop-filter: blur/);
    for (const head of [
      "@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))",
      "@media (prefers-reduced-transparency: reduce)",
      "@media (prefers-contrast: more)",
    ]) {
      expect(block(head)).toMatch(/\.sidebar \{[^}]*background: var\(--glass-solid\);/);
    }
  });

  it("подключён в main.tsx", () => {
    expect(raw("../main.tsx")).toContain('import "./styles/desk.css";');
  });
});
