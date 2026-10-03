// PD-144 — screenshots of design/pd144-play-c.html (Play as the hub of IA variant C).
//
// Playwright must be installed OUTSIDE the repo (macOS 13 -> Playwright 1.49). /tmp/pd16-pw has one:
//
//   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
//     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd144-shots.mjs
//
// Writes <state>-<w>x<h>-<theme>-<lang>[-ax3].png into design/pd144-shots/, WebKit, @3x.
// Set PD144_CHROMIUM=1 to render the same list in Chromium too (prefix "cr-").
//
// NOTE for whoever runs this: the mockup is a LIVE page (100dvh, device-width), not a page of
// fixed 390x844 cards — the viewport is the phone. That is why 320x568 renders the real
// short-screen layout instead of a scaled-down picture of the tall one.

import { createRequire } from 'node:module';
const { webkit, chromium } = createRequire(process.cwd() + '/')('playwright');
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, 'pd144-play-c.html')).href;
const outDir = resolve(here, 'pd144-shots');
mkdirSync(outDir, { recursive: true });

const BIG = { width: 390, height: 844 };   // iPhone 16 class (production 393x852)
const SE  = { width: 320, height: 568 };   // iPhone SE 1 — the narrowest/shortest we check

/** Every shot: the viewport plus the state to put the mockup in. */
const shots = [
  // ---- the hub, 390 -------------------------------------------------
  { name: 'hub',              vp: BIG, appearance: 'light' },
  { name: 'hub',              vp: BIG, appearance: 'dark' },
  { name: 'hub',              vp: BIG, appearance: 'light', lang: 'uk' },
  { name: 'hub',              vp: BIG, appearance: 'light', lang: 'ru' },
  { name: 'hub-empty',        vp: BIG, appearance: 'light', cont: 'none' },
  { name: 'hub-empty',        vp: BIG, appearance: 'dark',  cont: 'none', lang: 'uk' },
  { name: 'hub-day-only',     vp: BIG, appearance: 'light', cont: 'day' },
  { name: 'hub-ink',          vp: BIG, appearance: 'light', mode: 'ink' },
  { name: 'mode-sheet',       vp: BIG, appearance: 'light', sheet: 'mode' },
  { name: 'mode-sheet',       vp: BIG, appearance: 'dark',  sheet: 'mode', lang: 'ru' },
  { name: 'hub-slot',         vp: BIG, appearance: 'light', slot: 'on', cont: 'none' },
  { name: 'hub',              vp: BIG, appearance: 'light', type: 'ax3' },
  { name: 'hub',              vp: BIG, appearance: 'light', type: 'ax3', lang: 'ru' },

  // ---- a game in progress, 390 --------------------------------------
  { name: 'game',             vp: BIG, appearance: 'light', notes: 'off' },
  { name: 'game-ink',         vp: BIG, appearance: 'dark',  mode: 'ink', notes: 'off' },
  { name: 'fill-a',           vp: BIG, appearance: 'light', screen: 'game', fill: 'a', notes: 'on' },
  { name: 'fill-a',           vp: BIG, appearance: 'light', screen: 'game', fill: 'a', notes: 'on', lang: 'uk' },
  { name: 'fill-a',           vp: BIG, appearance: 'dark',  screen: 'game', fill: 'a', notes: 'on', lang: 'ru' },
  { name: 'fill-b',           vp: BIG, appearance: 'light', screen: 'game', fill: 'b', menu: 'open' },
  { name: 'fill-b',           vp: BIG, appearance: 'light', screen: 'game', fill: 'b', menu: 'open', lang: 'uk' },
  { name: 'fill-c',           vp: BIG, appearance: 'light', screen: 'game', fill: 'c', notes: 'on' },

  // ---- solved + sheets, 390 -----------------------------------------
  { name: 'solved',           vp: BIG, appearance: 'light' },
  { name: 'solved',           vp: BIG, appearance: 'dark', lang: 'uk' },
  { name: 'discard',          vp: BIG, appearance: 'light', screen: 'hub', sheet: 'discard' },
  { name: 'headers',          vp: BIG, appearance: 'light' },
  { name: 'headers',          vp: BIG, appearance: 'light', type: 'ax3' },

  // ---- 320x568 ------------------------------------------------------
  { name: 'hub',              vp: SE, appearance: 'light' },
  { name: 'hub',              vp: SE, appearance: 'light', lang: 'uk' },
  { name: 'hub',              vp: SE, appearance: 'dark',  lang: 'ru' },
  { name: 'hub',              vp: SE, appearance: 'light', lang: 'uk', type: 'ax3' },
  { name: 'game',             vp: SE, appearance: 'light', lang: 'uk', notes: 'off' },
  { name: 'game',             vp: SE, appearance: 'light', lang: 'ru', type: 'ax3', notes: 'off' },
  { name: 'fill-a',           vp: SE, appearance: 'light', screen: 'game', fill: 'a', notes: 'on', lang: 'uk' },
  { name: 'fill-c',           vp: SE, appearance: 'light', screen: 'game', fill: 'c', notes: 'on', lang: 'uk' },
  { name: 'solved',           vp: SE, appearance: 'light', lang: 'ru' },
  { name: 'discard',          vp: SE, appearance: 'light', screen: 'hub', sheet: 'discard', lang: 'uk' },
  { name: 'discard',          vp: SE, appearance: 'light', screen: 'hub', sheet: 'discard', lang: 'uk', type: 'ax3' },
  { name: 'discard',          vp: SE, appearance: 'light', screen: 'hub', sheet: 'discard', lang: 'ru', type: 'ax3' },
  { name: 'mode-sheet',       vp: SE, appearance: 'light', sheet: 'mode', lang: 'uk', type: 'ax3' },
  { name: 'headers',          vp: SE, appearance: 'light', lang: 'ru' },
];

