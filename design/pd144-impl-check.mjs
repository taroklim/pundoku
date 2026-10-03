// PD-144 — live check of the real app (Play by IA variant C) + implementation shots.
//
//   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers BASE=http://localhost:3991 \
//     node <repo>/design/pd144-impl-check.mjs [filter]
//
// Playwright lives OUTSIDE the repo (macOS 13). Needs `pnpm --filter web dev` on BASE.
// Writes design/pd144-impl-shots/<state>-<w>x<h>-<theme>-<lang>[-ax3].png and prints one JSON line of
// measurements per case. The acceptance numbers (ТЗ §7): board 358 / 264 / 165 px, no scroll of the
// screen container (scrollHeight === clientHeight) at 17 px and AX3, with and without the PD-133 hint
// dock, the action row above the tab bar, the three tab titles at one top edge.
import { createRequire } from 'node:module';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:3991';
const out = resolve(dirname(fileURLToPath(import.meta.url)), 'pd144-impl-shots');
mkdirSync(out, { recursive: true });
const filter = process.argv[2] ?? '';

const BIG = { width: 390, height: 844 };
const SE = { width: 320, height: 568 };
const MID = { width: 375, height: 667 };
const IPH = { width: 393, height: 852 };

const cases = [
  { name: 'hub', vp: BIG }, { name: 'hub', vp: BIG, scheme: 'dark' }, { name: 'hub', vp: BIG, lang: 'uk' }, { name: 'hub', vp: BIG, lang: 'ru' },
  { name: 'hub', vp: SE }, { name: 'hub', vp: SE, lang: 'uk', ax3: 1 }, { name: 'hub', vp: BIG, ax3: 1 },
  { name: 'mode-sheet', vp: BIG }, { name: 'mode-sheet', vp: SE, lang: 'uk', ax3: 1 }, { name: 'mode-sheet', vp: BIG, scheme: 'dark', lang: 'ru' },
  { name: 'game', vp: BIG }, { name: 'game', vp: SE }, { name: 'game', vp: SE, lang: 'ru', ax3: 1 }, { name: 'game', vp: MID },
  { name: 'game', vp: SE, dock: 1 }, { name: 'game', vp: SE, ax3: 1, dock: 1 }, { name: 'game', vp: BIG, dock: 1 },
  { name: 'game-ink', vp: BIG, scheme: 'dark', ink: 1 },
  { name: 'menu', vp: BIG }, { name: 'menu', vp: BIG, lang: 'uk' }, { name: 'menu-ink', vp: BIG, ink: 1 }, { name: 'menu', vp: SE, ax3: 1, lang: 'ru' },
  { name: 'discard', vp: SE, lang: 'uk', ax3: 1 }, { name: 'discard', vp: SE, lang: 'ru', ax3: 1 }, { name: 'discard', vp: BIG },
];

const run = async (engineName, c) => {
  const b = await (engineName === 'webkit' ? webkit : chromium).launch();
  const lang = c.lang ?? 'en';
  const ctx = await b.newContext({
    viewport: c.vp, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    locale: { uk: 'uk-UA', ru: 'ru-RU', en: 'en-US' }[lang], colorScheme: c.scheme ?? 'light', reducedMotion: c.rm ? 'reduce' : 'no-preference',
  });
  await ctx.addInitScript((px) => {
    const add = () => { const s = document.createElement('style'); s.textContent = `html{font-size:${px}px !important}`; document.documentElement.appendChild(s); };
    if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
  }, c.ax3 ? 40 : 17);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(BASE + '/#/play');
  await page.waitForTimeout(1200);
  const tap = (id) => page.locator(`[data-testid="${id}"]`).tap();
  if (c.ink) { await tap('mode-row'); await tap('mode-ink'); await tap('ink-rule-start'); await page.waitForTimeout(300); await tap('mode-done'); }
  if (c.name === 'mode-sheet') { await tap('mode-row'); await page.waitForTimeout(400); }
  if (/^(game|menu|discard)/.test(c.name)) {
    await tap('setup-start');
    await page.waitForSelector('.board:not(.idle)', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(600);
  }
  if (c.dock) { await tap('hint-button'); await page.waitForTimeout(400); if (await page.locator('[data-testid="hint-rule-go"]').count()) { await tap('hint-rule-go'); } await page.waitForTimeout(600); }
  if (c.name.startsWith('menu')) { await tap('more-button'); await page.waitForTimeout(400); }
  if (c.name === 'discard') { await tap('more-button'); await tap('menu-new'); await page.waitForTimeout(500); await tap('setup-start'); await page.waitForTimeout(500); }
  const m = await page.evaluate(() => {
    const r = (s) => document.querySelector(s)?.getBoundingClientRect();
    const sc = document.querySelector('.scroll');
    const board = r('.board'), acts = r('.actions'), bar = r('.tabbar'), title = r('.title');
    const hp = [...document.querySelectorAll('.menu button, .hub-row, .mode-opt, .st-asheet button, .more-btn, .gear-btn, .act')].map((e) => Math.round(e.getBoundingClientRect().height));
    return {
      sh: sc?.scrollHeight, ch: sc?.clientHeight, play: (() => { const p = document.querySelector('.play-fit'); return p ? [p.scrollHeight, p.clientHeight] : null; })(),
      board: board && Math.round(board.width), boardBottom: board && Math.round(board.bottom),
      actsBottom: acts && Math.round(acts.bottom), barTop: bar && Math.round(bar.top), titleTop: title && Math.round(title.top),
      minTarget: hp.length ? Math.min(...hp) : null, ax3: document.documentElement.dataset.type ?? null,
    };
  });
  const file = `${c.name}-${c.vp.width}x${c.vp.height}-${c.scheme ?? 'light'}-${lang}${c.ax3 ? '-ax3' : ''}${c.dock ? '-dock' : ''}${engineName === 'webkit' ? '-wk' : ''}.png`;
  await page.screenshot({ path: resolve(out, file) });
  console.log(JSON.stringify({ file, ...m, errs }));
  await b.close();
};

for (const c of cases) {
  const tag = `${c.name}-${c.vp.width}x${c.vp.height}-${c.lang ?? 'en'}${c.ax3 ? '-ax3' : ''}${c.dock ? '-dock' : ''}`;
  if (filter && !tag.includes(filter)) continue;
  await run('chromium', c);
}
// The device itself: WebKit at the real iPhone 16 viewport.
if (!filter || filter === 'webkit') for (const c of [{ name: 'hub', vp: IPH }, { name: 'game', vp: IPH }, { name: 'menu', vp: IPH }]) await run('webkit', c);
