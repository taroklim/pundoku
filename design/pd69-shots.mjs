// PD-69 — screenshots of design/pd69-ink-timelapse.html (Ink mode + Timelapse).
//
// Playwright must be installed OUTSIDE the repo (macOS 13 -> Playwright 1.49). /tmp/pd16-pw has one:
//
//   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
//     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd69-shots.mjs
//
// Writes cr-*.png (chromium) and wk-*.png (webkit) into design/pd69-shots/.
// Default viewport 390x844 @3x; some shots override width (320 / 430).
// forced-colors shots are chromium-only (webkit has no emulation) and are skipped there.

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, 'pd69-ink-timelapse.html')).href;
const outDir = resolve(here, 'pd69-shots');
mkdirSync(outDir, { recursive: true });

const W = 390, H = 844;

// Every shot resets the mockup first, then applies only what it names.
const shots = [
  // ---------- A. Ink mode: entry ----------
  { name: 'a1-entry-light',        screen: 'today-entry' },
  { name: 'a1-entry-dark',         screen: 'today-entry', appearance: 'dark' },
  { name: 'a2-rule-light',         screen: 'rule' },
  { name: 'a2-rule-dark',          screen: 'rule', appearance: 'dark' },
  { name: 'a2-rule-late',          screen: 'rule', blot: 'late' },
  { name: 'a2-rule-ghost',         screen: 'rule', blot: 'ghost' },
  { name: 'a3-play-setup-light',   screen: 'play-setup' },
  { name: 'a3-play-setup-dark',    screen: 'play-setup', appearance: 'dark' },

  // ---------- A. Ink mode: the game screen (no undo, no digit eraser) ----------
  { name: 'a4-game-light',         screen: 'ink-game' },
  { name: 'a4-game-dark',          screen: 'ink-game', appearance: 'dark' },
  { name: 'a4-game-nomark',        screen: 'ink-game', mark: 'none' },
  { name: 'a4-game-plain-compare', screen: 'tl-card' }, // the ordinary card, for comparison

  // ---------- A. The blot ----------
  { name: 'a5-blot-now-light',     screen: 'ink-blot' },
  { name: 'a5-blot-now-dark',      screen: 'ink-blot', appearance: 'dark' },
  { name: 'a5-blot-ghost-light',   screen: 'ink-blot', blot: 'ghost' },
  { name: 'a5-blot-late-light',    screen: 'ink-blot', blot: 'late' },
  { name: 'a5-blot-mid-anim',      screen: 'ink-blot', blotAnim: 170 },   // M7 caught mid-spread
  { name: 'a5-blot-reduced',       screen: 'ink-blot', motion: 'reduced', blotAnim: 120 },
  { name: 'a5-blot-forced',        screen: 'ink-blot', forced: true },

  // ---------- A. The ink day card ----------
  { name: 'a6-card-light',         screen: 'ink-card' },
  { name: 'a6-card-dark',          screen: 'ink-card', appearance: 'dark' },
  { name: 'a6-card-forced',        screen: 'ink-card', forced: true },

  // ---------- A. Year ----------
  { name: 'a7-year-nosign-light',  screen: 'year' },
  { name: 'a7-year-nosign-dark',   screen: 'year', appearance: 'dark' },
  { name: 'a7-year-corner-light',  screen: 'year', yearsign: 'corner' },
  { name: 'a7-year-corner-dark',   screen: 'year', yearsign: 'corner', appearance: 'dark' },

  // ---------- B. Timelapse: entry, player, modes ----------
  { name: 'b1-entry-light',        screen: 'tl-card' },
  { name: 'b1-entry-dark',         screen: 'tl-card', appearance: 'dark' },
  { name: 'b2-player-light',       screen: 'tl-player' },
  { name: 'b2-player-dark',        screen: 'tl-player', appearance: 'dark' },
  { name: 'b2-player-early',       screen: 'tl-player', scrub: 9 },
  { name: 'b2-player-ink',         screen: 'year' },      // the ink day's sheet, replay entry
  { name: 'b3-player-step',        screen: 'tl-player', tl: 'step', motion: 'reduced' },
  { name: 'b3-player-contact',     screen: 'tl-player', tl: 'contact' },
  { name: 'b3-player-contact-dark',screen: 'tl-player', tl: 'contact', appearance: 'dark' },
  { name: 'b2-player-forced',      screen: 'tl-player', forced: true },

  // ---------- B. Fingerprint ----------
  { name: 'b4-fp-rhythm-light',    screen: 'tl-export', fp: 'rhythm' },
  { name: 'b4-fp-rhythm-dark',     screen: 'tl-export', fp: 'rhythm', appearance: 'dark' },
  { name: 'b4-fp-path-light',      screen: 'tl-export', fp: 'path' },
  { name: 'b4-fp-trace-light',     screen: 'tl-export', fp: 'trace' },
  { name: 'b4-fp-trace-dark',      screen: 'tl-export', fp: 'trace', appearance: 'dark' },
  { name: 'b5-share-light',        screen: 'tl-share' },
  { name: 'b6-nolog-light',        screen: 'tl-none' },
  { name: 'b6-nolog-dark',         screen: 'tl-none', appearance: 'dark' },

  // ---------- languages: the longest strings ----------
  { name: 'l-uk-rule',             screen: 'rule', lang: 'uk' },
  { name: 'l-ru-rule',             screen: 'rule', lang: 'ru' },
  { name: 'l-ru-rule-late',        screen: 'rule', lang: 'ru', blot: 'late' },
  { name: 'l-uk-entry',            screen: 'today-entry', lang: 'uk' },
  { name: 'l-ru-game',             screen: 'ink-game', lang: 'ru' },
  { name: 'l-uk-game',             screen: 'ink-game', lang: 'uk' },
  { name: 'l-ru-card',             screen: 'ink-card', lang: 'ru' },
  { name: 'l-uk-player',           screen: 'tl-player', lang: 'uk' },
  { name: 'l-ru-player',           screen: 'tl-player', lang: 'ru' },
  { name: 'l-ru-export',           screen: 'tl-export', lang: 'ru' },
  { name: 'l-uk-nolog',            screen: 'tl-none', lang: 'uk' },
  { name: 'l-ru-play-setup',       screen: 'play-setup', lang: 'ru' },

  // ---------- Dynamic Type ----------
  { name: 't-xxxl-rule',           screen: 'rule', type: 'xxxl' },
  { name: 't-ax3-rule',            screen: 'rule', type: 'ax3' },
  { name: 't-ax3-rule-ru',         screen: 'rule', type: 'ax3', lang: 'ru' },
  { name: 't-xxxl-game',           screen: 'ink-game', type: 'xxxl' },
  { name: 't-ax3-game',            screen: 'ink-game', type: 'ax3' },
  { name: 't-ax3-card',            screen: 'ink-card', type: 'ax3' },
  { name: 't-ax3-player',          screen: 'tl-player', type: 'ax3' },
  { name: 't-ax3-export',          screen: 'tl-export', type: 'ax3' },
  { name: 't-xxxl-nolog',          screen: 'tl-none', type: 'xxxl' },

  // ---------- widths 320 / 430 ----------
  { name: 'w320-game',             screen: 'ink-game', width: 320, height: 568 },
  { name: 'w320-rule-ru',          screen: 'rule', lang: 'ru', width: 320, height: 568 },
  { name: 'w320-player',           screen: 'tl-player', width: 320, height: 568 },
  { name: 'w430-game',             screen: 'ink-game', width: 430, height: 932 },
  { name: 'w430-card',             screen: 'ink-card', width: 430, height: 932 },
  { name: 'w430-export',           screen: 'tl-export', width: 430, height: 932 },
];

