// PD-155 — таблица читаемости P4 по размерам 29/32/60/87/180 px (1:1, DPR 1) + замеры. Порты не занимает.
//
//   cd /tmp/pundoku-ios/pw && node <repo>/design/pd155-size-table.mjs
//
// Пишет design/pd155-impl-shots/size-table.png (+ size-table-zoom.png: те же растры ×4, nearest) и печатает JSON-замеры.
import { createRequire } from "node:module";
const { chromium } = createRequire(process.cwd() + "/")("playwright");
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd155-impl-shots");
mkdirSync(OUT, { recursive: true });
const asset = (n) => readFileSync(join(DIR, "pd155-assets", n), "utf8");
const uri = (svg) => "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const SIZES = [29, 32, 60, 87, 180];

// Варианты подачи: [id, подпись, svg, фон под иконкой, маска]
const bw = (svg) => svg.replace(/<linearGradient[\s\S]*?<\/linearGradient>/, "").replace(/fill="url\(#[^)]+\)"/, 'fill="#000"').replace(/fill="#E3E3E4"/g, 'fill="#fff"');
const VARIANTS = [
  ["light", "light", asset("p4-icon-light.svg"), "#fff", "none"],
  ["dark", "dark", asset("p4-icon-dark.svg"), "#000", "none"],
  ["tinted", "tinted (gray)", asset("p4-icon-tinted.svg"), "#000", "none"],
  ["bw", "b/w", bw(asset("p4-icon-light.svg")), "#fff", "none"],
  ["squircle", "iOS mask", asset("p4-icon-light.svg"), "#fff", "squircle"],
  ["maskable", "maskable circle", asset("p4-icon-light.svg"), "#fff", "circle"],
  ["forced", "forced-colors", asset("p4-mark.svg").replace(/currentColor/g, "CanvasText"), "Canvas", "none"],
  ["mark-ink", "Mark ink #3B48B0", asset("p4-mark.svg").replace(/currentColor/g, "#3B48B0"), "#fff", "none"],
];
const MASK = { none: "0", squircle: "22.37%", circle: "50%" };

const browser = await chromium.launch();
const shots = {}; // `${id}-${size}` -> Buffer
const meas = [];
try {
  for (const [id, , svg, bg, mask] of VARIANTS) {
    for (const s of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: s, height: s }, deviceScaleFactor: 1, forcedColors: id === "forced" ? "active" : "none", colorScheme: "light" });
      const p = await ctx.newPage();
      // maskable: безопасная зона — круг r = 40 % канвы; иконка целиком под маской-кругом
      await p.setContent(`<!doctype html><style>html,body{margin:0;background:${bg}}.w{width:${s}px;height:${s}px;border-radius:${MASK[mask]};overflow:hidden}img{display:block;width:${s}px;height:${s}px}</style><div class="w"><img id="i" src="${uri(svg)}"></div>`);
      await p.waitForFunction(() => document.getElementById("i").complete && document.getElementById("i").naturalWidth > 0);
      shots[`${id}-${s}`] = await p.screenshot({ clip: { x: 0, y: 0, width: s, height: s } });
      await ctx.close();
    }
  }
  // Замеры по растру: яркость центра контрформы (колонка 1, строка 1) vs центра соседней клетки (колонка 0, строка 1) и пиксели зазора.
  const m = await browser.newContext({ deviceScaleFactor: 1 });
  const mp = await m.newPage();
  await mp.setContent("<canvas id=c></canvas>");
  for (const id of ["light", "dark", "tinted", "bw"]) {
    for (const s of SIZES) {
      const r = await mp.evaluate(async ([b64, s]) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.getElementById("c"); c.width = s; c.height = s;
        const x = c.getContext("2d"); x.drawImage(img, 0, 0);
        const lum = (px, py) => { const d = x.getImageData(Math.min(s - 1, Math.max(0, Math.round(px))), Math.min(s - 1, Math.max(0, Math.round(py))), 1, 1).data;
          const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(d[0]) + 0.7152 * f(d[1]) + 0.0722 * f(d[2]); };
        const k = s / 1024, cx = (c0) => (272 + 167 * c0 + 73) * k, cy = (r0) => (189 + 167 * r0 + 73) * k;
        const counter = lum(cx(1), cy(1)), cell = lum(cx(0), cy(1)), cell2 = lum(cx(1), cy(0));
        const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        // зазор между клетками (0,0) и (1,0): наименее яркий пиксель в полосе зазора по центру высоты клетки
        const gx0 = (272 + 146 * 1 + 167 * 0) * k, gx1 = (272 + 167) * k, gy = cy(0);
        let gmin = 1; for (let px = Math.floor(gx0); px <= Math.ceil(gx1); px++) gmin = Math.min(gmin, lum(px, gy));
        return { counter, cell, ratioCounterCell: ratio(counter, cell), ratioCounterCell2: ratio(counter, cell2), gapMinLum: gmin, ratioGapCell: ratio(gmin, cell) };
      }, [shots[`${id}-${s}`].toString("base64"), s]);
      meas.push({ variant: id, px: s, cellPx: +(146 * s / 1024).toFixed(2), gapPx: +(21 * s / 1024).toFixed(2), ratioCounterCell: +r.ratioCounterCell.toFixed(2), ratioGapCell: +r.ratioGapCell.toFixed(2) });
    }
  }
  await m.close();

  // Сборка листа
  const head = VARIANTS.map(([, label]) => `<th>${label}</th>`).join("");
  const rows = (zoom) => SIZES.map((s) => `<tr><th>${s} px</th>${VARIANTS.map(([id, , , bg]) => `<td style="background:${id === "forced" ? "Canvas" : bg === "#fff" ? "#f2f2f2" : "#222"}"><img src="data:image/png;base64,${shots[`${id}-${s}`].toString("base64")}" style="width:${s * zoom}px;height:${s * zoom}px;image-rendering:${zoom > 1 ? "pixelated" : "auto"}"></td>`).join("")}</tr>`).join("");
  const page = (zoom) => `<!doctype html><meta charset=utf-8><style>body{margin:12px;font:12px system-ui;background:#fff;color:#000}table{border-collapse:collapse}th,td{padding:6px 8px;border:1px solid #ccc;text-align:center;vertical-align:middle}img{display:block;margin:auto}</style><h3 style="margin:0 0 8px">Pundoku P4 «Девять клеток» — ${zoom === 1 ? "1:1 (DPR 1)" : "x" + zoom + " nearest"} — PD-155</h3><table><tr><th></th>${head}</tr>${rows(zoom)}</table>`;
  for (const [zoom, name] of [[1, "size-table.png"], [4, "size-table-zoom.png"]]) {
    const ctx = await browser.newContext({ viewport: { width: zoom === 1 ? 1100 : 3700, height: 400 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    await p.setContent(page(zoom));
    await p.screenshot({ path: join(OUT, name), fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "size-measurements.json"), JSON.stringify(meas, null, 1));
for (const r of meas) console.log(JSON.stringify(r));
