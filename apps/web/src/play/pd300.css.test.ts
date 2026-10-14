/**
 * PD-300: сторожа по тексту CSS (раскладку jsdom не считает; живая проверка — design/pd300-check.mjs). Держат: прибавка клавиш
 * `--key-grow` — те же числа, что в fitModel.ts; `--chrome` с прежними 56 px (поле не меняется); прибавка выключена в ландшафте,
 * на десктопе C и при AX3; видимость клавиш без новых цветов; счётчик остатка не мельче 11 px.
 */
import { describe, expect, it } from "vitest";
import { FIT } from "./fitModel";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const read = (name: string) => fs.readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const squash = (s: string) => s.replace(/\s+/g, " ");
const play = read("play.css");
const landscape = squash(read("landscape.css"));
const desk = read("desk-play.css");
const glyphs = read("glyphs.css");

function body(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/,\s*/g, ",\\s*");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  expect(m, `правило ${selector}`).not.toBeNull();
  return squash(m![1]!).trim();
}

describe("PD-300: клавиши 1–9 на крупных iPhone", () => {
  it("--key-grow: min(ширина, запас) в [0, потолок] — числа модели", () => {
    const b = body(play, ".play-fit > .pad-wrap");
    expect(b).toContain(
      `--key-grow: clamp(0px, min((100cqi - ${FIT.growFrom}px) * ${FIT.growPerPx}, (100dvh - var(--chrome) - 100cqi - ${FIT.growMargin}px) * ${FIT.growShare}), ${FIT.growMax}px)`,
    );
  });

  it("клавиша = 56 + прибавка; цифра растёт с прибавкой под потолком 7.5cqi, насыщенность 600; счётчик ≥ 11 px", () => {
    const key = body(play, ".key");
    expect(key).toMatch(new RegExp(`min-height: calc\\(${FIT.keyH}px \\+ var\\(--key-grow, 0px\\)\\)`));
    const kd = body(play, ".key .kd");
    expect(kd).toContain(`font-size: min(calc(1.24rem + var(--key-grow, 0px) * ${FIT.digitPerPx}), ${FIT.digitCapCqi * 100}cqi)`);
    expect(kd).toMatch(/font-weight: 600/);
    expect(body(play, ".key .kr")).toMatch(/font-size: calc\(11px \+ var\(--key-grow, 0px\) \* 0\.1\)/);
  });

  it("поле не меняется: в --chrome0 по-прежнему 56 px клавиш, прибавки там нет", () => {
    const chrome = squash(play.match(/--chrome0:\s*calc\(([\s\S]*?)\);\s*--chrome:/)![1]!);
    expect(chrome).toContain(`+ ${FIT.keyH}px +`);
    expect(chrome).not.toContain("key-grow");
    expect(squash(play)).not.toMatch(/--chrome[0]?:[^;]*key-grow/);
  });

  it("прибавка выключена: AX3, ландшафт телефона, десктоп C", () => {
    expect(body(play, ':root[data-type="ax3"] .play-fit > .pad-wrap')).toMatch(/--key-grow: 0px/);
    expect(landscape).toMatch(/@media \(orientation: landscape\) and \(max-height: 500px\) \{[\s\S]*\.play-fit > \.pad-wrap \{ --key-grow: 0px; \}/);
    expect(body(desk, ".shell.desk .desk-insp .pad-wrap")).toMatch(/--key-grow: 0px/);
  });

  it("знак режима «Глифы» растёт с той же прибавкой; без неё — прежние min(24px, 6.4cqi)", () => {
    const gl = body(glyphs, ".gl-pad .kd .gl");
    expect(gl).toContain("width: min(calc(24px + var(--key-grow, 0px) * 0.4), calc(6.4cqi + var(--key-grow, 0px) * 0.1))");
  });

  it("кромка клавиши — существующие токены линий (без новых цветов)", () => {
    const key = body(play, ".key");
    expect(key).toMatch(/box-shadow: inset 0 0 0 var\(--rule-thin-w\) var\(--hairline\)/);
    expect(key).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
