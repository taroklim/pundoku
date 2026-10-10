/**
 * PD-295: экран Year прокручивается своей панелью (`.scroll.tab-pane[data-tab=year]`) до конца, и последний ряд месяцев (Oct–Dec)
 * с легендой встаёт над таб-баром с резервом 16 px + таб-бар + нижний inset (правило peek PD-144; на десктопе C — 16 px).
 * Страж от протечек на Year из правил других экранов: всё, что гасит прокрутку панели или снимает её нижний резерв
 * (`overflow: hidden`, свой `padding-bottom`), обязано быть условием `:has(...)` экрана Play/Today (`.play-fit`, `.play-hub`,
 * `.play-result-dock` PD-285), а сам Year не задаёт себе высоту/overflow (иначе полотно резалось бы внутри панели).
 * Живая проверка на всех размерах — design/pd295-check.mjs.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
  readFileSync(u: URL, enc: "utf8"): string;
  readdirSync(u: URL): string[];
};
const STYLES = new URL("../styles/", import.meta.url);
const read = (f: string) => fs.readFileSync(new URL(f, STYLES), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const files = fs.readdirSync(STYLES).filter((f) => f.endsWith(".css"));

/** Все правила файла (включая вложенные в @media/@supports): селекторы по запятой и тело. */
function rules(css: string): { sels: string[]; body: string }[] {
  const out: { sels: string[]; body: string }[] = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = m[1]!.replace(/^[\s\S]*?(@[^{]*\{)/, "").trim();
    out.push({ sels: head.split(",").map((s) => s.trim()), body: m[2]! });
  }
  return out;
}
/** Селектор, у которого субъект — сама панель прокрутки (`.scroll` как последний составной селектор). */
const scrollSubject = (sel: string) => /\.scroll(?![\w-])/.test(sel.replace(/:has\([^)]*\)/g, "").split(/[\s>+~]+/).pop() ?? "");
const PLAY_ONLY = /:has\([^)]*\.(play-fit|play-hub|play-result-dock)/;

describe("PD-295: панель Year прокручивается до конца, резерв снизу не снимается", () => {
  it(".scroll: overflow-y auto, резерв снизу = 16 px + таб-бар + нижний inset", () => {
    const base = rules(read("shell.css")).find((r) => r.sels.includes(".scroll"));
    expect(base?.body).toMatch(/overflow-y: auto;/);
    expect(base?.body).toMatch(/(^|\s)padding-bottom: calc\(16px \+ var\(--tabbar-h\) \+ var\(--sa-bot\)\);/);
  });

  it("overflow: hidden и свой padding-bottom у .scroll — только под :has() экрана партии/хаба/дока Play", () => {
    const leaks: string[] = [];
    for (const f of files)
      for (const r of rules(read(f)))
        for (const sel of r.sels) {
          if (!scrollSubject(sel) || sel === ".scroll") continue;
          if (/overflow(-y)?:\s*hidden/.test(r.body) || /(^|\s)padding-bottom:/.test(r.body))
            if (!PLAY_ONLY.test(sel) && !/^\.shell\.desk\b/.test(sel)) leaks.push(`${f}: ${sel}`);
        }
    expect(leaks).toEqual([]);
  });

  it("Year сам себе не задаёт высоту и не режет содержимое (полотно растёт, прокручивает панель)", () => {
    const year = rules(read("year.css"));
    for (const sel of [".year", ".year-months", ".year-month", ".year-legend"]) {
      const bodies = year.filter((r) => r.sels.includes(sel)).map((r) => r.body);
      expect(bodies.length, sel).toBeGreaterThan(0);
      for (const b of bodies) expect(b, sel).not.toMatch(/(^|\s)(max-)?height:|overflow(-y)?:\s*(hidden|clip|auto|scroll)/);
    }
  });

  it("десктоп C: таб-бара нет — резерв 16 px (--tabbar-h: 0px), правило .scroll не переопределено", () => {
    const desk = rules(read("desk.css"));
    expect(desk.find((r) => r.sels.includes(".shell.desk"))?.body).toMatch(/--tabbar-h: 0px;/);
  });
});