async function one(page, s) {
  await page.goto(pageUrl);
  await page.evaluate((cfg) => {
    const P = window.PD69;
    P.reset();
    for (const k of ['appearance', 'lang', 'type', 'blot', 'mark', 'yearsign', 'tl', 'fp', 'motion']) {
      if (cfg[k]) P.set(k, cfg[k]);
    }
    P.set('screen', cfg.screen || 'today-entry');
    if (typeof cfg.scrub === 'number') P.scrubTo(cfg.scrub);
    P.hideMock();
  }, s);
  await page.waitForTimeout(240);            // sheets/rings settle
  if (s.blotAnim) {
    await page.evaluate(() => window.PD69.blot());
    await page.waitForTimeout(s.blotAnim);   // catch M7 mid-flight
  }
  await page.screenshot({ path: `${outDir}/${s.prefix}-${s.name}.png` });
  console.log('wrote', `${s.prefix}-${s.name}`);
}

async function run(engine, prefix, supportsForced) {
  const browser = await engine.launch();
  for (const s of shots) {
    if (s.forced && !supportsForced) { console.log('skip (no forced-colors)', prefix, s.name); continue; }
    const ctx = await browser.newContext({
      viewport: { width: s.width || W, height: s.height || H },
      deviceScaleFactor: 3,
      ...(s.forced ? { forcedColors: 'active' } : {}),
    });
    const page = await ctx.newPage();
    try {
      await one(page, { ...s, prefix });
    } catch (e) {
      console.error('FAILED', prefix, s.name, e.message);
    }
    await ctx.close();
  }
  await browser.close();
}

await run(chromium, 'cr', true);
await run(webkit, 'wk', false);
