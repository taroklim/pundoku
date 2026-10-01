/**
 * PD-92 — QA макета логотипов + проверка maskable safe zone.
 *
 * Порты не занимает: всё по file://. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd92-qa.mjs
 *
 * Печатает JSON-отчёт в stdout. Пишет кадры maskable-проверки в design/pd92-shots/qa-*.png.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd92-shots");
const PAGE = pathToFileURL(join(DIR, "pd92-logo-variants.html")).href;
const ASSETS = join(DIR, "pd92-assets");
mkdirSync(OUT, { recursive: true });

const report = { page: [], svg: [], maskable: [] };
const log = (section, o) => report[section].push(o);

/* ---------------------------------------------------------------- страница */
async function checkPage(bt, btName) {
  const browser = await bt.launch();
  for (const [w, h] of [[393, 852], [320, 700]]) {
    for (const scheme of ["light", "dark"]) {
      for (const rm of ["no-preference", "reduce"]) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: h },
          deviceScaleFactor: 3,
          colorScheme: scheme,
          reducedMotion: rm,
          hasTouch: true,
          isMobile: btName === "chromium"
        });
        const p = await ctx.newPage();
        const errs = [];
        const reqs = [];
        p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
        p.on("console", (m) => {
          if (m.type() === "error" || m.type() === "warning") errs.push("console." + m.type() + ": " + m.text());
        });
        p.on("request", (r) => reqs.push(r.url()));
        await p.goto(PAGE);
        await p.waitForTimeout(300);
        const tag = `${btName} ${w}px ${scheme} rm=${rm}`;

        const states = [];
        // прокликать все переключатели: направление x вид
        for (const v of ["A", "B", "C"]) {
          await p.click(`#segV button[data-v="${v}"]`);
          for (const a of ["light", "dark"]) {
            await p.click(`#segA button[data-a="${a}"]`);
            for (const rmv of ["sys", "on", "off"]) {
              await p.click(`#segRM button[data-rm="${rmv}"]`);
              await p.click("#play");
              await p.waitForTimeout(40);
              const st = await p.evaluate(() => {
                const r = document.documentElement;
                const pressed = (id) =>
                  [...document.querySelectorAll("#" + id + " button")]
                    .filter((b) => b.getAttribute("aria-pressed") === "true")
                    .map((b) => b.dataset.v || b.dataset.a || b.dataset.rm);
                const err = document.getElementById("pd92-err");
                const svgCount = document.querySelectorAll("main svg").length;
                const emptyMarks = [...document.querySelectorAll("[data-mark],[data-icon],[data-sizes]")].filter(
                  (e) => !e.querySelector("svg")
                ).length;
                return {
                  v: r.dataset.v, appear: r.dataset.appear,
                  pressedV: pressed("segV"), pressedA: pressed("segA"), pressedRM: pressed("segRM"),
                  mo: r.style.getPropertyValue("--mo"), mk: r.style.getPropertyValue("--mk"),
                  errVisible: getComputedStyle(err).display !== "none",
                  svgCount, emptyMarks,
                  title: document.getElementById("vName").textContent,
                  stagePlay: document.getElementById("stage").classList.contains("play")
                };
              });
              const exp = { v, appear: a };
              const ok =
                st.v === v && st.appear === a && st.pressedV[0] === v && st.pressedA[0] === a &&
                st.pressedRM[0] === rmv && !st.errVisible && st.emptyMarks === 0 && st.stagePlay;
              const wantMo = rmv === "on" || (rmv === "sys" && rm === "reduce") ? "0" : "1";
              if (!ok || st.mo !== wantMo) states.push({ v, a, rmv, st, wantMo });
            }
          }
        }
        // вернуть B/light и измерить
        await p.click('#segV button[data-v="B"]');
        await p.click('#segA button[data-a="light"]');
        const m = await p.evaluate(() => {
          const docW = document.documentElement.scrollWidth;
          const small = [];
          const all = document.body.querySelectorAll("*");
          for (const e of all) {
            if (["SCRIPT", "STYLE", "SVG", "svg", "path", "rect", "circle", "g", "title", "tspan", "text"].includes(e.tagName)) continue;
            if (e.closest("svg")) continue;
            // только элементы с собственным видимым текстом
            const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).length;
            if (!own) continue;
            const fs = parseFloat(getComputedStyle(e).fontSize);
            if (fs < 16) small.push({ sel: e.tagName.toLowerCase() + "." + e.className, fs, txt: e.textContent.trim().slice(0, 30) });
          }
          const tap = [];
          for (const b of document.querySelectorAll("button, a, [role=button]")) {
            const r = b.getBoundingClientRect();
            if (r.width < 44 || r.height < 44) tap.push({ txt: b.textContent.trim().slice(0, 25), w: Math.round(r.width), h: Math.round(r.height) });
          }
          // элементы, торчащие за правый край
          const over = [];
          for (const e of document.body.querySelectorAll("*")) {
            const r = e.getBoundingClientRect();
            if (r.width && r.right > innerWidth + 0.5 && !e.closest("svg")) over.push(e.tagName + "." + e.className + " right=" + Math.round(r.right));
          }
          return { docW, innerW: innerWidth, small, tap, over: over.slice(0, 8) };
        });
        const net = reqs.filter((u) => !u.startsWith("file://"));
        log("page", {
          tag, errs, hScroll: m.docW > m.innerW, docW: m.docW, innerW: m.innerW,
          smallFonts: m.small, smallTap: m.tap, overflowEls: m.over,
          nonFileRequests: net, allRequests: reqs.length, togglesProblems: states
        });
        await ctx.close();
      }
    }
  }
  await browser.close();
}

