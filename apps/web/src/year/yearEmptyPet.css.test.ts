/**
 * PD-299 (место 4): CSS спящей кляксы пустого Year — зона 64×64, высота блока та же, что со знаком P4 (PD-295: пустой год не выше,
 * достижимость Oct–Dec не меняется), 320 pt + AX3 — клякса уходит. Разметка и поведение — `YearScreen.pet.test.tsx`.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const STYLES = new URL("../styles/", import.meta.url);
const css = (f: string) => fs.readFileSync(new URL(f, STYLES), "utf8");

describe("место 4: CSS", () => {
  it("CSS: зона 64×64, высота блока прежняя — 64 + 6 = знак 56 + поле 14 (PD-295: пустой год не выше)", () => {
    const pcss = css("pet.css");
    const ycss = css("year.css");
    const rule = pcss.match(/\.year-empty > \.year-empty-pet \{([^}]*)\}/)![1]!;
    expect(rule).toMatch(/width: 64px;/);
    expect(rule).toMatch(/height: 64px;/);
    const mb = Number(rule.match(/margin: 0 0 (\d+)px -7px;/)![1]);
    const markMb = Number(ycss.match(/\.year-empty-mark \{[^}]*margin: 0 0 (\d+)px;/)![1]);
    expect(64 + mb).toBe(56 + markMb);
    // 320 pt + AX3 — клякса уходит (текст важнее).
    expect(pcss).toMatch(/@media \(max-width: 359px\) \{\s*:root\[data-type="ax3"\] \.year-empty > \.year-empty-pet \{\s*display: none;/);
  });
});
