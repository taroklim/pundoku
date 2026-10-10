/**
 * PD-295 — живая проверка экрана Year: весь год виден, панель прокручивается до конца, последний ряд месяцев (Oct–Dec) и легенда
 * в конце прокрутки целиком НАД таб-баром с запасом ≥ 16 px (десктоп C — над нижним краем окна), на РЕАЛЬНОЙ сборке.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pd295-dist
 *   PD_PW_HOME=<папка с node_modules/playwright> DIST=/tmp/pd295-dist PORT=5551 LABEL=main node design/pd295-check.mjs [chromium] [webkit]
 *
 * Условия — как design/pd285-check.mjs / pd277-shots.mjs: html font-size 17 px (40 px — AX3), --sa-top/--sa-bot 59/34 (393×852,
 * 430×932) и 20/0 (320×568), isMobile + hasTouch; десктоп C 1280×800, 1440×900 и компакт 1024×640 при DPR 1,25 / 1,5 (ноутбук
 * 125/150 %) — без touch. Время зафиксировано (2026-10-09), сетка дня — своя (как pdlow4/lib.mjs).
 *
 * Состояния года: «пустой» (первый запуск: блок «Open today's puzzle» над полотном, легенды нет) и «полный» (решён Today, запись
 * дня размножена на 2026-01-01…2026-10-08 с разными метками — решён/с подсказкой/позже/не закончен/пропуск; итоги в 2 строки на
 * ru/uk). Сценарии входа: сразу `#/year`; Today → вкладка Year; партия Play решена (карточка с доком PD-285) → вкладка Year.
 *
 * Что меряется на каждом кадре:
 *   overflow   — панель Year (`.scroll.tab-pane[data-tab=year]`) прокручиваемая: overflow-y auto, не hidden (правила
 *                `.scroll:has(.play-fit/.play-hub/.play-result-dock)` на Year не протекают);
 *   reserve    — padding-bottom панели = 16 + --tabbar-h + --sa-bot (на десктопе C — 16), scroll-padding-bottom — то же (PD-292);
 *   end        — в конце прокрутки низ Dec и низ легенды ≤ верх таб-бара − 16 (десктоп: ≤ высота окна − 16);
 *   gesture    — настоящий жест (chromium: touch-свайп CDP; десктоп: колесо) докручивает панель до конца: scrollTop = range ± 1;
 *   reach      — elementFromPoint в центре Dec после прокрутки — сама карточка Dec (не таб-бар, не чужой слой).
 * REF=1 — эталонные сборки до пакета 4 (3e8d8c8, c3caf66): без пункта PD-292 (scroll-padding тогда ещё не было).
 * Итог — design/pd295-shots/results-<LABEL>-<браузеры>.json, кадры — /tmp/pd295-shots/<LABEL>/ (в ветку — отобранные).
 */
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const pw = createRequire((process.env.PD_PW_HOME ?? "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend") + "/")("playwright");
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.resolve(process.env.DIST ?? path.join(HERE, "../apps/web/dist"));
const PORT = +(process.env.PORT ?? 5551);
const LABEL = process.env.LABEL ?? "run";
const OUT = path.join(HERE, "pd295-shots");
const SHOTS = process.env.SHOTS ?? path.join("/tmp/pd295-shots", LABEL);
const NOW = new Date("2026-10-09T09:00:00Z");
const MISSION = "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const args = process.argv.slice(2);
const brs = args.filter((a) => ["chromium", "webkit"].includes(a));
const browsers = brs.length ? brs : ["chromium", "webkit"];
const QUICK = process.env.QUICK === "1";
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

