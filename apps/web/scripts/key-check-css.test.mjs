// PD-142: поля проверки записи ключа — iOS не масштабирует страницу при фокусе (шрифт ≥ 16 px), цель касания ≥ 44 pt,
// неверное поле не держится на одном цвете в forced-colors. Статическая проверка исходного CSS (jsdom его не считает).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/settings.css"), "utf8");
const shell = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/shell.css"), "utf8");
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
  it("нижний отступ прокрутки не меньше высоты таб-бара и учитывает safe-area (AX3: последний элемент шага выводится выше таб-бара)", () => {
    // PD-144: отступ = 16 px + высота таб-бара (`--tabbar-h`) + нижний inset; `--tabbar-h` не меньше суммы отступов бара и вкладки
    const pad = shell.match(/\.scroll \{[^}]*padding-bottom:\s*calc\((\d+)px \+ var\(--tabbar-h\) \+ var\(--sa-bot\)\)/);
    expect(pad).not.toBeNull();
    const barH = shell.match(/--tabbar-h:\s*calc\((\d+)px/);
    expect(barH).not.toBeNull();
    const tabbar = shell.match(/\.tabbar \{[^}]*padding:\s*(\d+)px [^;]*calc\((\d+)px \+ var\(--sa-bot\)\)/);
    const tabMin = shell.match(/\.tab \{[^}]*min-height:\s*(\d+)px/);
    // таб-бар: верхний + нижний padding + min-height вкладки
    expect(Number(barH[1])).toBeGreaterThanOrEqual(Number(tabbar[1]) + Number(tabbar[2]) + Number(tabMin[1]));
    expect(Number(pad[1])).toBeGreaterThan(0); // воздух над баром
  });
});
