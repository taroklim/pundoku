/**
 * PD-253 — живая проверка жеста «назад» от левого края на Settings и справке (только установленное приложение).
 *
 * Запуск (dev-стенд поднят отдельно, API не нужен):
 *   cd apps/web && vite --port 3953 --strictPort --host 127.0.0.1
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend BASE=http://127.0.0.1:3953 \
 *     node design/pd253-check.mjs [chromium-390] [webkit-390]   (без аргументов — оба по очереди)
 *
 * Standalone эмулируется `navigator.standalone = true` (init script) — тем же признаком, что у iOS. Chromium: настоящие касания
 * через CDP `Input.dispatchTouchEvent` (браузер сам применяет touch-action: вертикаль от края уходит в прокрутку с
 * pointercancel). WebKit (Playwright без CDP-касаний): синтетические PointerEvent `pointerType: "touch"` — проверяют логику жеста,
 * не touch-action. Один браузер за раз, закрывается в finally. Кадры и итог (results-<набор>.json): design/pd253-shots/. Никаких pkill.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function loadPlaywright() {
  const bases = [process.cwd(), process.env.PD_PW_HOME, "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend"].filter(Boolean);
  for (const b of bases) {
    try {
      return createRequire(join(b, "noop.js"))("playwright");
    } catch {
      /* next */
    }
  }
  console.error("Playwright не найден — задай PD_PW_HOME.");
  process.exit(1);
}
const pw = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd253-shots");
const BASE = process.env.BASE ?? "http://127.0.0.1:3953";
mkdirSync(OUT, { recursive: true });

const SETS = {
  "chromium-390": { engine: "chromium", real: true },
  "webkit-390": { engine: "webkit", real: false },
};
const want = process.argv.slice(2);
const results = [];
const STANDALONE = () => Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });

let nav = 0;
async function go(page, hash) {
  await page.goto(`${BASE}/?n=${++nav}#/${hash}`);
  await page.waitForSelector(".shell", { timeout: 60000 });
  await page.waitForTimeout(1200);
}
const STATE = () => {
  const layer = document.querySelector(".push-layer");
  const stack = document.querySelector(".stack");
  const play = document.querySelector('[data-tab="play"]');
  return {
    hash: location.hash,
    layer: !!layer,
    edgeAttr: layer?.hasAttribute("data-edge-back") ?? null,
    touchAction: layer ? getComputedStyle(layer).touchAction : null,
    transform: layer?.style.transform ?? null,
    scrollTop: layer ? Math.round(layer.scrollTop) : null,
    peek: stack?.hasAttribute("data-peek") ?? false,
    playVisible: play ? getComputedStyle(play).visibility : null,
    settings: !!document.querySelector('[data-testid="settings-back"]'),
    help: !!document.querySelector('[data-testid="help-screen"]'),
    // Что сверху справа от пальца: уезжающий экран должен перекрывать вкладку под ним целиком (z-index карточек хаба).
    topRight: document.elementFromPoint(300, 400)?.closest(".push-layer") ? "layer" : "other",
  };
};

/** Жест пальцем: точки [x, y], шаг `stepMs`; `holdMs` — пауза перед отпусканием (без броска); `release: false` — не отпускать. */
function makeFinger(page, real) {
  if (real) {
    let cdp = null;
    const send = async (type, x, y) => {
      cdp ??= await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" || type === "touchCancel" ? [] : [{ x, y, id: 1 }] });
    };
    return {
      async down(x, y) {
        await send("touchStart", x, y);
      },
      async move(x, y) {
        await send("touchMove", x, y);
      },
      async up() {
        await send("touchEnd");
      },
    };
  }
  let last = [0, 0];
  const fire = (type, x, y) =>
    page.evaluate(
      ([type, x, y]) => {
        const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, button: 0 };
        const target = type === "pointerdown" ? document.elementFromPoint(x, y) : document;
        target.dispatchEvent(new PointerEvent(type, init));
      },
      [type, x, y],
    );
  return {
    async down(x, y) {
      last = [x, y];
      await fire("pointerdown", x, y);
    },
    async move(x, y) {
      last = [x, y];
      await fire("pointermove", x, y);
    },
    async up() {
      await fire("pointerup", ...last);
    },
  };
}
async function stroke(page, finger, from, to, { steps = 12, stepMs = 16, holdMs = 250, release = true } = {}) {
  await finger.down(...from);
  for (let i = 1; i <= steps; i++) {
    await finger.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    if (stepMs > 0) await page.waitForTimeout(stepMs);
  }
  if (!release) return;
  if (holdMs > 0) await page.waitForTimeout(holdMs);
  await finger.up();
}
const gear = (page) => page.locator('.tab-pane:not(.off) [data-testid="open-settings"]');

