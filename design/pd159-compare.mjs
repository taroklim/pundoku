import { createRequire } from "node:module"; import { readdirSync, readFileSync } from "node:fs";
const pw = createRequire("/tmp/pundoku-ios/pw/")("playwright");
// PD-159: попиксельное сравнение before/ after (node design/pd159-compare.mjs design/pd159-shots [префикс]); шум — тикающие часы и иконка лампочки.
const dir = process.argv[2]; const files = readdirSync(`${dir}/before`).filter((f) => f.startsWith(process.argv[3] ?? "portrait-") && f.endsWith(".png"));
const b = await pw.chromium.launch(); const p = await b.newPage(); p.on("console", (m) => console.log("px", m.text()));
const out = [];
for (const f of files) {
  const A = readFileSync(`${dir}/before/${f}`).toString("base64"), B = readFileSync(`${dir}/after/${f}`).toString("base64");
  const r = await p.evaluate(async ([a, c]) => { const load = (s) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a), load(c)]); if (ia.width !== ib.width || ia.height !== ib.height) return { size: true };
    const cv = (i) => { const c2 = new OffscreenCanvas(i.width, i.height); const x = c2.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
    const da = cv(ia), db = cv(ib); let n = 0; for (let k = 0; k < da.length; k += 4) if (da[k] !== db[k] || da[k + 1] !== db[k + 1] || da[k + 2] !== db[k + 2]) { n++; if (n < 4) console.log((k/4) % ia.width, Math.floor(k/4/ia.width)); } return { diff: n, total: da.length / 4 }; }, [A, B]);
  out.push([f, r.diff ?? "size"]);
}
await b.close();
for (const [f, d] of out) console.log(d === 0 ? "SAME" : "DIFF", d, f);