// ---------- сервер ----------
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".webmanifest": "application/manifest+json" };
function serve(root, port) {
  const server = http.createServer((q, r) => {
    const u = decodeURIComponent(q.url.split("?")[0]);
    const m = u.match(/^\/api\/daily\/(\d{4}-\d{2}-\d{2})$/);
    if (m) {
      r.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      return r.end(JSON.stringify({ date: m[1], mission: MISSION, difficulty: "medium", source: "sudoku.com", winRate: 71 }));
    }
    if (u.startsWith("/api/")) {
      r.writeHead(503);
      return r.end();
    }
    let f = path.join(root, u);
    if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(root, "index.html");
    r.writeHead(200, { "content-type": types[path.extname(f)] ?? "application/octet-stream" });
    fs.createReadStream(f).pipe(r);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

const results = {};
const fails = [];
const check = (name, ok, detail = {}) => {
  results[name] = { ok: !!ok, ...detail };
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, JSON.stringify(detail));
};

// ---------- судоку ----------
function solve(s) {
  const g = s.split("").map(Number);
  const ok = (i, v) => {
    const r = (i / 9) | 0, c = i % 9;
    for (let k = 0; k < 9; k++) if (g[r * 9 + k] === v || g[k * 9 + c] === v) return false;
    const br = r - (r % 3), bc = c - (c % 3);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) if (g[(br + a) * 9 + bc + b] === v) return false;
    return true;
  };
  const rec = () => {
    let best = -1, bcnt = 10, bo;
    for (let i = 0; i < 81; i++)
      if (!g[i]) {
        const o = [];
        for (let v = 1; v <= 9; v++) if (ok(i, v)) o.push(v);
        if (o.length < bcnt) { bcnt = o.length; best = i; bo = o; if (bcnt <= 1) break; }
      }
    if (best < 0) return true;
    for (const v of bo) { g[best] = v; if (rec()) return true; g[best] = 0; }
    return false;
  };
  return rec() ? g.join("") : null;
}
const readBoard = (p, pane) =>
  p.evaluate((pane) => {
    const out = Array(81).fill("0");
    for (const c of document.querySelectorAll(`.tab-pane[data-tab="${pane}"] .board button.cell[data-i]`)) {
      const d = c.querySelector(".d.given, .d.player");
      if (d) out[+c.dataset.i] = d.textContent.trim();
    }
    return out.join("");
  }, pane);
async function fillPane(p, pane) {
  const g = await readBoard(p, pane);
  const sol = solve(g);
  for (let i = 0; i < 81; i++) {
    if (g[i] !== "0") continue;
    await p.locator(`.tab-pane[data-tab="${pane}"] .board .cell[data-i="${i}"]`).tap();
    await p.locator(`.tab-pane[data-tab="${pane}"] .pad .key`).nth(+sol[i] - 1).tap();
  }
}

// ---------- браузер ----------
const ENV_INIT = () => {
  const v = sessionStorage.getItem("pd295env");
  if (!v) return;
  const [f, t, b] = JSON.parse(v);
  const add = () => {
    const st = document.createElement("style");
    st.id = "pd295-env";
    st.textContent = `html{font-size:${f}px !important}:root{--sa-top:${t}px !important;--sa-bot:${b}px !important}`;
    document.documentElement.appendChild(st);
  };
  if (document.documentElement) add();
  else document.addEventListener("DOMContentLoaded", add);
};
async function context(browser, bname, { w, h, dpr = 2, touch = true, scheme = "light", lang = "en-US", env = null, state }) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    screen: { width: w, height: h },
    deviceScaleFactor: dpr,
    isMobile: touch && bname === "chromium",
    hasTouch: touch,
    locale: lang,
    timezoneId: "UTC",
    colorScheme: scheme,
    serviceWorkers: "block",
    reducedMotion: "reduce",
    ...(state ? { storageState: state } : {}),
  });
  await ctx.clock.setFixedTime(NOW);
  if (env) await ctx.addInitScript((v) => sessionStorage.setItem("pd295env", v), JSON.stringify(env));
  await ctx.addInitScript(ENV_INIT);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => {
    if (!/api\/devices|access control/.test(e.message)) errs.push(e.message);
  });
  return { ctx, p, errs };
}

