// PD-24 — screenshots of design/pd24-year-variants.html
//
// Run from anywhere; paths are resolved from this file. Playwright must be installed OUTSIDE the
// repo (macOS 13 → Playwright 1.49). /tmp/pd16-pw already has an install:
//
//   cd /tmp/pd16-pw && node /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku-worktrees/pd-24/design/pd24-shots.mjs
//
// Writes PNGs into design/pd24-shots/.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const page_url = pathToFileURL(resolve(here, 'pd24-year-variants.html')).href;
const outDir = resolve(here, 'pd24-shots');
mkdirSync(outDir, { recursive: true });

// 390 x 844 at 3x — the size the ticket asks for.
const VIEWPORT = { width: 390, height: 844 };

const shots = [
  // layout x appearance — the main comparison
  { name: 'A-light', appearance: 'light', lay: 'A' },
  { name: 'A-dark',  appearance: 'dark',  lay: 'A' },
  { name: 'B-light', appearance: 'light', lay: 'B' },
  { name: 'B-dark',  appearance: 'dark',  lay: 'B' },
  { name: 'C-light', appearance: 'light', lay: 'C' },
  { name: 'C-dark',  appearance: 'dark',  lay: 'C' },

  // encoding options on the recommended layout
  { name: 'C-light-help',  appearance: 'light', lay: 'C', help: 'on' },
  { name: 'C-light-quiet', appearance: 'light', lay: 'C', corr: 'quiet' },

  // new user
  { name: 'C-empty-light', appearance: 'light', lay: 'C', state: 'empty' },
  { name: 'C-empty-dark',  appearance: 'dark',  lay: 'C', state: 'empty' },

  // tap a month → the month sheet
  { name: 'C-month-light', appearance: 'light', lay: 'C', sheet: { month: 7 } },
  { name: 'C-month-dark',  appearance: 'dark',  lay: 'C', sheet: { month: 7 } },

  // tap a day → the day card (12 Aug solved; 6 Aug missed shows the other card state)
  { name: 'C-day-light',        appearance: 'light', lay: 'C', sheet: { month: 7, day: 12 } },
  { name: 'C-day-dark',         appearance: 'dark',  lay: 'C', sheet: { month: 7, day: 12 } },
  { name: 'C-day-missed-light', appearance: 'light', lay: 'C', sheet: { month: 6, day: 15 } },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3 });
const page = await ctx.newPage();

for (const s of shots) {
  await page.goto(page_url);
  await page.evaluate((cfg) => {
    const P = window.PD24;
    P.set('appearance', cfg.appearance);
    P.set('lay', cfg.lay);
    P.set('corr', cfg.corr || 'wax');
    P.set('help', cfg.help || 'off');
    P.set('state', cfg.state || 'year');
    P.set('motion', 'off');           // no transitions mid-screenshot
    P.set('safearea', 'sim');
    if (cfg.sheet) {
      if (cfg.sheet.day) P.openDayOfMonth(cfg.sheet.month, cfg.sheet.day);
      else P.openMonth(cfg.sheet.month);
    } else {
      P.closeSheet();
    }
  }, s);
  await page.waitForTimeout(220);
  await page.screenshot({ path: `${outDir}/${s.name}.png` });
  console.log('wrote', s.name);
}

// Sanity read-out: how many days of each kind the deterministic year contains.
console.log(await page.evaluate(() => window.PD24.counts()));

await browser.close();
