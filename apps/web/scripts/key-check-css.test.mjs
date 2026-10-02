// PD-142: поля проверки записи ключа — iOS не масштабирует страницу при фокусе (шрифт ≥ 16 px), цель касания ≥ 44 pt,
// неверное поле не держится на одном цвете в forced-colors. Статическая проверка исходного CSS (jsdom его не считает).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/settings.css"), "utf8");
const rule = css.match(/\.settings-checkinput \{([^}]*)\}/)[1];

describe("CSS поля проверки ключа (PD-142)", () => {
  it("шрифт ≥ 16 px (без iOS-зума), в том числе при 1rem на крупном тексте", () => {
    expect(Number(rule.match(/font-size:\s*max\((\d+)px/)[1])).toBeGreaterThanOrEqual(16);
  });
  it("высота поля ≥ 44 pt", () => {
    expect(Number(rule.match(/min-height:\s*(\d+)px/)[1])).toBeGreaterThanOrEqual(44);
  });
  it("сетка полей перетекает в столбец (AX3, 320 pt), а не обрезается", () => {
    expect(css).toMatch(/\.settings-checkgrid \{[^}]*auto-fit/);
  });
  it("forced-colors: у поля своя рамка, а «не совпало» не сводится к цвету", () => {
    const fc = css.slice(css.indexOf("@media (forced-colors: active)"));
    expect(fc).toMatch(/\.settings-checkinput[,\s{]/);
    expect(fc).toMatch(/\.settings-checkinput\[aria-invalid="true"\] \{[^}]*border-style: double/);
  });
});