/** «Полный» год: решить Today, размножить запись дня на 2026-01-01…накануне (метки по кругу), снять storageState с IndexedDB. */
async function seedState(browser, bname, base) {
  const { ctx, p } = await context(browser, bname, { w: 393, h: 852, env: [17, 59, 34] });
  await p.goto(`${base}/#/today`);
  await p.waitForSelector('.tab-pane[data-tab="today"] .board button.cell', { timeout: 60000 });
  await p.waitForTimeout(400);
  await fillPane(p, "today");
  await p.waitForTimeout(1500);
  const n = await p.evaluate(
    () =>
      new Promise((ok, no) => {
        const r = indexedDB.open("pundoku");
        r.onerror = () => no(r.error);
        r.onsuccess = () => {
          const tx = r.result.transaction("days", "readwrite");
          const st = tx.objectStore("days");
          const all = st.getAll();
          all.onsuccess = () => {
            const base = all.result[0];
            let n = 0;
            const d = new Date("2026-01-01T00:00:00Z");
            while (d.toISOString().slice(0, 10) < base.date) {
              const ds = d.toISOString().slice(0, 10);
              const k = n % 7;
              if (k !== 6) st.put({ ...base, date: ds, solvedAt: `${ds}T10:00:00.000Z`, late: k === 3, assisted: k === 2 || k === 5, hints: k === 2 ? 1 : 0, solved: k !== 4 });
              n++;
              d.setUTCDate(d.getUTCDate() + 1);
            }
            tx.oncomplete = () => ok(n);
          };
        };
      }),
  );
  const state = await ctx.storageState({ indexedDB: true });
  await ctx.close();
  return { state, n };
}

/** Замер Year: панель, резерв, конец прокрутки (программно), Dec и легенда относительно таб-бара / края окна. */
const measure = (p) =>
  p.evaluate(async () => {
    const yr = document.querySelector('[data-testid="year-screen"]');
    const pane = yr.closest(".scroll");
    const cs = getComputedStyle(pane);
    const desk = !!document.querySelector(".shell.desk");
    const barEl = document.querySelector(".tabbar");
    const barTop = !desk && barEl ? barEl.getBoundingClientRect().top : innerHeight;
    const root = getComputedStyle(document.documentElement);
    const px = (v) => parseFloat(v) || 0;
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;height:calc(16px + var(--tabbar-h) + var(--sa-bot))";
    pane.appendChild(probe);
    const want = probe.getBoundingClientRect().height;
    probe.remove();
    const range = pane.scrollHeight - pane.clientHeight;
    pane.scrollTop = range + 50;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const dec = [...yr.querySelectorAll(".year-month")].at(-1).getBoundingClientRect();
    const leg = yr.querySelector(".year-legend")?.getBoundingClientRect() ?? null;
    const hit = document.elementFromPoint((dec.left + dec.right) / 2, (dec.top + dec.bottom) / 2);
    const r1 = (v) => +v.toFixed(1);
    return {
      desk,
      ov: cs.overflowY,
      pb: r1(px(cs.paddingBottom)),
      spb: r1(px(cs.scrollPaddingBottom)),
      want: r1(want),
      range,
      st: Math.round(pane.scrollTop),
      barTop: r1(barTop),
      decBottom: r1(dec.bottom),
      legBottom: leg ? r1(leg.bottom) : null,
      contentBottom: r1(Math.max(dec.bottom, leg?.bottom ?? 0)),
      hitDec: !!hit?.closest('.year-month[data-month="11"]'),
      saBot: root.getPropertyValue("--sa-bot").trim(),
      paneCls: pane.className,
      dockLeak: !!yr.closest(".play-result-dock"),
    };
  });

