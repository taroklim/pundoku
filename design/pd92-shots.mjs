/**
 * PD-92 — съёмка кадров макета логотипов (по секциям страницы, не одним длинным скроллом).
 *
 * Порты не занимает: file://. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd92-shots.mjs
 *
 * Пишет cr-*.png (chromium) и wk-*.png (webkit) в design/pd92-shots/.
 * Viewport 393x852 @2x (iPhone 16 CSS-размер). Секции: s1 знак+вордмарк, s2 иконка и домашний
 * экран, s3 проверка размеров (180/120/60/29), s4 экраны приложения, s5 движение.
 * Кадры qa-mask-*.png (круг maskable 80 %) пишет pd92-qa.mjs.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd92-shots");
const URL = pathToFileURL(join(DIR, "pd92-logo-variants.html")).href;
mkdirSync(OUT, { recursive: true });

const SEC = { s1: 1, s2: 2, s3: 3, s4: 4, s5: 5 }; // индекс в main > section (0 — заголовок направления)

// [браузер, вариант, вид, секция]
const SHOTS = [];
for (const v of ["A", "B", "C"]) {
  SHOTS.push(["cr", v, "light", "s1"], ["cr", v, "dark", "s2"], ["cr", v, "light", "s3"], ["cr", v, "dark", "s3"]);
  SHOTS.push(["cr", v, "light", "s4-3"]); // Настройки -> О приложении
  SHOTS.push(["wk", v, "light", "s1"]);
}
SHOTS.push(["wk", "B", "dark", "s2"], ["cr", "B", "dark", "s4-4"], ["cr", "A", "light", "s4-4"],
  ["cr", "C", "dark", "s4-2"], ["cr", "B", "light", "s4-5"]);

const engines = { cr: chromium, wk: webkit };
for (const eng of ["cr", "wk"]) {
  const browser = await engines[eng].launch();
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(URL);
  for (const [e, v, a, s] of SHOTS.filter((x) => x[0] === eng)) {
    await p.click(`#segV button[data-v="${v}"]`);
    await p.click(`#segA button[data-a="${a}"]`);
    await p.waitForTimeout(120);
    // sticky-панель не должна попадать в кадр секции
    await p.addStyleTag({ content: ".bar{position:static!important}" });
    const name = `${e}-${v.toLowerCase()}-${a}-${s}.png`;
    const m = /^s(\d)-(\d)$/.exec(s);
    if (m) {
      // подсекция 4.N: от h3 «4.N» до следующего h3 (или конца секции)
      const sec = p.locator("main > section").nth(+m[1]);
      const box = await p.evaluate(([si, n]) => {
        const sec = document.querySelectorAll("main > section")[si];
        const hs = [...sec.querySelectorAll("h3")];
        const i = hs.findIndex((h) => h.textContent.trim().startsWith(si + "." + n));
        const top = hs[i].getBoundingClientRect().top + scrollY;
        const next = hs[i + 1];
        const bottom = next ? next.getBoundingClientRect().top + scrollY : sec.getBoundingClientRect().bottom + scrollY;
        return { x: 0, y: top - 4, width: innerWidth, height: bottom - top };
      }, [+m[1], +m[2]]);
      await p.screenshot({ path: join(OUT, name), fullPage: true, clip: box });
    } else {
      const sec = p.locator("main > section").nth(SEC[s]);
      await sec.scrollIntoViewIfNeeded();
      await sec.screenshot({ path: join(OUT, name) });
    }
    console.log(name);
  }
  if (errs.length) console.log("ERRORS", eng, errs);
  await browser.close();
}
