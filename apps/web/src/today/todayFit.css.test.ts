/**
 * PD-147 (b): сторожа по тексту CSS Today на нескроллящемся экране партии (раскладку jsdom не считает; живая проверка —
 * design/today-fix-check.mjs). Держат правила, на которых стоит «одна строка» шапки и зазора под резерв `--chrome` (play.css).
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const css = fs.readFileSync(new URL("../styles/today.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");

describe("Today на экране партии: резерв держится правилами CSS", () => {
  it("заголовок — одна строка (uk/ru при крупном тексте не рвутся по буквам, en не меняется)", () => {
    expect(css).toMatch(/\.today\.play-fit \.title \{[^}]*white-space: nowrap[^}]*text-overflow: ellipsis/);
    expect(css).toMatch(/:root:not\(:lang\(en\)\) \.today\.play-fit \.title \{ font-size: min\(1\.62rem, 11vw\)/);
  });

  it("строка «Ink mode» в зазоре компактна, сноска и (при AX3) подпись остаются только для скринридера", () => {
    expect(css).toMatch(/\.play-fit > \.gap:has\(\.ink-entry\) \{ padding-block: 4px/);
    expect(css).toMatch(/\.play-fit \.ink-entry \.ink-row \{ min-height: 44px/);
    expect(css).toMatch(/\.play-fit \.ink-entry \.ink-foot \{ position: absolute/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.play-fit \.ink-entry \.row-t \{ position: absolute/);
  });

  it("PD-159: при AX3 экран дня — дата своей строкой, сложность не усекается, источник виден; не влезло — страница прокручивается", () => {
    expect(css).not.toMatch(/\.today-status \.source \{ position: absolute/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.today\.play-fit \.subline \{ flex-wrap: wrap/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.today\.play-fit \.subline > \.sub-day \{ flex-basis: 100%/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.today\.play-fit \.subline > \.sub-day \+ \.sep \{ display: none/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.scroll:has\(\.today\.play-fit\) \{ overflow-y: auto/);
    expect(css).toMatch(/:root\[data-type="ax3"\] \.today\.play-fit > \.gap, :root\[data-type="ax3"\] \.today\.play-fit > \.hint-dock \{ flex-shrink: 0/);
    // поле уступает две добавочные строки, но не глубже min(160 px, прежнего размера); правило не действует в ландшафте (там своё)
    expect(css).toMatch(
      /@media \(orientation: portrait\), \(min-height: 501px\) \{ :root\[data-type="ax3"\] \.today\.play-fit \.board \{ --side: max\(min\(160px, 100dvh - var\(--chrome\)\), 100dvh - var\(--chrome\) - 1\.15rem - 1rem - 2px\); width: min\(100%, var\(--side\)\); --s: calc\(\(min\(100cqi, var\(--side\)\) - 2 \* var\(--box-gap\)\) \/ 9\)/,
    );
  });

  it("архивный день: ряд «‹ Year» над заголовком входит в обвязку поля (--bar), иначе ряд действий уходит под таб-бар", () => {
    expect(css).toMatch(/\.today\.archive\.play-fit \{ --bar: calc\(max\(44px, 1\.2rem\) - 8px\)/);
    const play = fs.readFileSync(new URL("../styles/play.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
    expect(play).toMatch(/\.play-fit \{ --extra: 0px; --bar: 0px; --chrome0: calc\( var\(--bar\) \+ var\(--sa-top\)/);
  });

  it("PD-159: при AX3 ряды бокса заданы размером клетки (WebKit не пересчитывал aspect-ratio-ряды после включения data-type)", () => {
    expect(css).toMatch(/:root\[data-type="ax3"\] \.today\.play-fit \.box \{ grid-auto-rows: var\(--s\)/);
  });

  it("PD-159 → PD-249: ландшафт телефона — две колонки в styles/landscape.css (держит landscape.css.test.ts); портрет не затронут", () => {
    const play = fs.readFileSync(new URL("../styles/play.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
    expect(play).not.toMatch(/@media \(orientation: landscape\)/);
    // портретная формула поля прежняя (её держит pd144.css.test.ts)
    expect(play).toMatch(/\.play-fit \.board \{ width: min\(100%, calc\(100dvh - var\(--chrome\)\)\)/);
  });
});
