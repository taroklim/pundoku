/**
 * PD-203: кольцо по закрытому юниту (melody.css). Reduce Motion — через множитель `--mo` (tokens.css), без отдельных правил:
 * шаг арпеджио обнуляется (весь юнит разом), длительность 1 с, только прозрачность; цвет — `--ink` 2 px.
 */
import { describe, expect, it } from "vitest";

// vitest отдаёт пустую строку для `.css?raw`, а @types/node в этом пакете нет — читаем файл через динамический node:fs.
const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/melody.css", import.meta.url), "utf8");

describe("Reduce Motion и вид кольца (CSS)", () => {
  it("шаг кольца и бег гасятся множителем --mo: при Reduce Motion весь юнит разом, 1 с, только прозрачность", () => {
    expect(css).toMatch(/animation-delay: calc\(var\(--mu, 0\) \* 1ms \+ var\(--mi, 0\) \* 110ms \* var\(--mo\)\)/);
    expect(css).toMatch(/animation: melodyRing calc\(560ms \* var\(--mo\) \+ 1000ms \* \(1 - var\(--mo\)\)\)/);
    const kf = css.slice(css.indexOf("@keyframes melodyRing"), css.indexOf("}", css.indexOf("100%")) + 1);
    expect(kf).not.toMatch(/transform|scale|translate/);
    expect(css).toMatch(/box-shadow: inset 0 0 0 2px var\(--ink\)/);
  });
});