/** The screen each named shot implies, unless the shot says otherwise. */
const SCREEN_OF = {
  hub: 'hub', 'hub-empty': 'hub', 'hub-day-only': 'hub', 'hub-ink': 'hub', 'hub-slot': 'hub',
  'mode-sheet': 'hub', discard: 'hub',
  game: 'game', 'game-ink': 'game', 'fill-a': 'game', 'fill-b': 'game', 'fill-c': 'game',
  solved: 'solved', headers: 'headers',
};

function fileName(s) {
  const theme = s.appearance;
  const lang = s.lang || 'en';
  const size = `${s.vp.width}x${s.vp.height}`;
  const ax = s.type === 'ax3' ? '-ax3' : s.type === 'xxxl' ? '-xxxl' : '';
  return `${s.name}-${size}-${theme}-${lang}${ax}`;
}

async function run(engine, prefix) {
  const browser = await engine.launch();
  for (const s of shots) {
    const ctx = await browser.newContext({ viewport: s.vp, deviceScaleFactor: 3 });
    const page = await ctx.newPage();
    await page.goto(pageUrl);
    await page.evaluate((cfg) => {
      const P = window.PD144;
      P.reset();
      P.set('safearea', 'sim');
      P.set('appearance', cfg.appearance);
      P.set('lang', cfg.lang || 'en');
      P.set('type', cfg.type || 'default');
      P.set('screen', cfg.screen || cfg.screenOf);
      P.set('cont', cfg.cont || 'both');
      P.set('mode', cfg.mode || 'classic');
      P.set('fill', cfg.fill || 'a');
      P.set('notes', cfg.notes || 'off');
      P.set('menu', cfg.menu || 'closed');
      P.set('slot', cfg.slot || 'off');
      P.set('sheet', cfg.sheet || 'none');
      P.guide();
    }, { ...s, screenOf: SCREEN_OF[s.name] || 'hub' });
    await page.waitForTimeout(150);
    const name = `${prefix}${fileName(s)}`;
    await page.screenshot({ path: `${outDir}/${name}.png` });
    console.log('wrote', name);
    await ctx.close();
  }
  await browser.close();
}

await run(webkit, '');
if (process.env.PD144_CHROMIUM) await run(chromium, 'cr-');
