/**
 * PD-257 — D1 QA PD-250: карточку «решено» сразу после решения нельзя было докрутить до конца в WebKit.
 * Причина: `content-visibility: auto` секции Grid ∞ при reduced motion (PD-95) — WebKit не пересчитывал область прокрутки `.scroll`,
 * когда секция входила в экран; снято (today.css/tokens.css).
 *
 *   cd apps/web && pnpm exec vite build --outDir /tmp/pd257-dist
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd257-dist node design/pd257-check.mjs [webkit|chromium ...]
 *   + портрет попиксельно против main: BASE_DIST=<сборка main> node design/pd257-check.mjs portrait
 *
 * Сценарий на каждый размер: Today, решить сетку дня тапами → карточка; сразу прокрутить до конца (scrollTop и жест колесом).
 * Проверки (FAIL печатается): scrollTop дошёл до scrollHeight − clientHeight; последний абзац Grid ∞ целиком над таб-баром;
 * кнопки карточки (Watch/Share) после scrollIntoView видны над таб-баром и попадают под тап (elementFromPoint).
 * Кадры design/pd257-shots/<br>-<w>x<h>-<rm>-card.png / -card-end.png. Сервер и браузер закрываются в finally; без pkill.
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const OUT = process.env.OUT ?? path.join(HERE, "pd257-shots");
const PORT = +(process.env.PORT ?? 5257);
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const args = process.argv.slice(2).length ? process.argv.slice(2) : ["webkit", "chromium"];
const browsers = args.filter((a) => a === "webkit" || a === "chromium");
const BASE_DIST = process.env.BASE_DIST ? path.resolve(process.env.BASE_DIST) : null;
// [размер, reduced motion]. Дефект воспроизводился при reduced (там был content-visibility); без него — контроль.
const RUNS = {
  webkit: [["852x393", "reduce"], ["932x430", "reduce"], ["390x844", "reduce"], ["375x667", "reduce"], ["852x393", "no-preference"]],
  chromium: [["852x393", "reduce"], ["390x844", "reduce"]],
};
fs.mkdirSync(OUT, { recursive: true });

function solve(m) {
  const g = [...m].map(Number);
  const ok = (i, d) => {
    const r = Math.floor(i / 9), c = i % 9;
    for (let k = 0; k < 9; k++) if (g[r * 9 + k] === d || g[k * 9 + c] === d) return false;
    const br = r - (r % 3), bc = c - (c % 3);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === d) return false;
    return true;
  };
  const go = () => { const i = g.indexOf(0); if (i < 0) return true; for (let d = 1; d <= 9; d++) if (ok(i, d)) { g[i] = d; if (go()) return true; g[i] = 0; } return false; };
  go();
  return g;
}
const SOL = solve(MISSION);

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const serve = (DIST) => http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split("?")[0]);
  const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
  if (m) {
    r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    return r.end(JSON.stringify({ date: m[1], mission: MISSION, difficulty: "medium", source: "sudoku.com", winRate: 71 }));
  }
  if (u.startsWith("/api/")) { r.writeHead(503); return r.end(); }
  let f = path.join(DIST, u);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, "index.html");
  r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
  fs.createReadStream(f).pipe(r);
});

const fails = [];
const check = (name, ok, detail) => { if (!ok) fails.push(name); console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail)); };

const server = serve(DIST);
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
const baseServer = BASE_DIST ? serve(BASE_DIST) : null;
if (baseServer) await new Promise((ok) => baseServer.listen(PORT + 1, "127.0.0.1", ok));

// Today → решить сетку дня тапами → карточка «решено».
async function solveToCard(browser, { W, H, rm, port, scheme = "light" }) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "en-US", timezoneId: "UTC", reducedMotion: rm, colorScheme: scheme, serviceWorkers: "block" });
  await ctx.clock.setFixedTime(new Date("2026-10-08T09:00:00Z"));
  const p = await ctx.newPage();
  await p.goto(`http://127.0.0.1:${port}/#/today`);
  await p.waitForSelector(".board button.cell", { timeout: 40000 });
  await p.waitForTimeout(900);
  for (let i = 0; i < 81; i++) {
    if (MISSION[i] !== "0") continue;
    await p.locator(`.tab-pane:not(.off) .board button.cell[data-i="${i}"]`).tap();
    await p.locator(".tab-pane:not(.off) .pad .key").nth(SOL[i] - 1).tap();
  }
  await p.waitForSelector('[data-testid="result-card"]', { timeout: 20000 });
  await p.waitForTimeout(rm === "reduce" ? 1200 : 2500);
  return { ctx, p };
}
try {
  for (const br of browsers) {
    const browser = await pw[br].launch();
    try {
      for (const [size, rm] of RUNS[br]) {
        const [W, H] = size.split("x").map(Number);
        const tag = `${br === "webkit" ? "wk" : "cr"}-${size}-${rm === "reduce" ? "rm" : "motion"}`;
        const { ctx, p } = await solveToCard(browser, { W, H, rm, port: PORT });
        try {
          await p.screenshot({ path: path.join(OUT, `${tag}-card.png`) });

          // Сразу после решения: до конца программно и жестом.
          const end = await p.evaluate(async () => {
            const s = document.querySelector(".scroll.tab-pane:not(.off)");
            s.scrollTop = 1e6;
            await new Promise((ok) => setTimeout(ok, 300));
            return { st: Math.round(s.scrollTop), max: s.scrollHeight - s.clientHeight };
          });
          check(`${tag}: scrollTop до конца`, end.st >= end.max - 1, end);
          await p.evaluate(() => { document.querySelector(".scroll.tab-pane:not(.off)").scrollTop = 0; });
          await p.mouse.move(W / 2, Math.min(H / 2, H - 120));
          for (let k = 0; k < 8; k++) { await p.mouse.wheel(0, 400).catch(() => {}); await p.waitForTimeout(80); }
          await p.waitForTimeout(600);
          const wheel = await p.evaluate(() => { const s = document.querySelector(".scroll.tab-pane:not(.off)"); return { st: Math.round(s.scrollTop), max: s.scrollHeight - s.clientHeight }; });
          // Колесо в мобильном контексте Playwright-WebKit может не прокручивать вовсе — тогда это не проверка, а SKIP.
          if (wheel.st === 0) console.log(`SKIP ${tag}: жест (колесо) не поддержан этим контекстом`, JSON.stringify(wheel));
          else check(`${tag}: жест (колесо) до конца`, wheel.st >= wheel.max - 1, wheel);
          await p.evaluate(async () => { document.querySelector(".scroll.tab-pane:not(.off)").scrollTop = 1e6; await new Promise((ok) => setTimeout(ok, 300)); });
          const last = await p.evaluate(() => {
            const tab = document.querySelector(".tabbar").getBoundingClientRect().top;
            const g = document.querySelector('[data-testid="grid-inf-section"] p:last-of-type').getBoundingClientRect();
            return { tabTop: Math.round(tab), lastBottom: Math.round(g.bottom) };
          });
          check(`${tag}: последний абзац Grid ∞ над таб-баром`, last.lastBottom <= last.tabTop, last);
          await p.screenshot({ path: path.join(OUT, `${tag}-card-end.png`) });

          // Кнопки карточки внизу: видны над таб-баром и под тапом.
          for (const sel of ['[data-testid="result-card"] button.tl-watch', '[data-testid="result-card"] button.share']) {
            const b = await p.evaluate(async (sel) => {
              const el = document.querySelector(sel);
              if (!el) return { missing: true };
              el.scrollIntoView({ block: "nearest" });
              await new Promise((ok) => setTimeout(ok, 200));
              const r = el.getBoundingClientRect();
              const tab = document.querySelector(".tabbar").getBoundingClientRect().top;
              const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return { top: Math.round(r.top), bottom: Math.round(r.bottom), tabTop: Math.round(tab), hit: !!hit && (hit === el || el.contains(hit)) };
            }, sel);
            check(`${tag}: ${sel.split(" ").pop()} доступна`, !b.missing && b.hit && b.bottom <= b.tabTop && b.top >= 0, b);
          }
        } finally {
          await ctx.close();
        }
      }
    } finally {
      await browser.close();
    }
  }
  // Портрет: карточка (сразу после решения) и её конец — попиксельно как сборка main (где на этих размерах дефекта не было).
  if (args.includes("portrait")) {
    if (!baseServer) throw new Error("portrait: нужен BASE_DIST (сборка main)");
    for (const br of (process.env.PORTRAIT_BR ?? "chromium,webkit").split(",")) {
      const browser = await pw[br].launch();
      try {
        const cmp = await browser.newPage();
        const diff = (a, b) => cmp.evaluate(async ([a, b]) => {
          const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + s; });
          const [ia, ib] = await Promise.all([load(a), load(b)]);
          if (ia.width !== ib.width || ia.height !== ib.height) return -1;
          const px = (i) => { const c = new OffscreenCanvas(i.width, i.height); const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
          const da = px(ia), db = px(ib);
          let n = 0;
          for (let k = 0; k < da.length; k += 4) if (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2]) n++;
          return n;
        }, [a.toString("base64"), b.toString("base64")]);
        for (const [W, H, rm, scheme] of [[393, 852, "reduce", "light"], [393, 852, "no-preference", "dark"]]) {
          const pics = {};
          for (const [k, port] of [["base", PORT + 1], ["new", PORT]]) {
            const { ctx, p } = await solveToCard(browser, { W, H, rm, port, scheme });
            try {
              // Недетерминированное содержимое закрыто маской: время/техники и тепловая карта (тайминги тапов), мини-поле Grid ∞
              // (скрытое решение случайно на каждый запуск — другая цифра подсказки). Раскладка вокруг сравнивается попиксельно.
              const mask = [p.locator('[data-testid="result-card"] .heat'), p.locator('[data-testid="result-card"] .rows'), p.locator('[data-testid="grid-inf-section"] .board-wrap')];
              const take = async (screen) => { const buf = await p.screenshot({ mask, maskColor: "#f0f" }); (pics[screen] ??= {})[k] = buf; fs.writeFileSync(path.join(OUT, `portrait-${br === "webkit" ? "wk" : "cr"}-${W}x${H}-${scheme}-${screen}-${k}.png`), buf); };
              await take("card");
              await p.evaluate(async () => { document.querySelector(".scroll.tab-pane:not(.off)").scrollTop = 1e6; await new Promise((ok) => setTimeout(ok, 300)); });
              await take("card-end");
            } finally {
              await ctx.close();
            }
          }
          for (const [screen, v] of Object.entries(pics)) {
            const n = await diff(v.base, v.new);
            check(`portrait ${br} ${W}x${H} ${scheme} ${rm} ${screen}: = main`, n === 0, { diffPx: n });
          }
        }
      } finally {
        await browser.close();
      }
    }
  }
} finally {
  server.close();
  if (baseServer) baseServer.close();
}
console.log(fails.length ? `\n${fails.length} FAIL:\n  ${fails.join("\n  ")}` : "\nALL PASS");
process.exitCode = fails.length ? 1 : 0;
