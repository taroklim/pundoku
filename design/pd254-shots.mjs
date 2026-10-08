/**
 * PD-254 — короткий живой прогон отклика нажатия вкладки: Chromium + WebKit, 390×844 @3x, light/dark, реальная сборка.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd254-dist
 *   node design/pd159-serve.mjs /tmp/pd254-dist 5541 &
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend BASE=http://127.0.0.1:5541 LABEL=after node design/pd254-shots.mjs
 *
 * LABEL=before — та же съёмка на сборке без PD-254 (только кадры покоя, для сравнения «пиксель в пиксель»).
 * Результат: design/pd254-shots/<LABEL>.json + кадры бара <LABEL>-<browser>-<scheme>-<state>.png. Никаких pkill/killall.
 *
 * Что фиксируется: opacity вкладок в покое; во время удержания (mouse down без up) по центру Play, по выбранной Today и в
 * полосе индикатора Home под Play (зона ::before PD-221); после отпускания — сменилась ли вкладка (выбор по click);
 * Chromium — ещё и настоящий жест касания через CDP (synthesizeTapGesture с удержанием); фейд обратно в обычном режиме и при reduced motion.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PW_HOME = process.env.PD_PW_HOME || "/tmp/pd16-pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
const req = (b) => {
  try {
    return createRequire(b)("playwright");
  } catch {
    return null;
  }
};
const pw = req(process.cwd() + "/") ?? req(PW_HOME + "/");
if (!pw) {
  console.error("Playwright не найден");
  process.exit(1);
}

const BASE = process.env.BASE ?? "http://127.0.0.1:5541";
const LABEL = process.env.LABEL ?? "after";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "pd254-shots");
mkdirSync(OUT, { recursive: true });
const W = 390;
const H = 844;
const INSET = 34;

const opacities = (page) =>
  page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[role="tab"]')].map((t) => [t.id, getComputedStyle(t).opacity])));
const box = (page, sel) => page.locator(sel).boundingBox();

async function run(browserName, scheme, reduced) {
  const browser = await pw[browserName].launch();
  const res = { browser: browserName, scheme, reduced };
  try {
    const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 3,
      isMobile: browserName === "chromium",
      hasTouch: true,
      locale: "en-US",
      colorScheme: scheme,
      reducedMotion: reduced ? "reduce" : "no-preference",
      serviceWorkers: "block",
    });
    await ctx.addInitScript((inset) => {
      const add = () => {
        const s = document.createElement("style");
        s.textContent = `:root{--sa-bot:${inset}px !important}`;
        document.head.append(s);
      };
      if (document.head) add();
      else document.addEventListener("DOMContentLoaded", add);
    }, INSET);
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/today`);
    await page.waitForSelector('[role="tablist"]');
    await page.waitForTimeout(1200);
    const bar = await box(page, ".tabbar");
    const clip = { x: 0, y: bar.y - 4, width: W, height: H - bar.y + 4 };
    const shot = (state) => page.screenshot({ path: join(OUT, `${LABEL}-${browserName}-${scheme}${reduced ? "-rm" : ""}-${state}.png`), clip });

    res.rest = await opacities(page);
    res.tabTransition = await page.evaluate(() => getComputedStyle(document.querySelector('[role="tab"]')).transition);
    await shot("rest");
    if (LABEL === "before") return res;

    const play = await box(page, "#tab-play");
    const today = await box(page, "#tab-today");
    const hold = async (x, y, name) => {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(60);
      const o = await opacities(page);
      if (name) await shot(name);
      return o;
    };

    // 1. Удержание по выбранной вкладке (пилюля) — отпустить; выбор не меняется.
    res.holdSelectedToday = await hold(today.x + today.width / 2, today.y + today.height / 2, "press-today-selected");
    await page.mouse.up();
    await page.waitForTimeout(400);

    // 2. Удержание по невыбранной Play; отпускание -> click -> Play выбрана; фейд обратно.
    res.holdPlay = await hold(play.x + play.width / 2, play.y + play.height / 2, "press-play");
    await page.mouse.up();
    res.afterRelease16ms = await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => r(getComputedStyle(document.querySelector("#tab-play")).opacity))),
    );
    await page.waitForTimeout(500);
    res.afterRelease500ms = await opacities(page);
    res.selectedAfterClick = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id);

    // 3. Полоса индикатора Home под Year (зона ::before, PD-221) — отклик у Year.
    await page.waitForTimeout(600);
    const year = await box(page, "#tab-year");
    res.holdHomeIndicatorUnderYear = await hold(year.x + year.width / 2, H - 6, "press-year-home-zone");
    await page.mouse.up();
    await page.waitForTimeout(500);
    res.selectedAfterHomeZone = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id);

    // 4. Chromium: настоящий жест касания (CDP synthesizeTapGesture, удержание 600 мс), опрос :active во время удержания.
    //    Голый Input.dispatchTouchEvent touchStart :active не включает — у Chromium :active от касания идёт через жесты.
    if (browserName === "chromium") {
      await page.waitForTimeout(600);
      const cdp = await ctx.newCDPSession(page);
      const t = await box(page, "#tab-today");
      const tap = cdp.send("Input.synthesizeTapGesture", { x: t.x + t.width / 2, y: t.y + t.height / 2, duration: 600, gestureSourceType: "touch" });
      res.touchHoldTodaySamples = [];
      for (let i = 0; i < 8; i++) {
        await page.waitForTimeout(70);
        res.touchHoldTodaySamples.push(await page.evaluate(() => { const el = document.querySelector("#tab-today"); return `${el.matches(":active")}/${getComputedStyle(el).opacity}`; }));
        if (i === 2) await shot("touch-press-today");
      }
      await tap;
      await page.waitForTimeout(500);
      res.selectedAfterTouch = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.id);
    }
    return res;
  } catch (e) {
    res.error = String(e);
    return res;
  } finally {
    await browser.close();
  }
}

const out = [];
for (const b of ["chromium", "webkit"]) {
  for (const s of ["light", "dark"]) out.push(await run(b, s, false));
  if (LABEL !== "before") out.push(await run(b, "light", true));
}
writeFileSync(join(OUT, `${LABEL}.json`), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
