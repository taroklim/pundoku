/**
 * PD-249: ландшафт телефона в две колонки. Сторожа по тексту CSS (раскладку jsdom не считает; живая проверка и попиксельное
 * сравнение портрета с main — design/pd249-shots.mjs). Держат: (1) все ландшафтные правила — в ОДНОМ @media, портрет и
 * планшет/десктоп их не видят; (2) раскладку «поле слева на всю высоту, панель справа»; (3) прежние портретные правила целы.
 */
import { describe, expect, it } from "vitest";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const raw = (f: string) => fs.readFileSync(new URL(f, import.meta.url), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
const LAND = "@media (orientation: landscape) and (max-height: 500px)";

/** Тело @media-блока с позиции `at` (с учётом вложенных скобок) и индекс закрывающей скобки. */
function blockAt(css: string, at: number): { body: string; end: number } {
  let depth = 0;
  const open = css.indexOf("{", at);
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return { body: css.slice(open + 1, i), end: i };
  }
  throw new Error("незакрытый @media");
}
function rule(block: string, sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\:>]/g, "\\$&");
  const m = block.match(new RegExp(`(?:^ ?|\\} )${esc} \\{([^}]*)\\}`));
  expect(m, `правило ${sel}`).not.toBeNull();
  return m![1]!;
}

const css = strip(raw("./landscape.css"));
const land = blockAt(css, 0);

describe("landscape.css: всё — внутри одного ландшафтного @media", () => {
  it("файл = ровно один блок «ландшафт и высота ≤ 500»; вне его правил нет (портрет, планшет, десктоп не затронуты)", () => {
    expect(css.startsWith(LAND + " {")).toBe(true);
    expect(land.end).toBe(css.length - 1);
    expect(land.body).not.toMatch(/@media/);
  });

  it("подключён последним в main.tsx (перекрывает отступы колонок из shell/play/hint.css без роста специфичности)", () => {
    const imports = [...raw("../main.tsx").matchAll(/import "\.\/styles\/([\w-]+\.css)";/g)].map((m) => m[1]);
    expect(imports.at(-1)).toBe("landscape.css");
  });

  it("другие таблицы стилей ландшафтных правил больше не держат (PD-159 перенесён сюда), портретная модель поля прежняя", () => {
    for (const f of ["./play.css", "./today.css", "./shell.css", "./hint.css"]) expect(strip(raw(f))).not.toMatch(/@media \(orientation: landscape\)/);
    const play = strip(raw("./play.css"));
    expect(play).toMatch(/\.play-fit \.board \{ width: min\(100%, calc\(100dvh - var\(--chrome\)\)\); margin: 0 auto;/);
    expect(play).toMatch(/\.board-wrap \{ padding: 12px max\(16px, var\(--sa-r\)\) 0 max\(16px, var\(--sa-l\)\); container-type: inline-size;/);
    expect(play).toMatch(/\.play \{ flex: 1; display: flex; flex-direction: column; \}/);
    // AX3-правило Today по-прежнему только для портрета/высоких окон — в ландшафте его заменяет раскладка колонок
    expect(strip(raw("./today.css"))).toMatch(/@media \(orientation: portrait\), \(min-height: 501px\) \{ :root\[data-type="ax3"\] \.today\.play-fit \.board/);
  });
});

describe("экран партии в ландшафте: поле слева на всю высоту, панель справа", () => {
  const b = land.body;

  it("две колонки: поле (safe-area слева + сторона поля) и остальное; ряды шапка · подпись · зазор · панель", () => {
    const fit = rule(b, ".play-fit");
    expect(fit).toMatch(/display: grid;/);
    expect(fit).toMatch(/grid-template-columns: calc\(max\(16px, var\(--sa-l\)\) \+ var\(--side\)\) minmax\(0, 1fr\);/);
    expect(fit).toMatch(/grid-template-rows: auto auto minmax\(0, 1fr\) auto;/);
  });

  it("сторона поля — высота окна без таб-бара и safe-area, не уже 160 и не отнимает у панели меньше 280 px", () => {
    const fit = rule(b, ".play-fit");
    expect(fit).toMatch(/--side: max\( 160px, min\( 100dvh - var\(--sa-top\) - var\(--sa-bot\) - var\(--tabbar-h\) - 24px, 100vw - max\(16px, var\(--sa-l\)\) - max\(16px, var\(--sa-r\)\) - 24px - 280px \) \);/);
    const board = rule(b, ".play-fit .board");
    expect(board).toMatch(/width: var\(--side\);/);
    expect(board).toMatch(/--s: calc\(\(var\(--side\) - 2 \* var\(--box-gap\)\) \/ 9\);/);
    expect(rule(b, ".play-fit .box")).toMatch(/grid-auto-rows: var\(--s\);/);
  });

  it("поле — колонка 1 на все ряды; шапка, подпись, зазор, панель/док — колонка 2", () => {
    const wrap = rule(b, ".play-fit > .board-wrap");
    expect(wrap).toMatch(/grid-column: 1; grid-row: 1 \/ -1;/);
    expect(wrap).toMatch(/padding: calc\(var\(--sa-top\) \+ 12px\) 0 12px max\(16px, var\(--sa-l\)\);/);
    expect(rule(b, ".play-fit > :not(.board-wrap)")).toMatch(/grid-column: 2; min-width: 0;/);
    expect(rule(b, ".play-fit > .toolbar")).toMatch(/grid-row: 1;/);
    expect(rule(b, ".play-fit > .subline")).toMatch(/grid-row: 2;/);
    expect(rule(b, ".play-fit > .gap")).toMatch(/grid-row: 3;/);
    expect(b).toMatch(/\.play-fit > \.pad-wrap, \.play-fit > \.hint-dock \{ grid-row: 4; \}/);
    // правая колонка у правого края держит safe-area (свои отступы right из shell/play/hint.css), левый отступ — зазор колонок
    expect(b).toMatch(/\.play-fit > \.toolbar, \.play-fit > \.subline, \.play-fit > \.pad-wrap \{ padding-left: 0; \}/);
    expect(rule(b, ".play-fit > .hint-dock")).toMatch(/margin-left: 0;/);
  });

  it("не влезло (AX3, 320-класс) — страница партии докручивается, ничего не режется", () => {
    expect(rule(b, ".scroll:has(.play-fit)")).toMatch(/overflow-y: auto;/);
    expect(b).toMatch(/\.scroll:has\(\.play-fit\) > \.panel, \.scroll:has\(\.play-fit\) \.play \{ min-height: auto; \}/);
  });

  it("панель ожидания генерации — квадрат на месте поля", () => {
    const wait = rule(b, ".play-fit .board-wrap > .wait");
    expect(wait).toMatch(/width: var\(--side\); height: var\(--side\);/);
  });

  it("карточка «решено» и Grid ∞ — колонка по центру, карта и мини-поле не выше видимой области", () => {
    expect(rule(b, ".play:not(.play-fit):not(.play-hub) > .card")).toMatch(/max-width: 480px; margin-inline: auto;/);
    expect(rule(b, ".play:not(.play-fit):not(.play-hub) > section:not(.card)")).toMatch(/max-width: 512px; margin-inline: auto;/);
    expect(rule(b, ".play:not(.play-fit):not(.play-hub) > .card .heat")).toMatch(/max-width: min\(100%, 100dvh - /);
    expect(rule(b, ".play:not(.play-fit):not(.play-hub) > section .board-wrap")).toMatch(/max-width: min\(100%, 100dvh - /);
  });
});
