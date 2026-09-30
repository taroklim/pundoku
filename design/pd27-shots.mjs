// PD-48 — screenshots of design/pd27-settings.html (Settings + recovery key).
//
// Playwright must be installed OUTSIDE the repo (macOS 13 -> Playwright 1.49). /tmp/pd16-pw has one:
//
//   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
//     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd27-shots.mjs
//
// Writes cr-*.png (chromium) and wk-*.png (webkit) into design/pd27-shots/, 390x844 @3x.

import { chromium, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pageUrl = pathToFileURL(resolve(here, 'pd27-settings.html')).href;
const outDir = resolve(here, 'pd27-shots');
mkdirSync(outDir, { recursive: true });

const VIEWPORT = { width: 390, height: 844 };

// Each shot: what to set, in order. `fixed` pins the key so every run looks identical.
const shots = [
  // where Settings is entered from
  { name: 'today-gear-light', appearance: 'light', screen: 'today' },
  { name: 'today-gear-dark',  appearance: 'dark',  screen: 'today' },

  // 1 no key
  { name: 's1-none-light', appearance: 'light', key: 'none' },
  { name: 's1-none-dark',  appearance: 'dark',  key: 'none' },

  // 2 key shown once (both formats)
  { name: 's2-shown-light',       appearance: 'light', key: 'shown', fixed: true },
  { name: 's2-shown-dark',        appearance: 'dark',  key: 'shown', fixed: true },
  { name: 's2-shown-words-light', appearance: 'light', key: 'shown', keyfmt: 'words', fixed: true },

  // 3 key exists
  { name: 's3-created-light', appearance: 'light', key: 'created', fixed: true },
  { name: 's3-created-dark',  appearance: 'dark',  key: 'created', fixed: true },

  // 4 / 5 entry + checking
  { name: 's4-enter-light',     appearance: 'light', key: 'enter', entry: 'K7QP3M2X9RTVB4HN6ZC8JW5F2DGTX8MA' },
  { name: 's4-enter-empty-kb',  appearance: 'light', key: 'enter', kb: 'up' },
  { name: 's5-checking-light',  appearance: 'light', key: 'enter', entry: 'K7QP3M2X9RTVB4HN6ZC8JW5F2DGTX8MA', busy: 'on' },

  // 6 restored · 7 wrong key · 8 limit · 9 offline
  { name: 's6-restored-light', appearance: 'light', key: 'restored', fixed: true },
  { name: 's7-wrongkey-light', appearance: 'light', key: 'error', entry: '0000000000000000000000000000000Z' },
  { name: 's7-wrongkey-dark',  appearance: 'dark',  key: 'error', entry: '0000000000000000000000000000000Z' },
  { name: 's8-limit-light',    appearance: 'light', key: 'limit', entry: 'K7QP3M2X9RTVB4HN6ZC8JW5F2DGTX8MA' },
  { name: 's9-offline-light',  appearance: 'light', key: 'offline', entry: 'K7QP3M2X9RTVB4HN6ZC8JW5F2DGTX8MA' },

  // confirmations
  { name: 'sheet-reissue-light', appearance: 'light', key: 'created', fixed: true, sheet: 'reissue' },
  { name: 'sheet-delete-light',  appearance: 'light', key: 'created', fixed: true, sheet: 'delete' },
  { name: 'sheet-delete-dark',   appearance: 'dark',  key: 'created', fixed: true, sheet: 'delete' },
  { name: 'sheet-unlink-light',  appearance: 'light', key: 'created', fixed: true, sheet: 'unlink' },

  // languages, longest strings
  { name: 'lang-uk-created', appearance: 'light', key: 'created', lang: 'uk', fixed: true },
  { name: 'lang-ru-created', appearance: 'light', key: 'created', lang: 'ru', fixed: true },
  { name: 'lang-ru-shown',   appearance: 'light', key: 'shown',   lang: 'ru', fixed: true },
  { name: 'lang-uk-none',    appearance: 'light', key: 'none',    lang: 'uk' },

  // Dynamic Type
  { name: 'type-xxxl-shown',    appearance: 'light', key: 'shown',   type: 'xxxl', fixed: true },
  { name: 'type-ax3-shown',     appearance: 'light', key: 'shown',   type: 'ax3',  fixed: true },
  { name: 'type-ax3-created-ru',appearance: 'light', key: 'created', type: 'ax3',  lang: 'ru', fixed: true },
  { name: 'type-ax3-enter',     appearance: 'light', key: 'enter',   type: 'ax3',  entry: 'K7QP3M2X9RTVB4HN6ZC8JW5F2DGTX8MA' },

  // the alternative presentation
  { name: 'present-sheet-light', appearance: 'light', key: 'created', present: 'sheet', fixed: true },
];

async function run(engine, prefix) {
  const browser = await engine.launch();
  const ctx = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  for (const s of shots) {
    await page.goto(pageUrl);
    await page.evaluate((cfg) => {
      const P = window.PD27;
      P.reset();
      P.set('motion', 'off');                 // no transitions mid-screenshot
      P.set('safearea', 'sim');
      P.set('appearance', cfg.appearance);
      P.set('lang', cfg.lang || 'en');
      P.set('type', cfg.type || 'default');
      P.set('present', cfg.present || 'push');
      P.set('keyfmt', cfg.keyfmt || 'base32');
      P.set('screen', cfg.screen || 'settings');
      P.set('key', cfg.key || 'none');
      P.set('kb', cfg.kb || 'down');
      if (cfg.fixed) P.useFixedKey();
      if (cfg.entry) P.fillEntry(cfg.entry);
      P.set('busy', cfg.busy || 'off');
      if (cfg.sheet) P.openSheet(cfg.sheet); else P.closeSheet();
    }, s);
    await page.waitForTimeout(200);
    await page.screenshot({ path: `${outDir}/${prefix}-${s.name}.png` });
    console.log('wrote', `${prefix}-${s.name}`);
  }
  await browser.close();
}

await run(chromium, 'cr');
await run(webkit, 'wk');
