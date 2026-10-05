/**
 * PD-203: кольцо по закрытому юниту (melody.css). Reduce Motion — через множитель `--mo` (tokens.css), без отдельных правил:
 * шаг арпеджио обнуляется (весь юнит разом), длительность 1 с, только прозрачность; цвет — `--ink` 2 px.
 */
import { describe, expect, it } from "vitest";
import { boardSide, chrome0 } from "../play/fitModel";
import { HINT_FIT, HINT_LINE_EM, hintForm } from "./hintFit";

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


/**
 * PD-206 (QA PD-204): строка о звуке до первого хода при крупном шрифте налезала на поле и пад. Зазор с подсказкой —
 * size-контейнер (поле от подсказки не зависит), форма — контейнер-запросом; числа CSS = `HINT_FIT` (melody/hintFit.ts).
 * Геометрия — модель экрана партии `play/fitModel.ts` (те же числа, что `--chrome`): выбранная форма умещается в зазор.
 */
describe("PD-206: строка о звуке умещается в зазор (CSS + модель геометрии)", () => {
  const block = (sel: string) => {
    const i = css.indexOf(sel);
    expect(i, sel).toBeGreaterThanOrEqual(0);
    return css.slice(i, css.indexOf("}", i) + 1);
  };

  it("зазор с подсказкой — size-контейнер; пороги контейнер-запросов = HINT_FIT", () => {
    expect(block(".play-fit > .gap:has(> .melody-hint)")).toMatch(/container-type: size/);
    expect(css).toContain(`@container (min-width: ${HINT_FIT.shortMinEm}em)`);
    expect(css).toContain(
      `@container ((min-width: ${HINT_FIT.long4MinEm}em) and (min-height: ${HINT_FIT.long4MinHEm}em)) or ((min-width: ${HINT_FIT.long3MinEm}em) and (min-height: ${HINT_FIT.long3MinHEm}em)) or ((min-width: ${HINT_FIT.long2MinEm}em) and (min-height: ${HINT_FIT.long2MinHEm}em))`,
    );
  });

  it("по умолчанию (нет места) и при AX3 — «осталось N»: значок и короткая форма скрыты, полная — только для скринридера", () => {
    for (const pre of ["", ':root[data-type="ax3"] ']) {
      expect(block(`${pre}.status.melody-hint > svg,`)).toMatch(/display: none/);
      expect(block(`${pre}.status.melody-hint > .mh-long {`)).toMatch(/clip-path: inset\(50%\)/);
    }
    expect(block(':root[data-type="ax3"] .status.melody-hint > .mh-left')).toMatch(/display: inline/);
    // Короткая форма — одна строка без переноса.
    const short = css.slice(css.indexOf(`@container (min-width: ${HINT_FIT.shortMinEm}em)`));
    expect(short.slice(short.indexOf(".mh-short {"), short.indexOf("}", short.indexOf(".mh-short {")))).toMatch(/white-space: nowrap/);
  });

  // Ширина текстов в em шрифта подсказки (system-ui = SF, замер Chromium/WebKit): одна строка; ширина колонки текста на ≤ 4/3/2 строки.
  const SHORT_EM = { en: 9.3, uk: 9.21, ru: 9.75 };
  const LONG3_EM = { en: 11.15, uk: 14.95, ru: 15.1 };
  const LONG2_EM = { en: 16.8, uk: 20.8, ru: 21.6 };
  const LONG4_EM = { en: 8.45, uk: 10.9, ru: 11.05 };
  const SCREENS = [
    { w: 320, h: 568 },
    { w: 375, h: 667 },
    { w: 390, h: 844 },
    { w: 393, h: 852, saTop: 59, saBot: 34 },
    { w: 430, h: 932, saTop: 59, saBot: 34 },
  ];
  // Dynamic Type iOS: xS…xxxL, AX1…AX5 (px корневого шрифта).
  const REMS = [14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53];

  it("для каждого экрана и размера шрифта выбранная форма не выше и не шире места в зазоре (поле и пад не перекрыты)", () => {
    for (const s of SCREENS)
      for (const rem of REMS) {
        const i = { vh: s.h, width: s.w - 32, rem, saTop: s.saTop ?? 0, saBot: s.saBot ?? 0, hintable: true };
        const board = boardSide(i);
        const contentH = 1.15 * rem + (i.vh - chrome0(i) - board); // зазор минус отступы 8 + 8
        const contentW = s.w - 32;
        const form = hintForm(contentW, contentH, rem);
        const f = 0.88 * rem; // шрифт подсказки
        const lineH = HINT_LINE_EM * rem;
        const tag = `${s.w}x${s.h} rem ${rem}: ${form}`;
        expect(contentH, tag).toBeGreaterThanOrEqual(lineH - 0.01); // одна строка помещается всегда
        if (rem >= 36) expect(form, tag).toBe("none");
        for (const lang of ["en", "uk", "ru"] as const) {
          if (form === "short") expect(SHORT_EM[lang] * f + 1.05 * f + 6, `${tag} ${lang}`).toBeLessThanOrEqual(contentW);
          if (form === "long") {
            const text = contentW - 32 - 1.05 * f - 6; // отступы подсказки, значок, зазор
            const lines = text >= LONG2_EM[lang] * f ? 2 : text >= LONG3_EM[lang] * f ? 3 : text >= LONG4_EM[lang] * f ? 4 : Infinity;
            expect(lines * lineH, `${tag} ${lang}`).toBeLessThanOrEqual(contentH + 0.01);
          }
        }
      }
  });

  it("решение QA PD-204: 320 и 390 при xxxL (23 px) — короткая/полная по месту, AX3 — «осталось N»; iPhone 16 при 17 px — полная", () => {
    const at = (w: number, h: number, rem: number, sa = 0) => {
      const i = { vh: h, width: w - 32, rem, saTop: sa, saBot: 0, hintable: true };
      return hintForm(w - 32, 1.15 * rem + (h - chrome0(i) - boardSide(i)), rem);
    };
    expect(at(320, 568, 23)).toBe("short");
    expect(at(320, 568, 40)).toBe("none");
    expect(at(390, 844, 40)).toBe("none");
    expect(at(393, 852, 17, 93)).toBe("long");
  });
});