/** Жест: на телефоне — touch-свайп вверх (chromium CDP); на десктопе — колесо. Возвращает scrollTop и range. */
async function gesture(p, bname, desk, w, h) {
  await p.evaluate(() => {
    document.querySelector('[data-testid="year-screen"]').closest(".scroll").scrollTop = 0;
  });
  await p.waitForTimeout(150);
  if (desk || bname !== "chromium") {
    if (desk) {
      await p.mouse.move(Math.round(w * 0.6), Math.round(h / 2));
      for (let i = 0; i < 6; i++) await p.mouse.wheel(0, 600);
    } else return null; // webkit без touch-жеста в Playwright: проверяется программной прокруткой (measure)
  } else {
    const cdp = await p.context().newCDPSession(p);
    for (let i = 0; i < 3; i++) {
      await cdp.send("Input.synthesizeScrollGesture", { x: Math.round(w / 2), y: Math.round(h * 0.55), yDistance: -Math.round(h * 0.45), speed: 1600, gestureSourceType: "touch" });
    }
  }
  await p.waitForTimeout(700);
  return p.evaluate(() => {
    const pane = document.querySelector('[data-testid="year-screen"]').closest(".scroll");
    return { st: Math.round(pane.scrollTop), range: pane.scrollHeight - pane.clientHeight };
  });
}

function verdict(key, m, g, { desk }) {
  const limit = m.barTop - 16; // десктоп: barTop = высота окна
  const okOv = m.ov === "auto" || m.ov === "scroll";
  const okReserve = Math.abs(m.pb - m.want) <= 1 && (!desk || Math.abs(m.pb - 16) <= 1);
  const okSpb = Math.abs(m.spb - m.want) <= 1;
  const okEnd = m.contentBottom <= limit + 0.5;
  const okGesture = g === null || g.range <= 0 || Math.abs(g.st - g.range) <= 1;
  check(`${key}: панель прокручивается (overflow ${m.ov}), док PD-285 не протёк`, okOv && !m.dockLeak, { ov: m.ov, cls: m.paneCls });
  check(`${key}: резерв снизу = 16 + таб-бар + inset (PD-144; десктоп C — 16)`, okReserve, { pb: m.pb, want: m.want });
  // До пакета 4 scroll-padding у панели не было — на эталонах 3e8d8c8/c3caf66 этот пункт и должен падать (REF=1 — пропустить).
  if (process.env.REF !== "1") check(`${key}: scroll-padding-bottom = тот же резерв (PD-292)`, okSpb, { spb: m.spb, want: m.want });
  check(`${key}: в конце прокрутки Dec и легенда над таб-баром/краем ≥ 16 px`, okEnd, { decBottom: m.decBottom, legBottom: m.legBottom, barTop: m.barTop, gap: +(m.barTop - m.contentBottom).toFixed(1), range: m.range });
  check(`${key}: Dec достижим — elementFromPoint в его центре = Dec`, m.hitDec, {});
  if (g !== null) check(`${key}: жест докручивает до конца`, okGesture, g);
}

async function openYear(p, base, how) {
  if (how === "direct") {
    await p.goto(`${base}/#/year`);
  } else {
    await p.goto(`${base}/#/${how === "play" ? "play" : "today"}`);
    await p.waitForTimeout(900);
    if (how === "play") {
      await p.locator('.tab-pane[data-tab="play"] [data-testid="mode-classic"]').waitFor({ timeout: 60000 });
      await p.locator('.tab-pane[data-tab="play"] [data-testid="mode-classic"]').tap();
      await p.locator('[data-testid="sheet-start"]').waitFor();
      await p.waitForTimeout(400);
      if (await p.locator('[data-testid="difficulty-easy"]').count()) await p.locator('[data-testid="difficulty-easy"]').tap();
      await p.locator('[data-testid="sheet-start"]').tap();
      await p.locator('.tab-pane[data-tab="play"] .board .cell .d.given').first().waitFor({ timeout: 60000 });
      await p.waitForTimeout(400);
      await fillPane(p, "play");
      await p.locator('[data-testid="new-puzzle"]').first().waitFor({ timeout: 20000 }); // док PD-285 (на эталонах до пакета 4 — кнопки в карточке)
      await p.waitForTimeout(700);
    }
    await p.locator("#tab-year").tap();
  }
  await p.waitForSelector('[data-testid="year-canvas"]', { timeout: 60000 });
  await p.waitForTimeout(900);
}

