/**
 * PD-144: сторожа по тексту CSS (jsdom не считает раскладку; живая проверка — Playwright, design/pd144-impl-check.mjs).
 * Держат инварианты ТЗ §7, которые легко сломать правкой «на глаз»: кольцо фокуса внутрь (в т. ч. forced-colors), формула
 * поля нескроллящегося экрана, резерв таб-бара, отсутствие новых цветов/токенов и зашитых размеров, правила Year и peek.
 */
import { describe, expect, it } from "vitest";
import { FIT } from "./fitModel";

const fs = (await import(/* @vite-ignore */ ["node", "fs"].join(":"))) as { readFileSync(u: URL, enc: "utf8"): string };
const read = (name: string) => fs.readFileSync(new URL(`../styles/${name}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const hub = read("hub.css");
const play = read("play.css");
const shell = read("shell.css");
const settings = read("settings.css");
const year = read("year.css");
const squash = (s: string) => s.replace(/\s+/g, " ");

/** Тело первого правила с точным списком селекторов. */
function body(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/,\s*/g, ",\\s*");
  const m = css.match(new RegExp(`(?:^|\\})\\s*${esc}\\s*\\{([^}]*)\\}`));
  expect(m, `правило ${selector}`).not.toBeNull();
  return squash(m![1]!).trim();
}

describe("кольцо фокуса внутрь", () => {
  it("строки хаба (и шита режима), пункты меню: inset-тень, отрицательный offset, прозрачный outline", () => {
    const b = body(hub, ".hub-row:focus-visible,\n.menu button:focus-visible");
    expect(b).toMatch(/outline-offset: -2px/);
    expect(b).toMatch(/box-shadow: inset 0 0 0 2px var\(--ink\)/);
    expect(b).toMatch(/outline: 2px solid transparent/);
    expect(squash(hub)).toMatch(/@media \(forced-colors: active\) \{ \.hub-row:focus-visible, \.menu button:focus-visible \{ outline-color: Highlight/);
  });

  it("кнопки ActionSheet: то же, плюс forced-colors", () => {
    const b = body(settings, ".st-asheet button:focus-visible");
    expect(b).toMatch(/outline-offset: -2px/);
    expect(b).toMatch(/inset 0 0 0 2px var\(--ink\)/);
    expect(squash(settings)).toMatch(/forced-colors: active\) \{[^}]*\.st-asheet button:focus-visible \{ outline-color: Highlight/);
  });
});

describe("экран партии не скроллится: формула поля", () => {
  it("поле — min(ширина, 100dvh − --chrome), по центру; клетка считается от того же минимума", () => {
    const b = body(play, ".play-fit .board");
    expect(b).toMatch(/width: min\(100%, calc\(100dvh - var\(--chrome\)\)\)/);
    expect(b).toMatch(/margin: 0 auto/);
    expect(b).toMatch(/--s: calc\(\(min\(100cqi, 100dvh - var\(--chrome\)\) - 2 \* var\(--box-gap\)\) \/ 9\)/);
  });

  it("--chrome0 учитывает настоящую высоту таб-бара (--tabbar-h), а не зашитые 51 px макета; число клетки не зашито", () => {
    const chrome = squash(play.match(/--chrome0:\s*calc\(([\s\S]*?)\);\s*--chrome:/)![1]!);
    expect(chrome).toContain("var(--tabbar-h)");
    expect(chrome).toContain("var(--sa-top)");
    expect(chrome).toContain("var(--sa-bot)");
    expect(chrome).not.toMatch(/\b51px\b/);
    expect(chrome).not.toContain("var(--extra)"); // резерв под док отдельно, чтобы им можно было ограничить себя через --chrome0
    expect(body(play, ".play-fit")).toMatch(/--chrome: calc\(var\(--chrome0\) \+ var\(--extra\)\)/);
    expect(squash(play)).not.toMatch(/--s:\s*\d+px/);
  });

  it("D-1: резерв под док — постоянный (класс .play-hintable, не :has(> .hint-dock)), числа те же, что в fitModel.ts", () => {
    expect(play).not.toMatch(/:has\(\s*>\s*\.hint-dock/);
    const b = body(play, ".play-hintable");
    expect(b).toMatch(new RegExp(`--dock-h: ${FIT.dockH}px`));
    const extra = squash(b.match(/--extra: (.*);$/)![1]!);
    expect(extra).toContain(`var(--dock-h) + ${FIT.dockGap}px - ${FIT.padSlot}px - 1.15rem - ${FIT.gapPad}px`);
    expect(extra).toContain(`100dvh - var(--chrome0) - ${FIT.boardFloor}px`);
    // ровно та высота, что в --chrome0: клавиши 56 + ряд действий 66 = место панели
    expect(FIT.padSlot).toBe(56 + 66);
    expect(body(play, ".play-docked > .gap")).toMatch(/min-height: 8px/);
  });

  it("D-2: подпись партии — одна строка без переноса, сложность усекается многоточием, метки схлопываются в значки по container query", () => {
    const sub = body(play, ".play-fit .subline");
    expect(sub).toMatch(/flex-wrap: nowrap/);
    expect(sub).toMatch(/white-space: nowrap/);
    expect(sub).toMatch(/container-type: inline-size/);
    expect(body(play, ".play-fit .subline > .mode-chip")).toMatch(/align-self: center/); // чип не вытягивает строку выше резерва
    expect(body(play, ".play-fit .subline > .sub-diff")).toMatch(/text-overflow: ellipsis/);
    const qs = squash(play);
    expect(qs).toMatch(/@container \(max-width: 17em\) \{ \.subline \.chip-t \{ position: absolute;/);
    expect(qs).toMatch(/\.subline \.hm-ic \{ display: inline-block;/);
    expect(qs).toMatch(/\.subline \.chip-ic \{ display: block;/);
  });

  it("обвязка flex:none, гибкий только .gap; .gap держит строку статуса; .pad-wrap и .actions по ТЗ", () => {
    expect(body(play, ".play-fit > *")).toMatch(/flex: none/);
    expect(body(play, ".play-fit > .gap")).toMatch(/flex: 1 1 auto/);
    const gap = body(play, ".gap");
    expect(gap).toMatch(/min-height: calc\(1\.15rem \+ 16px\)/);
    expect(gap).toMatch(/padding: 8px max\(16px, var\(--sa-r\)\) 8px max\(16px, var\(--sa-l\)\)/);
    const pad = body(play, ".pad-wrap");
    expect(pad).toMatch(/flex: none/);
    expect(pad).toMatch(/container-type: inline-size/);
    expect(body(play, ".actions")).toMatch(/padding: 10px 0/);
  });

  it("бокс и клетка не режут содержимое (заметка 9 в углу)", () => {
    expect(body(play, ".box")).toMatch(/overflow: visible/);
    expect(body(play, ".cell")).toMatch(/overflow: visible/);
  });

  it("оболочка отдаёт хабу и партии область до таб-бара без прокрутки; --tabbar-h растёт с подписью вкладки", () => {
    const b = body(shell, ".scroll:has(.play-fit, .play-hub)");
    expect(b).toMatch(/overflow: hidden/);
    expect(b).toMatch(/padding-bottom: calc\(var\(--tabbar-h\) \+ var\(--sa-bot\)\)/);
    expect(squash(shell)).toMatch(/--tabbar-h: calc\(64px \+ \(clamp\(11px, 0\.65rem, 13px\) - 11px\) \* 1\.5\)/);
  });

  it("правило peek (прокручиваемые вкладки): нижний отступ = 16 px + таб-бар + нижний inset", () => {
    expect(body(shell, ".scroll")).toMatch(/padding-bottom: calc\(16px \+ var\(--tabbar-h\) \+ var\(--sa-bot\)\)/);
  });
});

describe("без новых цветов и токенов", () => {
  it("hub.css не вводит цвет-литералов (кроме тени меню) и не объявляет свои custom properties", () => {
    const noShadow = hub.replace(/box-shadow:[^;]*rgba\([^;]*;/g, "");
    expect(noShadow).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(noShadow).not.toMatch(/\brgba?\(/);
    expect(hub).not.toMatch(/^\s*--[\w-]+\s*:/m);
  });

  it("PD-167: пустой позиции под раздел режимов больше нет — раздел и есть «Режимы»; закреплённой «Начать» на хабе нет", () => {
    expect(hub).not.toMatch(/\.hub-slot-gap/);
    expect(hub).not.toMatch(/\.hub-bar/);
  });

  it("PD-167: строки режимов — без системной выноски/лупы iOS (долгое нажатие открывает наше меню); размытие меню снимается при Reduce Transparency", () => {
    const row = body(hub, ".hub-row.mode");
    expect(row).toMatch(/-webkit-touch-callout: none/);
    expect(row).toMatch(/user-select: none/);
    expect(squash(hub)).toMatch(/@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{ \.ctx-scrim \{ -webkit-backdrop-filter: none; backdrop-filter: none;/);
  });
});

describe("Year: заголовок на одной верхней линии с Today и Play", () => {
  it("тулбар без собственной минимальной высоты, titlebtn компенсирует цель 44 pt отрицательным полем", () => {
    expect(body(year, ".year .toolbar")).toMatch(/min-height: 0/);
    expect(body(year, ".titlebtn")).toMatch(/margin-block: min\(0px, calc\(\(1\.944rem - 44px\) \/ 2\)\)/);
  });
});
