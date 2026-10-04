// PD-167 живая проверка раскладки режимов C на реальной сборке (vite preview :5493). Запуск: node live.mjs <chromium|webkit>
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
const req = createRequire("/tmp/pd161-pw/");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= "/tmp/pd161-pw/browsers";
const pw = req("playwright");
const BASE = "http://127.0.0.1:5493";
const OUT = "/Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku-worktrees/pd-167/design/pd167-shots";
mkdirSync(OUT, { recursive: true });
const engine = process.argv[2] ?? "chromium";
const pre = engine === "chromium" ? "cr" : "wk";
const LOC = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };
const results = [];
const check = (name, ok, info = "") => { results.push({ name, ok: !!ok, info }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newCtx(browser, { w = 390, h = 844, lang = "en", scheme = "light", ax3 = false, rt = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: engine === "chromium", hasTouch: true, locale: LOC[lang], colorScheme: scheme, reducedMotion: "reduce", serviceWorkers: "block" });
  await ctx.addInitScript((l) => { try { localStorage.setItem("pundoku.locale", l); } catch {} }, lang);
  if (ax3) await ctx.addInitScript(() => { const add = () => { const s = document.createElement("style"); s.textContent = "html{font-size:40px !important}"; document.documentElement.appendChild(s); }; if (document.documentElement) add(); else document.addEventListener("DOMContentLoaded", add); });
  const p = await ctx.newPage();
  if (rt && engine === "chromium") { const s = await ctx.newCDPSession(p); await s.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] }); }
  return { ctx, p };
}
// IDB kv: прочитать/записать мету в обход приложения (на статической странице того же origin — приложение не грузится)
const IDB = async (p, op, entries) => p.evaluate(async ({ op, entries }) => {
  const db = await new Promise((res, rej) => { const r = indexedDB.open("pundoku", 1); r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains("kv")) d.createObjectStore("kv"); if (!d.objectStoreNames.contains("days")) d.createObjectStore("days", { keyPath: "date" }); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = db.transaction("kv", op === "read" ? "readonly" : "readwrite"); const s = tx.objectStore("kv");
  let out = {};
  if (op === "read") { await new Promise((res) => { const c = s.openCursor(); c.onsuccess = () => { const cur = c.result; if (!cur) return res(); if (String(cur.key).startsWith("meta:playGame")) out[cur.key] = cur.value; cur.continue(); }; }); }
  else for (const [k, v] of Object.entries(entries)) { if (v === null) s.delete(k); else s.put(v, k); }
  await new Promise((res) => (tx.oncomplete = res));
  db.close();
  return out;
}, { op, entries });
const tid = (p, id) => p.locator(`[data-testid="${id}"]`);
const gotoHub = async (p) => { await p.goto(BASE + "/#/play"); await tid(p, "hub-modes").waitFor({ timeout: 30000 }); await sleep(400); };
const playTab = (p) => p.locator(".tabbar [role=tab]").nth(1);
const shot = async (p, name) => { await sleep(350); await p.screenshot({ path: `${OUT}/${pre}-${name}.png` }); };
const placeDigit = async (p) => {
  await p.locator(".board button.cell").first().waitFor({ timeout: 30000 });
  const i = await p.evaluate(() => [...document.querySelectorAll(".board button.cell")].findIndex((c) => (c.textContent ?? "").trim() === ""));
  await p.locator(".board button.cell").nth(i).click();
  await p.locator(".pad button.key").nth(4).click();
  await sleep(300);
  return i;
};
const audit = (p) => p.evaluate(() => {
  const small = [];
  for (const b of document.querySelectorAll(".hub-scroll button, [data-testid=mode-sheet] button, [data-testid=ctx-menu] button")) {
    const r = b.getBoundingClientRect(); if (r.width < 2) continue; if (r.height < 43.5) small.push(`${b.dataset.testid || b.className} ${r.width.toFixed(0)}x${r.height.toFixed(0)}`);
  }
  const clipped = [...document.querySelectorAll(".hub-row b, .hub-row .sub, .sh-desc, .sh-warn")].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 2).map((e) => e.textContent.slice(0, 30));
  const title = document.querySelector(".mode-sheet .sh-title span");
  let titleBroken = false;
  if (title) { const c = title.cloneNode(true); c.style.cssText = "position:absolute;white-space:nowrap;visibility:hidden"; title.parentElement.appendChild(c); const need = c.getBoundingClientRect().width; c.remove(); const avail = document.querySelector(".mode-sheet").clientWidth; titleBroken = need < avail - 60 && title.getBoundingClientRect().width < need - 1; }
  if (titleBroken) clipped.push("sheet title broken mid-word");
  return { hOverflow: document.documentElement.scrollWidth > innerWidth + 1, small, clipped, soon: /soon|скоро|незабаром/i.test(document.body.innerText) };
});
const auditCheck = async (p, name) => { const a = await audit(p); check(`${name}: без гориз. переполнения/обрезки, цели ≥44, без «скоро»`, !a.hOverflow && !a.small.length && !a.clipped.length && !a.soon, JSON.stringify(a)); };

