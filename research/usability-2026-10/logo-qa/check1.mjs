// PD-153 QA: геометрия (независимая таблица §9.1) + пиксельное сравнение с макетом (build('a') из pd141-logo-round5.html)
// cd /tmp/pundoku-ios/pw && BASE=http://127.0.0.1:3995 node <this>
import { createRequire } from "node:module";
const { webkit, chromium } = createRequire(process.cwd() + "/")("playwright");
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE ?? "http://127.0.0.1:3995";
const MOCK = join(HERE, "../../../design/pd141-logo-round5.html");
const problems = []; const log = (o) => console.log(JSON.stringify(o));
const P = (c, m) => { if (!c) { problems.push(m); console.log("FAIL", m); } };

// §9.1, независимо от кода продукта
const SPEC = [
 ...[[0,96],[27,96],[54,96],[0,123],[54,123],[0,150],[27,150],[54,150],[0,177]],
 ...[[91,123],[145,123],[91,150],[145,150],[91,177],[118,177],[145,177]],
 ...[[182,123],[209,123],[236,123],[182,150],[236,150],[182,177],[236,177]],
].map(([x,y]) => `${x},${y}`).sort();
const DOKU = { d:[273,"M11 162A28 27 0 0 1 67 162A28 27 0 0 1 11 162M67 96V200"], o:[365,"M11 162A28 27 0 0 1 67 162A28 27 0 0 1 11 162"], k:[457,"M11 96V200M58 124L26 168L62 200"], u:[542,"M11 124V167A23 22 0 0 0 57 167M57 124V200"] };

const mockBody = await (async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.goto("file://" + MOCK);
  const r = await pg.evaluate(() => { const o = build("a", {}); return o; });
  await b.close(); return r;
})();
log({ mockW: mockBody.w });
P(mockBody.w === 614, "mock width 614");

for (const [name, T] of [["chromium", chromium], ["webkit", webkit]]) {
  const b = await T.launch();
  for (const dpr of [3, 2, 1]) {
    const ctx = await b.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: dpr });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/#/settings`);
    const card = page.locator('[data-testid="settings-about"]');
    await card.waitFor({ timeout: 20000 }); await card.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
    const info = await page.evaluate(() => {
      const s = document.querySelector("svg.settings-about-word");
      const rects = [...s.querySelectorAll("rect")].map(r => ({ x:+r.getAttribute("x"), y:+r.getAttribute("y"), w:+r.getAttribute("width"), h:+r.getAttribute("height"), rx:+r.getAttribute("rx") }));
      const paths = [...s.querySelectorAll("path")].map(p => ({ t:p.getAttribute("transform"), d:p.getAttribute("d") }));
      const g = s.firstElementChild;
      const bb = s.getBoundingClientRect();
      return { viewBox: s.getAttribute("viewBox"), rects, paths, gT: g.getAttribute("transform"), w: bb.width, h: bb.height, x: bb.x, y: bb.y,
        stroke: [...s.querySelectorAll("g[data-part=doku]")].map(g => [g.getAttribute("stroke-width"), g.getAttribute("stroke-linecap"), g.getAttribute("stroke-linejoin")]) };
    });
    if (dpr === 3) {
      P(info.viewBox === "0 0 614 116", `${name} viewBox ${info.viewBox}`);
      P(info.rects.length === 23, `${name} rect count ${info.rects.length}`);
      P(info.rects.every(r => r.w === 23 && r.h === 23 && r.rx === 4), `${name} rect size/rx`);
      P(JSON.stringify(info.rects.map(r => `${r.x},${r.y}`).sort()) === JSON.stringify(SPEC), `${name} rect coords vs §9.1`);
      P(info.gT === "translate(2 -94)", `${name} group transform ${info.gT}`);
      P(info.paths.length === 4, `${name} path count`);
      for (const [i, k] of ["d","o","k","u"].entries()) { const [x, d] = DOKU[k]; P(info.paths[i].d === d && info.paths[i].t === `translate(${x} 0)`, `${name} doku ${k}`); }
      P(info.stroke[0].join() === "22,butt,round", `${name} stroke attrs ${info.stroke[0]}`);
      P(Math.abs(info.w - 148) < 0.6 && Math.abs(info.h - 28) < 0.01, `${name} box ${info.w}x${info.h}`);
      log({ name, box: [info.w, info.h] });
    }
    // пиксельное сравнение: тот же svg в той же позиции, внутри подменяем содержимое на build('a') макета
    const svg = page.locator("svg.settings-about-word");
    const A = await svg.screenshot();
    await page.evaluate((body) => {
      const st = document.createElement("style");
      st.textContent = ".pun-fill{fill:var(--ink)} .dk-str{fill:none;stroke:var(--doku-color,#43474f)}";
      document.head.appendChild(st);
      const s = document.querySelector("svg.settings-about-word");
      s.removeAttribute("role"); s.removeAttribute("aria-label");
      s.setAttribute("viewBox", "0 0 614 116");
      s.innerHTML = body;
    }, mockBody.body);
    await page.waitForTimeout(200);
    const B = await svg.screenshot();
    const diff = await page.evaluate(async ([a, b]) => {
      const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = (i) => { const k = document.createElement("canvas"); k.width = i.width; k.height = i.height; const x = k.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
      const da = c(ia), db = c(ib); let n = 0, mx = 0;
      for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i]-db[i]), Math.abs(da[i+1]-db[i+1]), Math.abs(da[i+2]-db[i+2])); if (d) n++; if (d > mx) mx = d; }
      return { w: ia.width, h: ia.height, w2: ib.width, diffPx: n, maxDelta: mx };
    }, [A.toString("base64"), B.toString("base64")]);
    log({ name, dpr, ...diff });
    P(diff.diffPx === 0 && diff.w === diff.w2, `${name} dpr${dpr} pixel diff vs mockup: ${diff.diffPx} px, maxDelta ${diff.maxDelta}`);
    if (dpr === 3) writeFileSync(join(HERE, `shots/${name}-wordmark-28-dpr3.png`), A);
    await ctx.close();
  }
  await b.close();
}
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "ALL OK");