/* ------------------------------------------------------------- отдельные SVG */
async function checkSvgs(bt, btName) {
  const browser = await bt.launch();
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".svg")).sort();
  for (const f of files) {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 600 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    const resp = await p.goto(pathToFileURL(join(ASSETS, f)).href);
    const info = await p.evaluate(() => {
      const s = document.documentElement;
      const isSvg = s.tagName.toLowerCase() === "svg";
      const perr = document.querySelector("parsererror") || document.body?.innerText?.includes("error on line");
      const bb = isSvg ? s.getBoundingClientRect() : null;
      return { isSvg, parseError: !!perr, w: bb && Math.round(bb.width), h: bb && Math.round(bb.height) };
    });
    // непустая отрисовка: не одноцветный скрин
    const buf = await p.screenshot();
    log("svg", { browser: btName, file: f, ...info, errs, bytes: buf.length });
    await ctx.close();
  }
  await browser.close();
}

/* --------------------------------------------------------------- maskable */
/**
 * Растрируем каждый иконочный SVG 1024x1024 (без масок), считаем самый далёкий от центра
 * пиксель, отличающийся от цвета поля, и сравниваем с радиусом 409.6 (80% диаметра).
 * Параллельно рисуем поверх круг и сохраняем кадр (для визуального осмотра).
 */
async function checkMaskable(bt, btName) {
  const browser = await bt.launch();
  const files = readdirSync(ASSETS).filter((f) => /icon-1024/.test(f)).sort();
  for (const f of files) {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const svg = readFileSync(join(ASSETS, f), "utf8");
    await p.setContent(
      `<body style="margin:0;background:#888"><div style="position:relative;width:1024px;height:1024px">` +
        `<img id="i" style="display:block" src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" width="1024" height="1024">` +
        `<svg style="position:absolute;inset:0" viewBox="0 0 1024 1024" width="1024" height="1024">` +
        `<circle cx="512" cy="512" r="409.6" fill="none" stroke="#ff2d55" stroke-width="3"/></svg></div></body>`
    );
    await p.waitForFunction(() => document.getElementById("i").complete);
    const res = await p.evaluate(async () => {
      const img = document.getElementById("i");
      const c = document.createElement("canvas");
      c.width = c.height = 1024;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0, 1024, 1024);
      const d = g.getImageData(0, 0, 1024, 1024).data;
      const f = [d[0], d[1], d[2]]; // поле = угловой пиксель
      let maxR = 0, at = null, minX = 1024, maxX = 0, minY = 1024, maxY = 0;
      for (let y = 0; y < 1024; y++) {
        for (let x = 0; x < 1024; x++) {
          const i = (y * 1024 + x) * 4;
          if (Math.abs(d[i] - f[0]) + Math.abs(d[i + 1] - f[1]) + Math.abs(d[i + 2] - f[2]) > 40) {
            const r = Math.hypot(x + 0.5 - 512, y + 0.5 - 512);
            if (r > maxR) { maxR = r; at = [x, y]; }
            if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
          }
        }
      }
      return { maxR: +maxR.toFixed(1), at, bbox: [minX, minY, maxX, maxY] };
    });
    const png = join(OUT, `qa-mask-${btName === "chromium" ? "cr" : "wk"}-${f.replace("pd92-", "").replace(".svg", "")}.png`);
    if (/light/.test(f) && (btName === "chromium" || /-c-/.test(f))) await p.screenshot({ path: png });
    log("maskable", { browser: btName, file: f, ...res, limit: 409.6, ok: res.maxR <= 409.6 });
    await ctx.close();
  }
  await browser.close();
}

for (const [n, bt] of [["chromium", chromium], ["webkit", webkit]]) {
  await checkPage(bt, n);
  await checkSvgs(bt, n);
  await checkMaskable(bt, n);
}
console.log(JSON.stringify(report, null, 1));
