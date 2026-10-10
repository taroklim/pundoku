/**
 * PD-267: сторожа по тексту desk-play.css и порталов (раскладку jsdom не считает; живая проверка и сравнение телефона/компакта
 * с main — design/pd267-check.mjs). Держат: (1) каждое правило файла — только раскладке с сайдбаром (`.shell.desk`): телефон,
 * его ландшафт и компакт их не видят; (2) партия — сетка «тулбар + поле | инспектор», поле до 720 по обвязке 124 px, инспектор
 * clamp(260, 20vw, 320), шпаргалка только от высоты 800; (3) слой окна сдвигает затемнения ВСЕХ портальных оверлеев к краю
 * сайдбара (`--desk-x`) и тост туда же; (4) каждый `createPortal` в приложении рисует в `usePortalHost()`, а не в `<body>`
 * напрямую — иначе новый шит на десктопе снова накрыл бы сайдбар; (5) файл подключён до landscape.css.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as {
  readFileSync(u: URL, enc: "utf8"): string;
  readdirSync(u: URL, o: { recursive: true }): string[];
};
const raw = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
const css = strip(raw("./desk-play.css"));

/** Все селекторы всех правил (включая вложенные в @media). */
function selectors(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const head = (m[1] ?? "").trim().replace(/^.*@[^{]*$/, "");
    if (!head || head.startsWith("@")) continue;
    // Запятые внутри :is(...) — не разделители правил.
    for (const sel of head.split(/,(?![^(]*\))/)) out.push(sel.trim());
  }
  return out;
}
const rule = (sel: string) => {
  const at = css.indexOf(`${sel} {`);
  expect(at, sel).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf("}", at) + 1);
};

describe("desk-play.css", () => {
  it("каждый селектор — внутри `.shell.desk` (телефон этих правил не видит; компакт — тоже .shell.desk)", () => {
    const all = selectors(css);
    expect(all.length).toBeGreaterThan(40);
    expect(all.filter((s) => !s.startsWith(".shell.desk"))).toEqual([]);
  });

  it("партия: сетка 2 × 2, обвязка поля 124 px без резерва под док, поле ≤ 720, инспектор clamp(260, 20vw, 320) на всю высоту", () => {
    expect(rule(".shell.desk")).toContain("--insp-w: clamp(260px, 20vw, 320px);");
    const grid = rule(".shell.desk .desk-play");
    expect(grid).toContain("grid-template-columns: minmax(0, 1fr) var(--insp-w);");
    expect(grid).toContain("--chrome: 124px;");
    expect(grid).toContain("--extra: 0px;");
    expect(rule(".shell.desk .desk-play > .desk-insp")).toContain("grid-row: 1 / span 2;");
    expect(rule(".shell.desk .desk-play .board")).toContain("width: min(100%, 720px, 100dvh - var(--chrome));");
    expect(rule(".shell.desk .toolbar.desk-tb")).toContain("min-height: 52px;");
  });

  it("панель 3 × 3, действия столбиком; шпаргалка — только от высоты окна 800", () => {
    expect(rule(".shell.desk .desk-insp .pad")).toContain("grid-template-columns: repeat(3, 1fr);");
    expect(rule(".shell.desk .desk-insp .actions")).toContain("grid-template-columns: 1fr;");
    expect(css).toMatch(/@media \(max-height: 799\.98px\) \{ \.shell\.desk \.insp-keys \{ display: none; \} \}/);
  });

  it("слой окна: затемнения всех портальных оверлеев и тост — от края сайдбара (--desk-x), не поверх него", () => {
    const scrims = rule(".shell.desk > .desk-layer > :is(.menu-scrim, .sheet-scrim, .st-scrim, .ink-scrim, .tl-root, .ysheet-root)");
    expect(scrims).toContain("left: var(--desk-x);");
    // Каждый корень портала из кода (первый className внутри createPortal) — в этом списке или тост.
    const roots = new Set<string>();
    for (const f of sources()) {
      const src = raw(`../${f}`);
      // Корень портала — первый className после `createPortal(` (живой регион `.sr-only` тоста — не корень оверлея).
      for (const at of [...src.matchAll(/createPortal\(/g)].map((m) => m.index!)) {
        const win = src.slice(at, at + 1200);
        const names = [...win.matchAll(/className=(?:"|\{`|\{[^"`}]*")([a-z-]+)/g)].map((m) => m[1]!).filter((c) => c !== "sr-only");
        if (names[0]) roots.add(names[0]);
      }
    }
    expect([...roots].sort()).toEqual(["ink-scrim", "menu-scrim", "sheet-scrim", "st-scrim", "tl-root", "undo-toast", "ysheet-root"]);
    for (const r of roots) if (r !== "undo-toast") expect(scrims, r).toContain(`.${r}`);
    expect(rule(".shell.desk > .desk-layer > .undo-toast")).toContain("left: calc(var(--desk-x) + 16px);");
  });

  it("подключён в main.tsx после desk.css и до landscape.css (тот — последним)", () => {
    const main = raw("../main.tsx");
    const at = main.indexOf('import "./styles/desk-play.css";');
    expect(at).toBeGreaterThan(main.indexOf('import "./styles/desk.css";'));
    expect(at).toBeLessThan(main.indexOf('import "./styles/landscape.css";'));
  });
});

/** Исходники приложения (без тестов), относительно src/. */
function sources(): string[] {
  return fs
    .readdirSync(new URL("../", import.meta.url), { recursive: true })
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
}

describe("порталы — через usePortalHost", () => {
  it("ни один createPortal не рисует в document.body напрямую", () => {
    const offenders: string[] = [];
    let portals = 0;
    for (const f of sources()) {
      // PD-285: док действий карточки «решено» — портал в элемент потока своего же экрана (`div.result-dock` после карточки,
      // только на телефоне), а не оверлей окна: слой окна ему не нужен.
      const src = raw(`../${f}`).replace(/createPortal\(actions, dock\)/g, "");
      const n = src.split("createPortal(").length - 1;
      if (n === 0) continue;
      portals += n;
      if (/document\.body\s*\)/.test(src.replace(/node !== document\.body/g, ""))) offenders.push(f);
      if (!src.includes("usePortalHost()")) offenders.push(`${f} (нет usePortalHost)`);
    }
    expect(portals).toBeGreaterThanOrEqual(10);
    expect(offenders).toEqual([]);
  });
});