const browser = await pw[engine].launch();
try {
  // ---------- A. Сквозной сценарий 390 light en ----------
  {
    const { ctx, p } = await newCtx(browser);
    try {
      await gotoHub(p);
      check("0 незавершённых: строк Classic и Ink — 2, статусов нет, секции «Продолжить» нет",
        (await p.locator(".hub-row.mode").count()) === 2 && (await tid(p, "mode-status-classic").count()) === 0 && (await tid(p, "mode-status-ink").count()) === 0 && (await tid(p, "hub-continue").count()) === 0);
      await auditCheck(p, "hub-none");
      await shot(p, "hub-none-390-light-en");
      await tid(p, "mode-classic").click();
      await tid(p, "mode-sheet").waitFor();
      check("шит Classic: «Start», без предупреждения", (await tid(p, "sheet-start").textContent()) === "Start" && (await tid(p, "discard-note").count()) === 0);
      await auditCheck(p, "sheet-classic");
      await shot(p, "sheet-classic-390-light-en");
      await tid(p, "sheet-cancel").click(); await sleep(300);
      check("Cancel: шит закрыт, хаб", (await tid(p, "mode-sheet").count()) === 0 && (await tid(p, "hub-modes").count()) === 1);
      await tid(p, "mode-classic").click(); await tid(p, "sheet-start").click();
      const ci = await placeDigit(p);
      check("Classic: партия без чипа режима", (await tid(p, "mode-chip").count()) === 0);
      await shot(p, "game-classic-390-light-en");
      const valBefore = await p.locator(".board button.cell").nth(ci).textContent();
      const valBoard = await p.evaluate(() => [...document.querySelectorAll(".board button.cell")].map((c) => (c.textContent ?? "").trim()).join("|"));
      await playTab(p).click(); await tid(p, "hub-modes").waitFor(); await sleep(300);
      const st = await tid(p, "mode-status-classic").textContent().catch(() => null);
      check("1 незавершённая: строка Classic со статусом", !!st && /In progress/.test(st), st ?? "");
      await auditCheck(p, "hub-one");
      await shot(p, "hub-one-390-light-en");
      await tid(p, "mode-classic").click(); await p.locator(".board button.cell").first().waitFor();
      check("тап по строке с игрой — та же доска (продолжение)", (await p.locator(".board button.cell").nth(ci).textContent()) === valBefore && (await tid(p, "mode-sheet").count()) === 0);
      // Ink
      await playTab(p).click(); await tid(p, "hub-modes").waitFor();
      await tid(p, "mode-ink").click(); await tid(p, "mode-sheet").waitFor();
      check("шит Ink: описание из реестра", /Every digit is final/.test(await tid(p, "mode-desc").textContent()));
      await shot(p, "sheet-ink-390-light-en");
      await tid(p, "sheet-start").click();
      if (await tid(p, "ink-rule-start").count().then((n) => n > 0).catch(() => false)) { await shot(p, "ink-rule-390-light-en"); await tid(p, "ink-rule-start").click(); }
      else { await sleep(500); if (await tid(p, "ink-rule-start").count()) { await shot(p, "ink-rule-390-light-en"); await tid(p, "ink-rule-start").click(); } }
      await placeDigit(p);
      check("Ink: чип режима «Ink» в подписи партии", (await tid(p, "mode-chip").getAttribute("data-mode").catch(() => null)) === "ink");
      await shot(p, "game-ink-390-light-en");
      await playTab(p).click(); await tid(p, "hub-modes").waitFor(); await sleep(300);
      check("2 незавершённые: обе строки со статусом", (await tid(p, "mode-status-classic").count()) === 1 && (await tid(p, "mode-status-ink").count()) === 1);
      await auditCheck(p, "hub-two");
      await shot(p, "hub-two-390-light-en");
      // контекстное меню и новая игра при незавершённой
      await tid(p, "mode-classic").click({ button: "right" }); await tid(p, "ctx-menu").waitFor();
      check("контекстное меню: описание, «Continue», «New puzzle…»", (await tid(p, "ctx-continue").count()) === 1 && /New puzzle/.test(await tid(p, "ctx-new").textContent()));
      await shot(p, "ctx-classic-390-light-en");
      await tid(p, "ctx-new").click(); await tid(p, "mode-sheet").waitFor();
      const warn = await tid(p, "discard-note").textContent().catch(() => null);
      check("новая при незавершённой: предупреждение и «Start new»", !!warn && (await tid(p, "sheet-start").textContent()) === "Start new", warn ?? "");
      await auditCheck(p, "sheet-new");
      await shot(p, "sheet-new-390-light-en");
      await tid(p, "sheet-start").click(); await p.locator(".board button.cell").first().waitFor(); await sleep(400);
      const cellsAfter = await p.evaluate(() => [...document.querySelectorAll(".board button.cell")].map((c) => (c.textContent ?? "").trim()).join("|"));
      await playTab(p).click(); await tid(p, "hub-modes").waitFor(); await sleep(300);
      check("после новой Classic Ink-слот цел", (await tid(p, "mode-status-ink").count()) === 1);
      await tid(p, "mode-classic").click(); await p.locator(".board button.cell").first().waitFor(); await sleep(300);
      check("Classic-строка открывает НОВУЮ доску (старая отброшена)", (await p.evaluate(() => [...document.querySelectorAll(".board button.cell")].map((c) => (c.textContent ?? "").trim()).join("|"))) === cellsAfter && cellsAfter !== valBoard);
      await playTab(p).click(); await tid(p, "hub-modes").waitFor(); await sleep(300);
      // долгое нажатие (touch): pointerdown без отпускания
      if (engine === "chromium") {
        const box = await tid(p, "mode-ink").boundingBox();
        await p.mouse.move(box.x + 40, box.y + 20); await p.mouse.down(); await sleep(900); await p.mouse.up(); await sleep(300);
        check("долгое нажатие открывает контекстное меню, тап-хвост не открывает игру", (await tid(p, "ctx-menu").count()) === 1 && (await p.locator(".board").count()) === 0);
        await tid(p, "ctx-scrim").click({ position: { x: 5, y: 5 } }).catch(() => p.keyboard.press("Escape")); await sleep(300);
      }
      // перезагрузка: слоты переживают
      await p.reload(); await tid(p, "hub-modes").waitFor(); await sleep(500);
      check("перезагрузка: хаб, Ink-слот на месте", (await tid(p, "mode-status-ink").count()) === 1 && (await p.locator(".board").count()) === 0);
      const kv = await IDB(p, "read");
      check("IDB: слоты meta:playGame:<режим>, старого meta:playGame нет", "meta:playGame:ink" in kv && kv["meta:playGame"] == null, Object.keys(kv).join(","));
      writeFileSync(`/tmp/pd167-live/kv-${engine}.json`, JSON.stringify(kv));
      // Сетка дня → «Продолжить»
      await p.goto(BASE + "/#/today"); await p.locator(".board button.cell").first().waitFor({ timeout: 40000 }); await sleep(600);
      await placeDigit(p);
      await playTab(p).click(); await tid(p, "hub-modes").waitFor(); await sleep(400);
      check("незавершённая сетка дня — секция «Продолжить» с одной строкой дня", (await tid(p, "continue-day").count()) === 1 && (await tid(p, "hub-continue").locator("button").count()) === 1);
      await shot(p, "hub-day-390-light-en");
      await tid(p, "continue-day").click(); await sleep(500);
      check("тап «Продолжить» — вкладка Today", /#\/today/.test(p.url()) || (await p.locator(".tabbar [role=tab]").nth(0).getAttribute("aria-selected")) === "true");
    } finally { await ctx.close(); }
  }
  // ---------- B. Миграция со старой записи (до PD-167: один слот meta:playGame без поля mode) ----------
  const kv = JSON.parse((await import("node:fs")).readFileSync(`/tmp/pd167-live/kv-${engine}.json`, "utf8"));
  {
    const { ctx, p } = await newCtx(browser);
    try {
      await p.goto(BASE + "/manifest.webmanifest");
      const legacy = { ...kv["meta:playGame:ink"] }; delete legacy.mode;
      await IDB(p, "write", { "meta:playGame": legacy });
      await gotoHub(p); await sleep(600);
      const st = await tid(p, "mode-status-ink").textContent().catch(() => null);
      check("миграция: старая чернильная запись → строка Ink со статусом", !!st && (await tid(p, "mode-status-classic").count()) === 0, st ?? "");
      await shot(p, "hub-migrated-390-light-en");
      const after = await IDB(p, "read");
      check("миграция: meta:playGame удалён, meta:playGame:ink записан с mode=ink", after["meta:playGame"] == null && after["meta:playGame:ink"]?.mode === "ink", Object.keys(after).join(","));
      await tid(p, "mode-ink").click(); await p.locator(".board button.cell").first().waitFor();
      check("миграция: партия открывается без потерь (ходы на месте)", JSON.stringify((await IDB(p, "read"))["meta:playGame:ink"].play.values) === JSON.stringify(legacy.play.values));
    } finally { await ctx.close(); }
  }
  // ---------- C. Матрица кадров (слоты из сценария A засеяны в IDB) ----------
  const both = { "meta:playGame:ink": kv["meta:playGame:ink"], "meta:playGame:classic": { ...kv["meta:playGame:ink"], mode: "classic", play: { ...kv["meta:playGame:ink"].play, ink: false } } };
  const matrix = [
    { w: 320, h: 568, lang: "en", scheme: "light" }, { w: 320, h: 693, lang: "uk", scheme: "dark" },
    { w: 390, h: 844, lang: "en", scheme: "dark" }, { w: 390, h: 844, lang: "uk", scheme: "light" }, { w: 390, h: 844, lang: "ru", scheme: "light" },
    { w: 430, h: 932, lang: "ru", scheme: "dark" }, { w: 430, h: 932, lang: "en", scheme: "light" },
    { w: 390, h: 844, lang: "uk", scheme: "light", ax3: true }, { w: 320, h: 693, lang: "ru", scheme: "light", ax3: true }, { w: 390, h: 844, lang: "en", scheme: "dark", ax3: true },
    { w: 390, h: 844, lang: "en", scheme: "dark", rt: true }, { w: 390, h: 844, lang: "ru", scheme: "light", rt: true },
  ];
  for (const m of matrix) {
    if (m.rt && engine !== "chromium") continue;
    const tag = `${m.w}-${m.scheme}-${m.lang}${m.ax3 ? "-ax3" : ""}${m.rt ? "-rt" : ""}`;
    const { ctx, p } = await newCtx(browser, m);
    try {
      await p.goto(BASE + "/manifest.webmanifest");
      await IDB(p, "write", both);
      await gotoHub(p);
      if (m.ax3) check(`${tag}: data-type=ax3`, (await p.evaluate(() => document.documentElement.getAttribute("data-type"))) === "ax3");
      check(`${tag}: обе строки со статусом`, (await tid(p, "mode-status-classic").count()) === 1 && (await tid(p, "mode-status-ink").count()) === 1);
      await auditCheck(p, `hub ${tag}`);
      await shot(p, `hub-two-${tag}`);
      if (m.ax3 || m.w === 320) { await p.evaluate(() => { const s = document.querySelector(".hub-scroll"); s.scrollTop = s.scrollHeight; }); await shot(p, `hub-two-${tag}-bottom`); }
      await tid(p, "mode-ink").click({ button: "right" }); await tid(p, "ctx-menu").waitFor();
      await auditCheck(p, `ctx ${tag}`);
      await shot(p, `ctx-ink-${tag}`);
      await tid(p, "ctx-new").click(); await tid(p, "mode-sheet").waitFor();
      check(`${tag}: шит новой игры с предупреждением`, (await tid(p, "discard-note").count()) === 1);
      await auditCheck(p, `sheet ${tag}`);
      await shot(p, `sheet-new-ink-${tag}`);
      await tid(p, "sheet-cancel").click(); await sleep(300);
      await tid(p, "mode-ink").click(); await p.locator(".board button.cell").first().waitFor(); await sleep(500);
      check(`${tag}: партия Ink — чип режима`, (await tid(p, "mode-chip").count()) === 1);
      const board = await p.locator(".board").boundingBox();
      check(`${tag}: поле партии ≥ 150 px`, board && board.width >= 150, String(board?.width));
      await shot(p, `game-ink-${tag}`);
    } finally { await ctx.close(); }
  }
} finally {
  await browser.close();
  writeFileSync(`/tmp/pd167-live/results-${engine}.json`, JSON.stringify(results, null, 1));
  const f = results.filter((r) => !r.ok);
  console.log(`\n${engine}: ${results.length - f.length}/${results.length} PASS`);
}