async function runSet(name) {
  const o = SETS[name];
  const rec = { set: name, checks: [] };
  results.push(rec);
  const k = (label, ok, detail) => {
    rec.checks.push({ label, ok, detail });
    console.log(`${ok ? "ok   " : "FAIL "}[${name}] ${label}  ${JSON.stringify(detail)}`);
  };
  const browser = await pw[o.engine].launch();
  try {
    const ctxOpts = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: o.engine === "chromium", deviceScaleFactor: 2 };
    const shot = (page, step) => page.screenshot({ path: join(OUT, `${name}-${step}.png`) });

    // ---------- Установленное приложение ----------
    {
      const ctx = await browser.newContext(ctxOpts);
      await ctx.addInitScript(STANDALONE);
      const page = await ctx.newPage();
      const f = makeFinger(page, o.real);
      const st = () => page.evaluate(STATE);

      // 1. Settings с Play: экран за пальцем, под ним Play; дальше 35 % — назад на Play.
      await go(page, "play");
      await gear(page).click();
      await page.waitForTimeout(500);
      let s = await st();
      k("standalone: слой Settings помечен, touch-action pan-y", s.edgeAttr === true && /pan-y/.test(s.touchAction), s);
      await shot(page, "01-settings");
      await stroke(page, f, [6, 420], [186, 430], { release: false });
      await page.waitForTimeout(100);
      s = await st();
      k("ведение: экран едет за пальцем, Play видна под ним", /translate3d\((1[6-9]\d|20\d)(\.\d+)?px/.test(s.transform) && s.peek && s.playVisible === "visible" && s.topRight === "layer", s);
      await shot(page, "02-drag-mid");
      await page.waitForTimeout(250);
      await f.up();
      await page.waitForTimeout(700);
      s = await st();
      k("отпустил за 35 % → Play, слой закрыт", s.hash === "#/play" && !s.layer && !s.peek, s);
      await shot(page, "03-back-on-play");

      // 2. Недотяг — возврат.
      await gear(page).click();
      await page.waitForTimeout(500);
      await stroke(page, f, [6, 420], [96, 420]);
      await page.waitForTimeout(500);
      s = await st();
      k("недотянул (< 35 %) → Settings на месте, слой в покое", s.hash === "#/settings" && s.settings && s.transform === "" && !s.peek, s);

      // 3. Касание вне полосы 16 px.
      await stroke(page, f, [40, 420], [300, 420], { stepMs: 30 });
      await page.waitForTimeout(500);
      s = await st();
      k("старт в 40 px от края → не жест", s.hash === "#/settings" && s.transform === "", s);

      // 4. Вертикальная прокрутка от края (настоящие касания — только chromium).
      if (o.real) {
        await stroke(page, f, [6, 700], [9, 300], { steps: 16, stepMs: 20, holdMs: 50 });
        await page.waitForTimeout(600);
        s = await st();
        k("вертикаль от края → прокрутка, экран не едет", s.scrollTop > 100 && s.transform === "" && s.hash === "#/settings", s);
        await page.evaluate(() => (document.querySelector(".push-layer").scrollTop = 0));
      }

      // 5. Справка из Settings (из низа, PD-232) → жест → Settings с прежней позицией.
      await page.locator('[data-testid="open-help"]').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const before = (await st()).scrollTop;
      await page.locator('[data-testid="open-help"]').click();
      await page.waitForTimeout(600);
      s = await st();
      k("справка открыта из Settings, с начала", s.help && s.scrollTop === 0, s);
      await stroke(page, f, [4, 420], [180, 420], { release: false });
      await page.waitForTimeout(100);
      s = await st();
      k("ведение на справке из Settings: экран едет, под ним пусто (без вкладки)", /translate3d/.test(s.transform) && !s.peek, s);
      await shot(page, "04-help-drag");
      await page.waitForTimeout(250);
      await f.up();
      await page.waitForTimeout(800);
      s = await st();
      k("справка → Settings, позиция Settings восстановлена", s.settings && !s.help && Math.abs(s.scrollTop - before) <= 2 && s.transform === "", { ...s, before });
      await shot(page, "05-back-on-settings");

      // 6. Бросок вправо с малой дистанции (120 px < 35 % от 390): шаги без пауз (CDP под нагрузкой и так ~40–50 мс на событие).
      await stroke(page, f, [4, 420], [124, 420], { steps: 5, stepMs: 0, holdMs: 0 });
      await page.waitForTimeout(800);
      s = await st();
      k("бросок вправо (120 px < 35 %) → назад на вкладку", s.hash === "#/play" && !s.layer, s);

      // 7. На вкладке (хаб Play) жест не действует.
      await stroke(page, f, [6, 420], [300, 420]);
      await page.waitForTimeout(500);
      s = await st();
      k("на вкладке Play свайп от края ничего не делает", s.hash === "#/play" && !s.layer, s);

      // 8. Кнопка «‹» по-прежнему работает (VoiceOver/клавиатура).
      await gear(page).click();
      await page.waitForTimeout(500);
      await page.locator('[data-testid="settings-back"]').click();
      await page.waitForTimeout(600);
      s = await st();
      k("кнопка «‹» — назад как раньше", s.hash === "#/play" && !s.layer, s);
      await ctx.close();
    }

    // ---------- Reduce Motion ----------
    {
      const ctx = await browser.newContext({ ...ctxOpts, reducedMotion: "reduce" });
      await ctx.addInitScript(STANDALONE);
      const page = await ctx.newPage();
      const f = makeFinger(page, o.real);
      await go(page, "play");
      await gear(page).click();
      await page.waitForTimeout(500);
      await stroke(page, f, [6, 420], [200, 420], { release: false });
      await page.waitForTimeout(100);
      let s = await page.evaluate(STATE);
      k("Reduce Motion: экран за пальцем не едет", s.transform === "" && !s.peek && s.settings, s);
      await page.waitForTimeout(250);
      await f.up();
      await page.waitForTimeout(400);
      s = await page.evaluate(STATE);
      k("Reduce Motion: по отпусканию — сразу назад", s.hash === "#/play" && !s.layer, s);
      await ctx.close();
    }

    // ---------- Safari-вкладка (не установлено) ----------
    {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      const f = makeFinger(page, o.real);
      await go(page, "play");
      await gear(page).click();
      await page.waitForTimeout(500);
      let s = await page.evaluate(STATE);
      k("браузер: слой без data-edge-back, touch-action не pan-y", s.edgeAttr === false && !/pan-y/.test(s.touchAction), s);
      await stroke(page, f, [6, 420], [300, 420]);
      await page.waitForTimeout(600);
      s = await page.evaluate(STATE);
      k("браузер: свайп от края — жест не активен", s.hash === "#/settings" && s.settings && s.transform === "", s);
      await ctx.close();
    }
  } catch (e) {
    rec.checks.push({ label: "exception", ok: false, detail: String(e?.stack ?? e) });
    console.log(`FAIL [${name}] exception ${e?.stack ?? e}`);
  } finally {
    await browser.close();
  }
}

for (const name of Object.keys(SETS)) if (want.length === 0 || want.includes(name)) await runSet(name);
for (const r of results) writeFileSync(join(OUT, `results-${r.set}.json`), JSON.stringify(r, null, 2));
const failed = results.flatMap((r) => r.checks.filter((c) => !c.ok));
console.log(failed.length === 0 ? "ALL OK" : `FAILED: ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
