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

  it("источник сетки при AX3 не занимает вторую строку зазора", () => {
    expect(css).toMatch(/:root\[data-type="ax3"\] \.play-fit \.today-status \.source \{ position: absolute/);
  });

  it("архивный день: ряд «‹ Year» над заголовком входит в обвязку поля (--bar), иначе ряд действий уходит под таб-бар", () => {
    expect(css).toMatch(/\.today\.archive\.play-fit \{ --bar: calc\(max\(44px, 1\.2rem\) - 8px\)/);
    const play = fs.readFileSync(new URL("../styles/play.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ");
    expect(play).toMatch(/\.play-fit \{ --extra: 0px; --bar: 0px; --chrome0: calc\( var\(--bar\) \+ var\(--sa-top\)/);
  });
});
