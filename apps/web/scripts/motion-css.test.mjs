// Система движения (PD-89): reduced motion живёт в ОДНОМ месте — множители `--mo`/`--mk` в tokens.css; остальные
// таблицы стилей не дублируют `@media (prefers-reduced-motion)`. Reduced-transparency и forced-colors остаются.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "styles");
const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
// Комментарии вырезаны: в них правило упоминается словами.
const read = (f) => readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

describe("CSS движения", () => {
  it("prefers-reduced-motion объявлен ровно один раз — в tokens.css, и обнуляет --mo", () => {
    const hits = files.filter((f) => /@media\s*\(prefers-reduced-motion/.test(read(f)));
    expect(hits).toEqual(["tokens.css"]);
    expect(read("tokens.css")).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{\s*--mo:\s*0;\s*--mk:\s*0?\.72;/);
  });

  it("по умолчанию множители равны 1 и заведены кривые", () => {
    const css = read("tokens.css");
    expect(css).toMatch(/--mo:\s*1;/);
    expect(css).toMatch(/--mk:\s*1;/);
    for (const k of ["--e-out", "--e-spring", "--e-ring"]) expect(css).toContain(k);
  });

  it("forced-colors и reduced-transparency не потеряны", () => {
    expect(files.some((f) => read(f).includes("forced-colors: active"))).toBe(true);
    expect(files.some((f) => read(f).includes("prefers-reduced-transparency"))).toBe(true);
  });

  it("в keyframes движения только transform/opacity/цвет: нет анимации размеров и позиции", () => {
    const css = files.map(read).join("\n");
    const kf = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?\})\s*\}/g)].map((m) => m[1]).join("\n");
    expect(kf).not.toMatch(/\b(width|height|top|left|margin|padding)\s*:/);
  });
});
