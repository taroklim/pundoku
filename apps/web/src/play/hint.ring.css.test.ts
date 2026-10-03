/**
 * PD-139 D1: метка «почему» не должна занимать слоты заметок 3×3. Заметки занимают всю клетку (`.marks` inset: 0),
 * поэтому кружок в углу всегда ложился на заметку «1». Страж — по тексту CSS: кольцо обязано быть рамкой по
 * периметру клетки (inset у границы, обводка), а не маленькой фигурой с абсолютными left/top и фиксированным размером.
 */
import { describe, expect, it } from "vitest";

// vitest отдаёт пустую строку для `.css?raw`, а @types/node в этом пакете нет — читаем файл через динамический node:fs.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/hint.css", import.meta.url), "utf8");
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

function rule(sel: string): string {
  const m = stripped.match(new RegExp(`(?:^|\\})\\s*${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
  expect(m, `правило ${sel}`).not.toBeNull();
  return m![1]!;
}

describe("hint.css: кольцо «почему» вне зоны заметок", () => {
  const body = rule(".hint-ring");
  it("рамка по периметру клетки: inset у границы, без left/top/width/height", () => {
    const inset = body.match(/inset:\s*([\d.]+)px/);
    expect(inset).not.toBeNull();
    // глифы заметок начинаются ≥ 3 px от края клетки (320 pt), рамка (inset + обводка) должна кончаться раньше
    const border = body.match(/border:\s*([\d.]+)px solid/);
    expect(border).not.toBeNull();
    expect(Number(inset![1]) + Number(border![1])).toBeLessThanOrEqual(3);
    expect(body).not.toMatch(/(^|[\s;])(left|top|right|bottom|width|height)\s*:/);
  });
  it("не круглая фигурка в углу", () => {
    expect(body).not.toMatch(/border-radius:\s*50%/);
  });
  it("различимость сохранена: цвет чернил, forced-colors и prefers-contrast правят то же правило", () => {
    expect(body).toMatch(/var\(--ink\)/);
    expect(stripped).toMatch(/@media \(forced-colors: active\)[\s\S]*\.hint-ring\s*\{[^}]*Highlight/);
    expect(stripped).toMatch(/@media \(prefers-contrast: more\)[\s\S]*\.hint-ring\s*\{[^}]*border-width:\s*2px/);
  });
});
