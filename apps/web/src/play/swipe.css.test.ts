/**
 * PD-242 (QA PD-226 Low): красная подложка «Удалить» (.srow > .del, styles/hub.css) закрашена только в состояниях, когда её
 * видно (.dragging / .open / .closing / .committing). В покое прозрачна — иначе её край просвечивает розовой каймой сквозь
 * сглаживание скруглённого угла карточки «Режимы» (светлая тема).
 */
import { describe, expect, it } from "vitest";

// vitest отдаёт пустую строку для `.css?raw`, а @types/node в этом пакете нет — читаем файл через динамический node:fs.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/hub.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const block = (sel: string) => {
  const i = css.indexOf(`${sel} {`);
  expect(i, sel).toBeGreaterThanOrEqual(0);
  return css.slice(i, css.indexOf("}", i));
};

describe("hub.css: подложка .del", () => {
  it("в покое прозрачна; --wax только в .dragging/.open/.closing/.committing", () => {
    expect(block(".srow > .del")).toMatch(/background: transparent;/);
    expect(block(".srow:is(.dragging, .open, .closing, .committing) > .del")).toMatch(/background: var\(--wax\);/);
    const wax = [...css.matchAll(/([^{}]+)\{[^}]*background(?:-color)?: var\(--wax\)/g)].map((m) => (m[1] ?? "").trim());
    for (const sel of wax.filter((x) => x.includes(".del"))) expect(sel).toMatch(/^\.srow:is\(\.dragging, \.open, \.closing, \.committing\) > \.del$/);
  });
});
