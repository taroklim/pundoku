/**
 * PD-201 — живая проверка звукового ядра Мелодии (apps/web/src/melody/audio.ts) в chromium + webkit на dev-стенде.
 *
 *   cd apps/web && npx vite --port 5201 --strictPort          # стенд только в dev: /dev/melody.html
 *   PD_PW_HOME=<папка с node_modules/playwright> BASE=http://localhost:5201 node design/pd201-audio-check.mjs
 *
 * Проверки: до жеста контекст не создан и нота молчит; жест (клик) создаёт и запускает AudioContext; ноты/арпеджио/тембры
 * строят граф (счётчики узлов растут); mute глушит; путь идёт шагами и останавливается посреди; `fromMs` доигрывает хвост;
 * офлайн-рендер каждого тембра: звук есть, без клиппинга, тишина до ноты и после хвоста, без скачков (щелчков); dispose;
 * консоль и pageerror чистые. Звук на iPhone (беззвучный режим, звонок, сон PWA) этим не проверить — чек-лист владельцу.
 * Никаких pkill: браузеры закрываются в finally.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PW_HOME = process.env.PD_PW_HOME || "/tmp/pundoku-qa/pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
function loadPlaywright() {
  for (const b of [process.cwd() + "/", PW_HOME + "/"]) {
    try {
      return createRequire(b)("playwright");
    } catch {
      /* следующий */
    }
  }
  console.error("Playwright не найден (cwd, " + PW_HOME + ")");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();
const BASE = process.env.BASE ?? "http://localhost:5201";

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(name, type) {
  const browser = await type.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${BASE}/dev/melody.html`);
    await page.waitForFunction(() => window.__melody !== undefined);
    const M = (fn, arg) => page.evaluate(fn, arg);
    const tag = (s) => `[${name}] ${s}`;

    ok(tag("до жеста: состояние locked, контекст не создан"), (await M(() => window.__melody.state())) === "locked" && (await M(() => window.__melody.counts().contexts)) === 0);
    ok(tag("до жеста: playNote молчит (false), контекст не создаётся"), (await M(() => window.__melody.playNote(5))) === false && (await M(() => window.__melody.counts().contexts)) === 0);

    await page.click("#unlock");
    const running = await page
      .waitForFunction(() => window.__melody.state() === "running", null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    ok(tag("жест: AudioContext создан и запущен"), running && (await M(() => window.__melody.counts().contexts)) === 1, await M(() => window.__melody.state()));
    const session = await M(() => window.__melody.session());
    ok(tag("audioSession: ambient там, где API есть"), session === null || session === "ambient", String(session));

    const before = await M(() => window.__melody.counts().oscillators);
    await page.click('button[data-digit="5"]');
    const afterNote = await M(() => window.__melody.counts().oscillators);
    ok(tag("нота по клику строит граф (осцилляторы)"), afterNote > before, `${before}→${afterNote}`);
    ok(tag("playUnit 1..9 звучит"), (await M(() => window.__melody.playUnit([1, 2, 3, 4, 5, 6, 7, 8, 9]))) === true);
    for (const t of ["soft", "bell", "marimba"]) {
      ok(tag(`тембр ${t}: нота звучит`), (await M((tt) => (window.__melody.setTimbre(tt), window.__melody.playNote(9)), t)) === true);
    }
    ok(tag("mute: нота молчит"), (await M(() => (window.__melody.setMuted(true), window.__melody.playNote(1)))) === false);
    ok(tag("unmute: нота снова звучит"), (await M(() => (window.__melody.setMuted(false), window.__melody.playNote(1)))) === true);

    // путь: старт → 1.5 с → stop → шаги замерли
    await M(() => window.__melody.startPath());
    await sleep(1500);
    await M(() => window.__melody.stopPath());
    const n1 = (await M(() => window.__melody.steps())).length;
    await sleep(800);
    const n2 = (await M(() => window.__melody.steps())).length;
    const total = await M(() => window.__melody.melodyLength());
    ok(tag("playPath: шаги идут, stop посреди останавливает"), n1 > 0 && n1 < total && n2 === n1, `${n1}/${total}`);
    ok(tag("playPath: done = stopped"), (await M(() => window.__melody.pathResult())) === "stopped");
    const dur = await M(() => window.__melody.melodyDuration());
    await M((from) => window.__melody.startPath(from), dur - 1500);
    const ended = await page
      .waitForFunction(() => window.__melody.pathResult() === "ended", null, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    const steps = await M(() => window.__melody.steps());
    ok(tag("playPath fromMs: хвост доигран до конца, шаги по порядку"), ended && steps.length > 0 && steps.every((s, i) => i === 0 || s.i > steps[i - 1].i), `${steps.length} шагов`);

    for (const t of ["soft", "bell", "marimba"]) {
      const r = await M((tt) => window.__melody.renderOffline(tt), t);
      const good = r.peak > 0.005 && r.peak < 1 && r.preRoll < 1e-4 && r.tail < 1e-3 && r.maxStep < r.peak * 0.5;
      ok(tag(`офлайн-рендер ${t}: звук, без клиппинга, тишина до/после, без щелчков`), good, JSON.stringify({ peak: +r.peak.toFixed(4), rms: +r.rms.toFixed(4), preRoll: r.preRoll, tail: +r.tail.toExponential(2), maxStep: +r.maxStep.toFixed(4) }));
    }

    await M(() => window.__melody.dispose());
    ok(tag("dispose: состояние disposed, нота молчит"), (await M(() => window.__melody.state())) === "disposed" && (await M(() => window.__melody.playNote(3))) === false);
    await page.click('button[data-digit="3"]');
    ok(tag("после dispose жест не пересоздаёт контекст"), (await M(() => window.__melody.counts().contexts)) === 1);

    ok(tag("консоль и pageerror чистые"), errors.length === 0, errors.join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  await run("chromium", chromium);
  await run("webkit", webkit);
} finally {
  const failed = results.filter((r) => !r.cond).length;
  console.log(`\n${results.length - failed}/${results.length} PASS`);
  process.exitCode = failed === 0 ? 0 : 1;
}
