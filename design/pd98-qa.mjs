/**
 * PD-98 — QA макета логотипов раунд 3: страница, 18 SVG, maskable-замер, расхождения chromium/webkit.
 *
 * Порты не занимает: всё по file://. Никаких pkill/killall.
 *
 * Запуск:
 *   cd /tmp/pd16-pw && PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers node \
 *     /Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/design/pd98-qa.mjs [page|svg|mask|xdiff|c29]...
 *
 * Без аргументов — всё. Печатает JSON-отчёт в stdout; кадры расхождений и maskable-кругов пишет
 * в design/pd98-shots/qa-*.png.
 */
import { createRequire } from "node:module";
const { chromium, webkit } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd98-shots");
const PAGE = pathToFileURL(join(DIR, "pd98-logo-round3.html")).href;
const ASSETS = join(DIR, "pd98-assets");
mkdirSync(OUT, { recursive: true });

const want = new Set(process.argv.slice(2));
const run = (n) => want.size === 0 || want.has(n);
const report = { page: [], svg: [], maskable: [], xdiff: [], c29: [] };
const log = (section, o) => report[section].push(o);
const ENGINES = [["chromium", chromium], ["webkit", webkit]];
const DIRS = ["d4", "d5", "d6"];
const APPS = ["light", "dark", "tinted"];
const MOS = ["system", "on", "off"];