const PHONES = [
  { name: "393", w: 393, h: 852, env: [17, 59, 34] },
  { name: "320", w: 320, h: 568, env: [17, 20, 0] },
  { name: "430", w: 430, h: 932, env: [17, 59, 34] },
  { name: "393-AX3", w: 393, h: 852, env: [40, 59, 34] },
];
const DESKS = [
  { name: "1280x800", w: 1280, h: 800, dpr: 1 },
  { name: "1440x900", w: 1440, h: 900, dpr: 1 },
  { name: "1024x640@1.25", w: 1024, h: 640, dpr: 1.25 },
  { name: "1024x640@1.5", w: 1024, h: 640, dpr: 1.5 },
];

const server = await serve(DIST, PORT);
const base = `http://127.0.0.1:${PORT}`;
try {
  for (const bname of browsers) {
    const browser = await pw[bname].launch();
    const short = bname === "chromium" ? "cr" : "wk";
    const { state, n } = await seedState(browser, bname, base);
    console.log(`seed ${bname}: ${n} дней`);
    const langs = QUICK ? ["en-US"] : ["en-US", "ru-RU", "uk-UA"];
    // Телефон: полный год × язык × тема; пустой год — en, light.
    for (const s of PHONES) {
      for (const lang of langs) {
        for (const scheme of QUICK || lang !== "en-US" ? ["light"] : ["light", "dark"]) {
          const { ctx, p, errs } = await context(browser, bname, { w: s.w, h: s.h, env: s.env, lang, scheme, state });
          await openYear(p, base, "direct");
          const key = `${short} ${s.name} full ${lang.slice(0, 2)} ${scheme}`;
          const m = await measure(p);
          await p.screenshot({ path: path.join(SHOTS, `${short}-${s.name}-full-${lang.slice(0, 2)}-${scheme}-end.png`) });
          verdict(key, m, await gesture(p, bname, false, s.w, s.h), { desk: false });
          check(`${key}: без ошибок страницы`, errs.length === 0, { errs });
          await ctx.close();
        }
      }
      const { ctx, p } = await context(browser, bname, { w: s.w, h: s.h, env: s.env });
      await openYear(p, base, "direct");
      const m = await measure(p);
      await p.screenshot({ path: path.join(SHOTS, `${short}-${s.name}-empty-en-light-end.png`) });
      verdict(`${short} ${s.name} empty en light`, m, await gesture(p, bname, false, s.w, s.h), { desk: false });
      await ctx.close();
    }
    // Сценарии входа (393, полный год): Today → Year; решённая партия Play (док PD-285) → Year.
    for (const how of ["today", "play"]) {
      const { ctx, p } = await context(browser, bname, { w: 393, h: 852, env: [17, 59, 34], state });
      await openYear(p, base, how);
      const m = await measure(p);
      await p.screenshot({ path: path.join(SHOTS, `${short}-393-full-via-${how}-end.png`) });
      verdict(`${short} 393 full via ${how}`, m, await gesture(p, bname, false, 393, 852), { desk: false });
      await ctx.close();
    }
    // Десктоп C и компакт: полный и пустой год, колесо.
    for (const s of DESKS) {
      for (const st of ["full", "empty"]) {
        const { ctx, p } = await context(browser, bname, { w: s.w, h: s.h, dpr: s.dpr, touch: false, state: st === "full" ? state : undefined });
        await openYear(p, base, "direct");
        const m = await measure(p);
        await p.screenshot({ path: path.join(SHOTS, `${short}-${s.name}-${st}-end.png`) });
        verdict(`${short} desk ${s.name} ${st}`, m, await gesture(p, bname, true, s.w, s.h), { desk: true });
        await ctx.close();
      }
    }
    await browser.close();
  }
} finally {
  server.close();
}
const file = path.join(OUT, `results-${LABEL}-${browsers.map((b) => (b === "chromium" ? "cr" : "wk")).join("+")}.json`);
fs.writeFileSync(file, JSON.stringify({ label: LABEL, dist: DIST, total: Object.keys(results).length, fails, results }, null, 1));
console.log(`\n${Object.keys(results).length - fails.length}/${Object.keys(results).length} PASS → ${path.relative(process.cwd(), file)}`);
process.exitCode = fails.length ? 1 : 0;
