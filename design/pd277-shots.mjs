/**
 * PD-277 — пустой Year: «Open today's puzzle» под стеклом таб-бара на iPhone; PD-256 — «New game» карточки результата Play.
 *
 * На iPhone 1rem = 17 px (`font: -apple-system-body` при обычном размере текста), а WebKit Playwright на macOS даёт 13 px —
 * прежние кадры занижали высоту всего rem-контента на ~30 %. Здесь html{font-size} задаётся явно: 17 px (iPhone по умолчанию)
 * и 40 px (AX3), `--sa-top`/`--sa-bot` — как у iPhone в портрете (Playwright env(safe-area-inset-*) не эмулирует).
 *
 *   BASE=http://127.0.0.1:5301 BROWSERS=chromium,webkit ONLY=Y,P LABEL=fix node design/pd277-shots.mjs
 *
 * Y — пустой Year: 320×568 / 393×852 / 430×932 (17 px) и 393×852 AX3, light/dark: кнопка целиком над таб-баром в покое,
 *     тап по её центру попадает в неё (не в таб-бар); до конца прокрутки — полотно над баром (правило peek PD-144). Кадры.
 * P — PD-256: карточка результата Play 393×852 (17 px): где «New game» в покое и в конце прокрутки (только замер + кадры).
 * Результат: design/pd277-shots/<LABEL>-<browser>.json + PNG.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const PW = createRequire(join(process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend", "noop.js"))("playwright");
const BASE = process.env.BASE ?? "http://127.0.0.1:5301";
const BROWSERS = (process.env.BROWSERS ?? "chromium,webkit").split(",");
const ONLY = (process.env.ONLY ?? "Y,P").split(",");
const LABEL = process.env.LABEL ?? "run";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd277-shots");
mkdirSync(OUT, { recursive: true });
const SIZES = [
  { name: "320", w: 320, h: 568, top: 20, bot: 0, fs: 17 },
  { name: "393", w: 393, h: 852, top: 59, bot: 34, fs: 17 },
  { name: "430", w: 430, h: 932, top: 59, bot: 34, fs: 17 },
  { name: "393-AX3", w: 393, h: 852, top: 59, bot: 34, fs: 40 },
];

let results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const note = (name, extra) => {
  results.push({ name, pass: null, extra });
  console.log(`NOTE  ${name}  ${extra}`);
};

async function ctxOf(browser, bname, s, scheme) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US", colorScheme: scheme, serviceWorkers: "block" });
  await ctx.addInitScript(([t, b, f]) => {
    const add = () => {
      const st = document.createElement("style");
      st.textContent = `html{font-size:${f}px !important}:root{--sa-top:${t}px !important;--sa-bot:${b}px !important}`;
      document.documentElement.appendChild(st);
    };
    if (document.documentElement) add();
    else document.addEventListener("DOMContentLoaded", add);
  }, [s.top, s.bot, s.fs]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  return { ctx, page, errs };
}

/** Положение элемента относительно таб-бара в покое и в конце прокрутки панели. */
const measure = (page, pane, css) =>
  page.evaluate(
    ({ pane, css }) => {
      const sc = document.querySelector(`.tab-pane[data-tab="${pane}"]`);
      const el = sc.querySelector(css);
      const bar = document.querySelector(".tabbar").getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const rest = { top: Math.round(r.top), bottom: Math.round(r.bottom), hitsSelf: el.contains(hit), hitTab: hit?.closest('[role="tab"]')?.id ?? null };
      const range = sc.scrollHeight - sc.clientHeight;
      sc.scrollTop = 1e6;
      const last = [...sc.querySelectorAll(".panel *")].reduce((m, n) => Math.max(m, n.getBoundingClientRect().bottom), 0);
      const r2 = el.getBoundingClientRect();
      const end = { bottom: Math.round(r2.bottom), lastContentBottom: Math.round(last) };
      sc.scrollTop = 0;
      return { barTop: Math.round(bar.top), rem: parseFloat(getComputedStyle(document.documentElement).fontSize), type: document.documentElement.dataset.type ?? null, range, rest, end };
    },
    { pane, css },
  );

