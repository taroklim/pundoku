// PD-156 QA: icon.svg (то, что Chrome берёт для вкладки) растеризованный на 16/20/24/32 px, DPR 1 и 2 (=> 32/40/48/64 device px), светлая/тёмная вкладка
import { createRequire } from "node:module";
const { chromium } = createRequire("/tmp/pundoku-ios/pw/")("playwright");
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../../../apps/web/public/icons/icon.svg", import.meta.url));
const uri = "data:image/svg+xml;base64," + svg.toString("base64");
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 700, height: 220 }, deviceScaleFactor: 1 })).newPage();
let html = "<body style='margin:0;display:flex'>";
for (const bg of ["#fff", "#202124"]) {
  html += `<div style="background:${bg};padding:10px;display:flex;gap:14px;align-items:flex-start">`;
  for (const s of [16, 20, 24, 32]) html += `<img src="${uri}" width="${s}" height="${s}">`;
  html += "</div>";
}
await p.setContent(html);
await p.waitForTimeout(500);
await p.screenshot({ path: "/tmp/iconqa/svg-fav.png", clip: { x: 0, y: 0, width: 360, height: 60 } });
await b.close();
