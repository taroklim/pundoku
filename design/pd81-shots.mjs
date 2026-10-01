/**
 * PD-81 — съёмка кадров макета движения.
 *
 * Никакого порта не занимает: страница открывается по file:// (макет самодостаточный,
 * ни одной сетевой зависимости). Если когда-нибудь понадобится http — поднимать строго
 * на 3700–3799, порты 3500/3600/5500/5600/8090 чужие. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd81-shots.mjs
 *
 * Пишет cr-*.png (chromium) и wk-*.png (webkit) в design/pd81-shots/.
 * Viewport 393×852 @2x — iPhone 16. Для кадров с reduced motion используется
 * context({ reducedMotion: 'reduce' }) — то есть проверяется НАСТОЯЩИЙ media query,
 * а не только внутренний переключатель страницы.
 */
import { createRequire } from "node:module";
// Playwright стоит ВНЕ репо (/tmp/pd16-pw, macOS 13 -> Playwright 1.49): обычный
// `import "playwright"` из design/ его не найдёт, поэтому резолвим от cwd.
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd81-shots");
const URL = pathToFileURL(join(DIR, "pd81-motion-variants.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 393, height: 852 };

/** Ждёт, пока волна дойдёт до пика заливки (opacity >= порога), чтобы кадр не зависел от
 *  задержки скриншота. Падает по таймауту, если волна не запустилась вовсе. */
async function waitWavePeak(p, min) {
  await p.waitForFunction((m) => {
    const w = document.querySelectorAll(".cell.wave > .wv, .cell.tint > .wv");
    for (const e of w) if (+getComputedStyle(e).opacity >= m) return true;
    return false;
  }, min, { timeout: 3000, polling: "raf" });
}


/**
 * Каждый кадр: имя, тема, вариант, reducedMotion и сценарий.
 * Сценарий получает page и сам решает, что нажать и сколько подождать.
 */
const SHOTS = [
  // --- базовый экран, то, что владелец видит при открытии -------------
  {
    name: "a1-v2-light-dock", theme: "light", variant: "V2",
    run: async (p) => { await p.evaluate(() => pd81.dockCtl()); }
  },
  {
    name: "a2-v2-dark-dock", theme: "dark", variant: "V2",
    run: async (p) => { await p.evaluate(() => pd81.dockCtl()); }
  },
  {
    name: "a3-v2-light-clean", theme: "light", variant: "V2",
    run: async (p) => { await p.evaluate(() => pd81.closeCtl()); }
  },
  {
    name: "a4-v2-dark-clean", theme: "dark", variant: "V2",
    run: async (p) => { await p.evaluate(() => pd81.closeCtl()); }
  },

  // --- M3: волна в середине проигрывания ------------------------------
  {
    name: "b1-v2-light-row-wave", theme: "light", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("row"); });
      await waitWavePeak(p, 0.14);                 // пик волны (.15) — после place в 560 мс
    }
  },
  {
    name: "b2-v1-light-row-tint", theme: "light", variant: "V1",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("row"); });
      await waitWavePeak(p, 0.10);                 // плоский тинт V1 (пик .12)
    }
  },

  // --- M5 / E1: финал -------------------------------------------------
  {
    name: "c1-v3-light-finale-settle", theme: "light", variant: "V3",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("solve"); });
      await p.waitForTimeout(1050);                // оседание боксов + полёт
    }
  },
  {
    name: "c2-v2-light-solved", theme: "light", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.solved(); });
      await p.waitForTimeout(500);
    }
  },
  {
    name: "c3-v2-dark-solved", theme: "dark", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.solved(); });
      await p.waitForTimeout(500);
    }
  },

  // --- M7: клякса -----------------------------------------------------
  {
    name: "d1-v2-light-blot-spread", theme: "light", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("blot"); });
      await p.waitForTimeout(760);                 // пятно есть, верная цифра ещё не пришла
    }
  },
  {
    name: "d2-v2-light-blot-done", theme: "light", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("blot"); });
      await p.waitForTimeout(1400);
    }
  },
  {
    name: "d3-v2-dark-blot-done", theme: "dark", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("blot"); });
      await p.waitForTimeout(1400);
    }
  },

  // --- M10: вкладки ---------------------------------------------------
  {
    name: "e1-v3-light-pane-year", theme: "light", variant: "V3",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.pane(2); });
      await p.waitForTimeout(400);
    }
  },

  // --- M11: таймлапс --------------------------------------------------
  {
    name: "f1-v2-light-timelapse", theme: "light", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("timelapse"); });
      await p.waitForTimeout(1600);
      await p.evaluate(() => pd81.tlFrame(28));
      await p.waitForTimeout(260);
    }
  },
  {
    name: "f2-v2-dark-timelapse", theme: "dark", variant: "V2",
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("timelapse"); });
      await p.waitForTimeout(1600);
      await p.evaluate(() => pd81.tlFrame(28));
      await p.waitForTimeout(260);
    }
  },

  // --- Reduced motion: системный media query, не внутренний тумблер ----
  {
    name: "g1-v3-light-reduced-solved", theme: "light", variant: "V3", reduce: true,
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("solve"); });
      await p.waitForTimeout(1200);
    }
  },
  {
    name: "g2-v2-light-reduced-timelapse", theme: "light", variant: "V2", reduce: true,
    run: async (p) => {
      await p.evaluate(() => { pd81.closeCtl(); pd81.run("timelapse"); });
      await p.waitForTimeout(600);
    }
  },
  {
    name: "g3-v2-light-reduced-panel", theme: "light", variant: "V2", reduce: true,
    run: async (p) => {
      await p.evaluate(() => pd81.openCtl());
      await p.waitForTimeout(400);
      await p.evaluate(() => {
        const bd = document.querySelector("#ctl .sheet-bd");
        if (bd) bd.scrollTop = 240;                // довести до блока Reduce Motion
      });
      await p.waitForTimeout(200);
    }
  },

  // --- Панель с описанием вариантов (чтобы владелец читал с кадра) -----
  {
    name: "h1-v1-light-panel", theme: "light", variant: "V1",
    run: async (p) => { await p.evaluate(() => { pd81.openCtl(); const b=document.querySelector("#ctl .sheet-bd"); if(b) b.scrollTop = 300; }); await p.waitForTimeout(250); }
  },
  {
    name: "h2-v3-dark-panel", theme: "dark", variant: "V3",
    run: async (p) => { await p.evaluate(() => { pd81.openCtl(); const b=document.querySelector("#ctl .sheet-bd"); if(b) b.scrollTop = 300; }); await p.waitForTimeout(250); }
  }
];

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: s.theme === "dark" ? "dark" : "light",
      reducedMotion: s.reduce ? "reduce" : "no-preference"
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(URL, { waitUntil: "load" });
    await page.waitForTimeout(300);
    await page.evaluate((v) => { pd81.theme(null); pd81.variant(v); }, s.variant);
    // Тема задана colorScheme на уровне контекста: внутренний тумблер держим на «Авто»,
    // чтобы проверялся системный prefers-color-scheme, а не наш оверрайд.
    await page.waitForTimeout(120);
    await s.run(page);
    // Замораживаем всё, что ещё играет, чтобы задержка скриншота не сдвигала кадр
    await page.evaluate(() => document.getAnimations().forEach((a) => { try { a.pause(); } catch (e) {} }));
    await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
    // Макет сам показывает красный баннер при ошибке — ловим его и в консоль тоже
    const banner = await page.evaluate(() => {
      const b = document.getElementById("pd81-err");
      return b ? b.textContent : null;
    });
    if (banner) errors.push("БАННЕР: " + banner.replace(/\s+/g, " "));
    if (errors.length) console.log(`  ! ${prefix}-${s.name}: ${errors.slice(0, 3).join(" | ")}`);
    else console.log(`  ok ${prefix}-${s.name}`);
    await ctx.close();
  }
  await browser.close();
}

console.log("chromium…");
await shoot(chromium, "cr");
console.log("webkit…");
await shoot(webkit, "wk");
console.log("готово →", OUT);
