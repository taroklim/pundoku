/**
 * PD-221: зона касания вкладки — вся её доля таб-бара, а не только видимая кнопка 50 px. Раньше мёртвыми были: верхний
 * отступ бара (6 px + линия), нижний (6 px) прямо под подписями, зазоры 2 px между вкладками, боковые поля 10 px и вся
 * полоса индикатора Home (34 px на iPhone 16) — 26–27 % видимой части бара и 52 % всего бара (стенд design/pd221-tabbar.mjs,
 * elementFromPoint по сетке 1×1 px). Расширение — прозрачный ::before кнопки: вид, пилюля и раскладка не меняются.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/shell.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * Склеенные тела ВСЕХ правил верхнего уровня, в списке селекторов которых есть ровно `sel` (элемент списка целиком, не
 * подстрока: `.tabbar` не совпадает с `.tabbar-x` или `.tabbar .tab`). QA PD-222: раньше бралось первое правило, а после
 * PD-214 первым с `.tabbar` стало групповое правило user-select — свойства бара «пропадали». Блоки @media/@supports сюда
 * не попадают (регулярка поглощает их целиком как одно «правило» с селектором-at-rule).
 */
function rule(sel: string): string {
  const bodies: string[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    if (m[1]!.split(",").map((s) => s.trim()).includes(sel)) bodies.push(m[2]!);
  }
  return bodies.join("\n");
}

describe("зона касания вкладки (shell.css)", () => {
  it("бар: верхний отступ 6 px + линия 1 px, нижний 6 px + safe area, поля max(10px, inset) — то, что покрывает ::before", () => {
    const bar = rule(".tabbar");
    expect(bar).toMatch(/padding: 6px max\(10px, var\(--sa-r\)\) calc\(6px \+ var\(--sa-bot\)\) max\(10px, var\(--sa-l\)\);/);
    expect(bar).toMatch(/border-top: 1px solid/);
    expect(bar).toMatch(/gap: 2px;/);
  });

  it(".tab — якорь для ::before (position: relative)", () => {
    expect(rule(".tab")).toMatch(/position: relative;/);
  });

  it(".tab::before — прозрачная зона до верха бара, до низа экрана (через safe area) и до середины зазоров", () => {
    const b = rule(".tab::before");
    expect(b).toMatch(/content: "";/);
    expect(b).toMatch(/position: absolute;/);
    expect(b).toMatch(/top: -7px;/);
    expect(b).toMatch(/bottom: calc\(-6px - var\(--sa-bot\)\);/);
    expect(b).toMatch(/left: -1px;/);
    expect(b).toMatch(/right: -1px;/);
    expect(b).not.toMatch(/background/);
  });

  it("крайние вкладки забирают боковые поля бара", () => {
    expect(rule(".tab:first-of-type::before")).toMatch(/left: calc\(-1 \* max\(10px, var\(--sa-l\)\)\);/);
    expect(rule(".tab:last-of-type::before")).toMatch(/right: calc\(-1 \* max\(10px, var\(--sa-r\)\)\);/);
  });
});