/* ---------------------------------------------------------------- страница */
async function checkPage(bt, btName) {
  const browser = await bt.launch();
  for (const [w, h] of [[393, 852], [320, 700]]) {
    for (const scheme of ["light", "dark"]) {
      for (const rm of ["no-preference", "reduce"]) {
        const ctx = await browser.newContext({
          viewport: { width: w, height: h }, deviceScaleFactor: 3, colorScheme: scheme, reducedMotion: rm,
          hasTouch: true, isMobile: false
        });
        const p = await ctx.newPage();
        const errs = [], reqs = [];
        p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
        p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push("console." + m.type() + ": " + m.text()); });
        p.on("requestfailed", (r) => errs.push("requestfailed: " + r.url()));
        p.on("request", (r) => reqs.push(r.url()));
        await p.goto(PAGE);
        await p.waitForTimeout(250);
        const tag = `${btName} ${w}px ${scheme} rm=${rm}`;
        const problems = [];
        let hScrollStates = [];

        // --- переключатели: направление x подача x движение
        for (const d of DIRS) {
          await p.click(`button[data-set="dir"][data-val="${d}"]`);
          for (const a of APPS) {
            await p.click(`button[data-set="appear"][data-val="${a}"]`);
            for (const mo of MOS) {
              await p.click(`button[data-set="motion"][data-val="${mo}"]`);
              await p.click("#play");
              await p.waitForTimeout(30);
              const st = await p.evaluate(() => {
                const r = document.documentElement;
                const pressed = (set) => [...document.querySelectorAll(`.seg button[data-set="${set}"]`)]
                  .filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.val);
                // у каждой группы .v ровно одна видимая <use> на svg; каждая <use> резолвится
                const bad = [];
                for (const svg of document.querySelectorAll("main svg")) {
                  const us = [...svg.querySelectorAll(":scope > use")];
                  const vis = us.filter((u) => getComputedStyle(u).display !== "none");
                  const hasV = us.some((u) => u.classList.contains("v"));
                  const hasD = us.some((u) => /^d[456]$/.test(u.getAttribute("class") || ""));
                  if ((hasV || hasD) && vis.length !== 1) bad.push("use-visible=" + vis.length);
                }
                for (const u of document.querySelectorAll("use")) {
                  const id = (u.getAttribute("href") || "").slice(1);
                  if (!document.getElementById(id)) bad.push("dangling use " + id);
                }
                return {
                  dir: r.dataset.dir, appear: r.dataset.appear, motion: r.dataset.motion,
                  reduced: r.classList.contains("reduced"),
                  pDir: pressed("dir"), pApp: pressed("appear"), pMo: pressed("motion"),
                  bad, docW: document.documentElement.scrollWidth, innerW: innerWidth
                };
              });
              const ok = st.dir === d && st.appear === a && st.motion === mo &&
                st.pDir[0] === d && st.pApp[0] === a && st.pMo[0] === mo &&
                st.pDir.length === 1 && st.pApp.length === 1 && st.pMo.length === 1 &&
                st.reduced === (mo === "on") && st.bad.length === 0;
              if (!ok) problems.push({ d, a, mo, st });
              if (st.docW > st.innerW) hScrollStates.push(`${d}/${a}/${mo}: ${st.docW}>${st.innerW}`);
            }
          }
        }

        // --- анимации: реально идут / при Reduce не двигаются
        const anim = [];
        for (const d of scheme === "light" ? DIRS : []) { // тема на анимации не влияет — только light
          await p.click(`button[data-set="dir"][data-val="${d}"]`);
          await p.click(`button[data-set="appear"][data-val="light"]`);
          for (const mo of MOS) {
            await p.click(`button[data-set="motion"][data-val="${mo}"]`);
            await p.evaluate(() => document.getElementById("play").scrollIntoView({ block: "center" }));
            await p.click("#play");
            const samples = [];
            const t0 = Date.now();
            for (const at of [0, 90, 300, 800, 1000]) {
              const wait = at - (Date.now() - t0);
              if (wait > 0) await p.waitForTimeout(wait);
              samples.push(await p.evaluate(() => [...document.querySelectorAll(".anim-slide,.anim-core,.anim-carry,.anim-ink")]
                .filter((e) => getComputedStyle(e.closest("svg")).display !== "none" && e.closest("svg").getBoundingClientRect().width > 0)
                .map((e) => {
                  const r = e.getBoundingClientRect();
                  const cs = getComputedStyle(e);
                  return { cls: e.getAttribute("class"), x: r.x, y: r.y, w: r.width, h: r.height, op: +cs.opacity, name: cs.animationName,
                    dur: cs.animationDuration, n: cs.animationIterationCount };
                })));
            }
            // сколько живых анимаций через 3.4 с (самая долгая — 700 мс)
            await p.waitForTimeout(2800);
            const alive = await p.evaluate(() => document.getAnimations().filter((a) => a.playState === "running").length);
            const els = samples[0].length;
            const expEls = { d4: 2, d5: 1, d6: 1 }[d];
            const effReduce = mo === "on" || (mo === "system" && rm === "reduce");
            const info = [];
            for (let i = 0; i < els; i++) {
              const ser = samples.map((s) => s[i]);
              const move = Math.max(...ser.map((s) => Math.abs(s.x - ser[0].x) + Math.abs(s.y - ser[0].y) + Math.abs(s.w - ser[0].w) + Math.abs(s.h - ser[0].h)));
              const opd = Math.max(...ser.map((s) => s.op)) - Math.min(...ser.map((s) => s.op));
              info.push({ cls: ser[0].cls, names: [...new Set(ser.map((s) => s.name))].join(","), move: +move.toFixed(1), opSpan: +opd.toFixed(2) });
            }
            let verdict = els === expEls ? "ok" : `BAD visible anim elements ${els} != ${expEls}`;
            for (const i of info) {
              if (effReduce && (i.move > 0.6 || !/mo-fade/.test(i.names))) verdict = "BAD reduce moves/not fade";
              if (!effReduce && (/mo-fade/.test(i.names) || (i.cls !== "anim-core" && i.move < 5) || (i.cls === "anim-core" && i.opSpan < 0.5))) verdict = "BAD no animation";
            }
            anim.push({ d, mo, effReduce, verdict, info, aliveAfter3s: alive });
          }
        }

        // --- метрики: шрифты, тап-цели, переполнение
        await p.click('button[data-set="dir"][data-val="d4"]');
        await p.click('button[data-set="appear"][data-val="light"]');
        await p.click('button[data-set="motion"][data-val="system"]');
        const m = await p.evaluate(() => {
          const small = [], smallMock = new Set();
          for (const e of document.body.querySelectorAll("*")) {
            if (e.closest("svg") || ["SCRIPT", "STYLE"].includes(e.tagName)) continue;
            const own = [...e.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).length;
            if (!own || getComputedStyle(e).display === "none") continue;
            const fs = parseFloat(getComputedStyle(e).fontSize);
            if (fs < 16) {
              if (e.closest(".mini") || e.closest(".pngcard")) smallMock.add(fs);
              else small.push({ sel: e.tagName.toLowerCase() + "." + e.className, fs, txt: e.textContent.trim().slice(0, 30) });
            }
          }
          const tap = [];
          for (const b of document.querySelectorAll("button, a, [role=button], input")) {
            const r = b.getBoundingClientRect();
            if (r.width < 44 || r.height < 44) tap.push({ txt: b.textContent.trim().slice(0, 25), w: Math.round(r.width), h: Math.round(r.height) });
          }
          const over = [];
          for (const e of document.body.querySelectorAll("*")) {
            if (e.closest("svg") || e.closest(".mini")) continue;
            const r = e.getBoundingClientRect();
            if (r.width && (r.right > innerWidth + 0.5 || r.left < -0.5)) over.push(e.tagName + "." + e.className + " [" + Math.round(r.left) + "," + Math.round(r.right) + "]");
          }
          const clipped = [];
          for (const e of document.body.querySelectorAll("td,th,p,li,button,h1,h2,code,span")) {
            if (e.closest("svg") || e.closest(".mini")) continue;
            if (e.scrollWidth > e.clientWidth + 1 && e.clientWidth > 0 && getComputedStyle(e).display !== "inline")
              clipped.push(e.tagName + "." + e.className + " " + e.scrollWidth + ">" + e.clientWidth);
          }
          // битые url(#id) в документе
          const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
          const dangling = new Set();
          const html = document.documentElement.outerHTML;
          for (const mm of html.matchAll(/url\(#([\w-]+)\)/g)) if (!ids.has(mm[1])) dangling.add(mm[1]);
          return { small, smallMock: [...smallMock], tap, over: over.slice(0, 8), clipped: clipped.slice(0, 8), dangling: [...dangling],
            docW: document.documentElement.scrollWidth, innerW: innerWidth };
        });
        log("page", {
          tag, errs, hScroll: m.docW > m.innerW || hScrollStates.length > 0, hScrollStates: hScrollStates.slice(0, 5),
          smallFontsOutsideMocks: m.small, smallFontSizesInMocks: m.smallMock, smallTap: m.tap, overflowEls: m.over,
          clippedText: m.clipped, danglingUrlRefs: m.dangling,
          nonFileRequests: reqs.filter((u) => !u.startsWith("file://")), allRequests: reqs.length,
          togglesProblems: problems.slice(0, 4), togglesProblemCount: problems.length,
          anim: anim.filter((a) => a.verdict !== "ok").concat(rm === "reduce" || btName === "webkit" ? [] : []),
          animSummary: anim.map((a) => `${a.d}/${a.mo}:${a.verdict}${a.aliveAfter3s ? " alive=" + a.aliveAfter3s : ""}`).join(" ")
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
    const ctx = await browser.newContext({ viewport: { width: 640, height: 640 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await p.goto(pathToFileURL(join(ASSETS, f)).href);
    const info = await p.evaluate(() => {
      const s = document.documentElement;
      const isSvg = s.tagName.toLowerCase() === "svg";
      const perr = !!document.querySelector("parsererror") || !!document.body?.innerText?.includes("error on line");
      const ids = new Set([...document.querySelectorAll("[id]")].map((e) => e.id));
      const dang = new Set();
      for (const mm of s.outerHTML.matchAll(/url\(#([\w-]+)\)/g)) if (!ids.has(mm[1])) dang.add(mm[1]);
      const vb = s.getAttribute("viewBox");
      return { isSvg, parseError: perr, viewBox: vb, dangling: [...dang], hasText: !!document.querySelector("text") };
    });
    // непустая отрисовка: непрозрачных пикселей/разброса цвета достаточно
    const dataUrl = "data:image/svg+xml;utf8," + encodeURIComponent(readFileSync(join(ASSETS, f), "utf8"));
    const stat = await p.evaluate(async (u) => {
      const img = new Image(); img.src = u; await img.decode();
      const c = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas"); c.width = c.height = 256; // страница сама SVG, поэтому canvas в xhtml-ns
      const g = c.getContext("2d"); g.drawImage(img, 0, 0, 256, Math.round(256 * (img.naturalHeight / img.naturalWidth)));
      const d = g.getImageData(0, 0, 256, 256).data;
      let op = 0; const cols = new Set();
      for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 8) { op++; cols.add((d[i] >> 4) + "," + (d[i + 1] >> 4) + "," + (d[i + 2] >> 4)); } }
      return { w: img.naturalWidth, h: img.naturalHeight, opaqueShare: +(op / 65536).toFixed(3), colors: cols.size };
    }, dataUrl);
    log("svg", { browser: btName, file: f, ...info, ...stat, errs });
    await ctx.close();
  }
  await browser.close();
}

/* --------------------------------------------------------------- maskable */
const R_LIM = 409.6;
async function measure(p, svgText, mode) {
  return p.evaluate(async ({ svgText, mode }) => {
    const toImg = async (t) => { const i = new Image(); i.src = "data:image/svg+xml;utf8," + encodeURIComponent(t); await i.decode(); return i; };
    const draw = async (t) => {
      const i = await toImg(t);
      const c = document.createElement("canvas"); c.width = c.height = 1024;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(i, 0, 0, 1024, 1024);
      return g.getImageData(0, 0, 1024, 1024).data;
    };
    const A = await draw(svgText);
    let B = null;
    if (mode === "ref") {
      // эталон: тот же файл только с ведущими <rect> (фон + блик), без знака и тени
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const root = doc.documentElement;
      let keep = true;
      for (const ch of [...root.children]) {
        if (ch.tagName === "defs" || ch.tagName === "title" || ch.tagName === "desc") continue;
        if (keep && ch.tagName === "rect") continue;
        keep = false; root.removeChild(ch);
      }
      B = await draw(new XMLSerializer().serializeToString(doc));
    }
    const out = {};
    const th = mode === "alpha" ? [8, 128] : [24, 96, 200];
    for (const t of th) {
      let maxR = 0, at = null, n = 0, outside = 0;
      for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
        const i = (y * 1024 + x) * 4;
        let v;
        if (mode === "alpha") v = A[i + 3];
        else v = Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
        if (v > t) {
          n++;
          const r = Math.hypot(x + 0.5 - 512, y + 0.5 - 512);
          if (r > 409.6) outside++;
          if (r > maxR) { maxR = r; at = [x, y]; }
        }
      }
      out["t" + t] = { maxR: +maxR.toFixed(1), at, outsideCirclePx: outside, px: n };
    }
    return out;
  }, { svgText, mode });
}
async function checkMaskable(bt, btName) {
  const browser = await bt.launch();
  const p = await (await browser.newContext({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 })).newPage();
  await p.goto("about:blank");
  for (const d of DIRS) {
    // знак отдельно (чистая геометрия): fg-слой и mark (currentColor = чёрный)
    for (const kind of ["layer-fg", "mark"]) {
      const f = `${d}-${kind}.svg`;
      let t = readFileSync(join(ASSETS, f), "utf8");
      if (kind === "mark") t = t.replace(/currentColor/g, "#000");
      log("maskable", { browser: btName, file: f, mode: "alpha", ...(await measure(p, t, "alpha")) });
    }
    for (const a of APPS) {
      const f = `${d}-icon-${a}.svg`;
      const t = readFileSync(join(ASSETS, f), "utf8");
      log("maskable", { browser: btName, file: f, mode: "diff-vs-bg", ...(await measure(p, t, "ref")) });
    }
  }
  // кадры с кругом 80 % и квадратом 86 % поверх (chromium — все 9, webkit — только light)
  for (const f of readdirSync(ASSETS).filter((x) => /-icon-/.test(x)).sort()) {
    if (btName === "webkit" && !/light/.test(f)) continue;
    const svg = readFileSync(join(ASSETS, f), "utf8");
    await p.setContent(
      `<body style="margin:0;background:#777"><div style="position:relative;width:1024px;height:1024px">` +
      `<img id="i" style="display:block" src="data:image/svg+xml;utf8,${encodeURIComponent(svg)}" width="1024" height="1024">` +
      `<svg style="position:absolute;inset:0" viewBox="0 0 1024 1024" width="1024" height="1024">` +
      `<circle cx="512" cy="512" r="409.6" fill="none" stroke="#ff2d55" stroke-width="3"/>` +
      `<rect x="71.7" y="71.7" width="880.6" height="880.6" fill="none" stroke="#ff9f0a" stroke-width="3" stroke-dasharray="14 10"/></svg></div></body>`);
    await p.waitForFunction(() => document.getElementById("i").complete);
    await p.screenshot({ path: join(OUT, `qa-mask-${btName === "chromium" ? "cr" : "wk"}-${f.replace("-icon", "").replace(".svg", "")}.png`) });
  }
  await browser.close();
}


/* --------------------------------- фактический контраст после растеризации (29 px и 87 px) */
// Регионы в координатах 1024: прямоугольники, целиком лежащие внутри закрашенной области (проверено по геометрии,
// углы прямоугольников не выходят за скруглённые углы клеток). Пиксель учитывается, только если его след лежит
// целиком внутри прямоугольника, поэтому края (сглаживание) в среднее не попадают.
const C29 = {
  d4: { shared: [420, 420, 603, 603], cellA: [240, 240, 350, 350], cellB: [700, 700, 780, 780],
        bgA: [40, 240, 180, 350], bgB: [850, 700, 990, 780] },
  d5: { field: [250, 470, 340, 700], cell: [650, 238, 790, 374], bgCell: [830, 238, 980, 374], bgField: [40, 470, 190, 700],
        bgBite: [540, 400, 620, 490] },
  d6: { stroke: [400, 440, 600, 520], bg: [40, 440, 180, 520] }
};
async function checkC29(bt, btName) {
  const browser = await bt.launch();
  const p = await (await browser.newContext({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 })).newPage();
  await p.goto("about:blank");
  for (const d of DIRS) for (const a of ["light", "dark"]) for (const size of [29, 87]) {
    const svg = readFileSync(join(ASSETS, `${d}-icon-${a}.svg`), "utf8");
    const r = await p.evaluate(async ({ svg, size, regions, d }) => {
      const i = new Image(); i.src = "data:image/svg+xml;utf8," + encodeURIComponent(svg); await i.decode();
      const c = document.createElement("canvas"); c.width = c.height = size;
      const g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(i, 0, 0, size, size);
      const D = g.getImageData(0, 0, size, size).data;
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const lumAt = (px, py) => { const k = (py * size + px) * 4; return 0.2126 * lin(D[k]) + 0.7152 * lin(D[k + 1]) + 0.0722 * lin(D[k + 2]); };
      const s = size / 1024;
      const L = {}, N = {};
      for (const [name, [x0, y0, x1, y1]] of Object.entries(regions)) {
        let sum = 0, n = 0;
        for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
          if (px / s >= x0 && (px + 1) / s <= x1 && py / s >= y0 && (py + 1) / s <= y1) { sum += lumAt(px, py); n++; }
        }
        L[name] = n ? sum / n : null; N[name] = n;
      }
      const cr = (a, b) => (a == null || b == null) ? null : +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2);
      const out = { size, n: N, contrast: {} };
      if (d === "d4") {
        out.contrast = { "shared/cellA": cr(L.shared, L.cellA), "shared/cellB": cr(L.shared, L.cellB), "cellA/bg": cr(L.cellA, L.bgA),
          "cellB/bg": cr(L.cellB, L.bgB), "shared/bg(A)": cr(L.shared, L.bgA) };
      } else if (d === "d5") {
        out.contrast = { "field/bg": cr(L.field, L.bgField), "cell/bg": cr(L.cell, L.bgCell), "cell/field": cr(L.cell, L.field),
          "bgBite/field": cr(L.bgBite, L.field) };
        // коридор: вертикальный скан через x=655 (там клетка выше, поле ниже), от y=224 до y=560
        const col = Math.min(size - 1, Math.floor(655 * s));
        const prof = [];
        for (let py = Math.floor(224 * s); py <= Math.min(size - 1, Math.floor(560 * s)); py++) prof.push(+lumAt(col, py).toFixed(4));
        const bg = L.bgBite, lim = Math.min(L.cell, L.field);
        const t = prof.map((v) => (v - bg) / (lim - bg));
        // «фоновые» ряды: между клеткой и полем, ближе к фону чем к клетке/полю (t < 0.5); глубина зазора = min(t) внутри зазора
        const iCell = t.findIndex((v) => v > 0.8), idxs = t.map((v, k) => (v > 0.8 ? k : -1)).filter((k) => k >= 0);
        const lastCell = idxs.find((k, n) => idxs[n + 1] - k > 1 || n === idxs.length - 1);
        const firstField = idxs.find((k) => k > lastCell);
        const gap = firstField != null && lastCell != null ? t.slice(lastCell + 1, firstField) : [];
        out.corridor = { col, profile: prof, tNorm: t.map((v) => +v.toFixed(2)), gapRows: gap.length, gapMinT: gap.length ? +Math.min(...gap).toFixed(2) : null,
          gapRowsBelowHalf: gap.filter((v) => v < 0.5).length, gapRowsBelow025: gap.filter((v) => v < 0.25).length,
          expectedGapPx: +((512 - 388) * s).toFixed(2) };
      } else {
        out.contrast = { "stroke/bg": cr(L.stroke, L.bg) };
      }
      out.lum = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v == null ? null : +v.toFixed(4)]));
      return out;
    }, { svg, size, regions: C29[d], d });
    log("c29", { browser: btName, d, appear: a, ...r });
  }
  await browser.close();
}

/* ----------------------------------------------- расхождения chromium vs webkit */
async function checkXdiff() {
  const files = readdirSync(ASSETS).filter((f) => f.endsWith(".svg")).sort();
  const shots = { chromium: {}, webkit: {} };
  for (const [n, bt] of ENGINES) {
    const browser = await bt.launch();
    const ctx = await browser.newContext({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    for (const f of files) {
      let t = readFileSync(join(ASSETS, f), "utf8");
      t = t.replace(/currentColor/g, "#3B48B0");
      await p.setContent(`<body style="margin:0;background:#fff"><img id="i" src="data:image/svg+xml;utf8,${encodeURIComponent(t)}" style="display:block;width:512px;height:${/wordmark/.test(f) ? "auto" : "512px"}"></body>`);
      await p.waitForFunction(() => document.getElementById("i").complete);
      shots[n][f] = (await p.locator("#i").screenshot()).toString("base64");
    }
    // страница: большая иконка секции 1 для 9 состояний и блок «Движение» в финальном кадре (без анимации)
    await p.setViewportSize({ width: 393, height: 852 });
    await p.goto(PAGE);
    for (const d of DIRS) for (const a of APPS) {
      await p.click(`button[data-set="dir"][data-val="${d}"]`);
      await p.click(`button[data-set="appear"][data-val="${a}"]`);
      await p.addStyleTag({ content: "header{position:static!important}" });
      await p.waitForTimeout(60);
      const el = p.locator("main > section").nth(1).locator(".sq").first();
      await el.scrollIntoViewIfNeeded();
      shots[n][`page-${d}-${a}-icon300`] = (await el.screenshot()).toString("base64");
      const w = p.locator("main > section").nth(2).locator(".wallband");
      await w.scrollIntoViewIfNeeded();
      shots[n][`page-${d}-${a}-wallband`] = (await w.screenshot()).toString("base64");
    }
    await browser.close();
  }
  const cb = await chromium.launch();
  const p = await (await cb.newContext()).newPage();
  await p.goto("about:blank");
  for (const k of Object.keys(shots.chromium)) {
    const r = await p.evaluate(async ([a, b, name]) => {
      const load = async (s) => { const i = new Image(); i.src = "data:image/png;base64," + s; await i.decode(); return i; };
      const A = await load(a), B = await load(b);
      const w = Math.min(A.naturalWidth, B.naturalWidth), h = Math.min(A.naturalHeight, B.naturalHeight);
      const px = (im) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.drawImage(im, 0, 0); return g.getImageData(0, 0, w, h).data; };
      const da = px(A), db = px(B);
      let sum = 0, big = 0, mx = 0; const heat = new Uint8ClampedArray(w * h * 4);
      let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
      for (let i = 0; i < w * h; i++) {
        const d = Math.abs(da[i * 4] - db[i * 4]) + Math.abs(da[i * 4 + 1] - db[i * 4 + 1]) + Math.abs(da[i * 4 + 2] - db[i * 4 + 2]);
        sum += d; if (d > 48) { big++; const x = i % w, y = (i / w) | 0; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
        if (d > mx) mx = d;
        const v = Math.min(255, d * 3);
        heat[i * 4] = 255 - v * 0.0; heat[i * 4 + 1] = 255 - v; heat[i * 4 + 2] = 255 - v; heat[i * 4 + 3] = 255;
      }
      // side-by-side: chromium | webkit | diff
      const c = document.createElement("canvas"); c.width = w * 3; c.height = h; const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(A, 0, 0); g.drawImage(B, w, 0);
      const id = new ImageData(heat, w, h); g.putImageData(id, 2 * w, 0);
      return { meanAbs: +(sum / (w * h * 3)).toFixed(3), bigPx: big, bigShare: +(big / (w * h)).toFixed(4), max: mx,
        bbox: big ? [bx0, by0, bx1, by1] : null, png: c.toDataURL("image/png").split(",")[1] };
    }, [shots.chromium[k], shots.webkit[k], k]);
    const { png, ...rest } = r;
    log("xdiff", { name: k, ...rest });
    if (r.bigShare > 0.002 || r.meanAbs > 0.8) writeFileSync(join(OUT, `qa-xdiff-${k}.png`), Buffer.from(png, "base64"));
  }
  await cb.close();
}

if (run("page")) for (const [n, bt] of ENGINES) await checkPage(bt, n);
if (run("svg")) for (const [n, bt] of ENGINES) await checkSvgs(bt, n);
if (run("mask")) for (const [n, bt] of ENGINES) await checkMaskable(bt, n);
if (run("xdiff")) await checkXdiff();
if (run("c29")) for (const [n, bt] of ENGINES) await checkC29(bt, n);
console.log(JSON.stringify(report, null, 1));