const S = {
  async Y(browser, bname) {
    for (const s of SIZES) {
      for (const scheme of ["light", "dark"]) {
        const tag = `${bname}-${s.name}-${scheme}`;
        const { ctx, page, errs } = await ctxOf(browser, bname, s, scheme);
        try {
          await page.goto(`${BASE}/#/year`);
          await page.waitForSelector('[data-testid="year-empty"]', { timeout: 60000 });
          await page.waitForTimeout(600);
          const m = await measure(page, "year", '[data-testid="year-empty"] .cta');
          ok(`Y ${tag}: «Open today's puzzle» целиком над таб-баром в покое, тап по центру — в кнопку`, m.rest.bottom <= m.barTop && m.rest.hitsSelf, JSON.stringify(m));
          ok(`Y ${tag}: в конце прокрутки всё содержимое над таб-баром (peek PD-144)`, m.end.lastContentBottom <= m.barTop, JSON.stringify(m.end));
          if (s.fs === 40) ok(`Y ${tag}: AX3 распознан (data-type=ax3)`, m.type === "ax3", String(m.type));
          await page.screenshot({ path: join(OUT, `${LABEL}-Y-${tag}.png`) });
          ok(`Y ${tag}: без ошибок страницы`, errs.length === 0, errs.join("|"));
        } finally {
          await ctx.close();
        }
      }
    }
  },
  async P(browser, bname) {
    const s = SIZES[1];
    const { ctx, page, errs } = await ctxOf(browser, bname, s, "light");
    const solve = (m) => {
      const g = [...m].map(Number);
      const okd = (i, d) => {
        const r = Math.floor(i / 9), c = i % 9;
        for (let k = 0; k < 9; k++) if (g[r * 9 + k] === d || g[k * 9 + c] === d) return false;
        const br = r - (r % 3), bc = c - (c % 3);
        for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === d) return false;
        return true;
      };
      const go = () => {
        const i = g.indexOf(0);
        if (i < 0) return true;
        for (let d = 1; d <= 9; d++)
          if (okd(i, d)) {
            g[i] = d;
            if (go()) return true;
            g[i] = 0;
          }
        return false;
      };
      go();
      return g;
    };
    try {
      await page.goto(`${BASE}/#/play`);
      await page.locator('.tab-pane[data-tab="play"] [data-testid="mode-classic"]').waitFor({ timeout: 60000 });
      await page.locator('.tab-pane[data-tab="play"] [data-testid="mode-classic"]').tap();
      await page.locator('[data-testid="sheet-start"]').waitFor();
      await page.waitForTimeout(400);
      if (await page.locator('[data-testid="difficulty-easy"]').count()) await page.locator('[data-testid="difficulty-easy"]').tap();
      await page.locator('[data-testid="sheet-start"]').tap();
      await page.locator('.tab-pane[data-tab="play"] .board .cell .d.given').first().waitFor({ timeout: 60000 });
      await page.waitForTimeout(400);
      const g = await page.evaluate(() => {
        const out = new Array(81).fill("0");
        for (const c of document.querySelectorAll('.tab-pane[data-tab="play"] .board .cell')) out[Number(c.getAttribute("data-i"))] = c.querySelector(".d")?.textContent?.trim() || "0";
        return out.join("");
      });
      const sol = solve(g);
      const keys = page.locator('.tab-pane[data-tab="play"] .pad .key');
      for (let i = 0; i < 81; i++) {
        if (g[i] !== "0") continue;
        await page.locator(`.tab-pane[data-tab="play"] .board .cell[data-i="${i}"]`).tap();
        await keys.nth(sol[i] - 1).tap();
      }
      await page.locator('.tab-pane[data-tab="play"] [data-testid="new-puzzle"]').waitFor({ timeout: 20000 });
      await page.waitForTimeout(900);
      const m = await measure(page, "play", '[data-testid="new-puzzle"]');
      note(`P ${bname}-393 PD-256: «New game» в покое ${m.rest.bottom <= m.barTop ? "над" : "под"} таб-баром (низ ${m.rest.bottom}, бар ${m.barTop}), прокрутка ${m.range} px; в конце прокрутки низ ${m.end.bottom}`, JSON.stringify(m));
      ok(`P ${bname}-393: в конце прокрутки «New game» и всё содержимое над таб-баром`, m.end.bottom <= m.barTop && m.end.lastContentBottom <= m.barTop, JSON.stringify(m.end));
      await page.screenshot({ path: join(OUT, `${LABEL}-P-${bname}-393-rest.png`) });
      await page.evaluate(() => (document.querySelector('.tab-pane[data-tab="play"]').scrollTop = 1e6));
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(OUT, `${LABEL}-P-${bname}-393-end.png`) });
      ok(`P ${bname}: без ошибок страницы`, errs.length === 0, errs.join("|"));
    } finally {
      await ctx.close();
    }
  },
};

const summary = {};
for (const bname of BROWSERS) {
  results = [];
  const browser = await PW[bname].launch();
  const meta = { base: BASE, label: LABEL, engine: `${bname} ${browser.version()}`, at: new Date().toISOString(), loadStart: os.loadavg() };
  try {
    for (const k of ONLY) {
      try {
        await S[k](browser, bname);
      } catch (e) {
        ok(`${k} ${bname} упал`, false, String(e.message).split("\n")[0]);
      }
    }
  } finally {
    await browser.close();
  }
  meta.loadEnd = os.loadavg();
  writeFileSync(join(OUT, `${LABEL}-${bname}.json`), JSON.stringify({ meta, results }, null, 2) + "\n");
  const real = results.filter((r) => r.pass !== null);
  summary[bname] = `${real.filter((r) => r.pass).length}/${real.length} PASS, заметок ${results.length - real.length}`;
}
console.log("\n" + Object.entries(summary).map(([b, s]) => `${b}: ${s}`).join("\n"));
