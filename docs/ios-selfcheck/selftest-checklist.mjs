// Самотест docs/ios-checklist.html в webkit 390x844: темы, чекбокс после перезагрузки, копирование (и запасной путь), нет прокрутки вбок.
// Запуск: node selftest-checklist.mjs   (не нужен ни стенд, ни БД)
import { webkit, ART } from "./lib.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "..", "ios-checklist.html");
const URL_ = pathToFileURL(FILE).href;
mkdirSync(ART, { recursive: true });
let fails = 0;
const ok = (c, m) => { console.log(`  [${c ? "ok  " : "FAIL"}] ${m}`); if (!c) fails++; };

const browser = await webkit.launch();
const mk = async (colorScheme) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, colorScheme });
  const requests = [];
  ctx.on("request", (r) => requests.push(r.url()));
  return { ctx, requests };
};

for (const scheme of ["light", "dark"]) {
  console.log(`== ${scheme} ==`);
  const { ctx, requests } = await mk(scheme);
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.waitForSelector("#item-1");
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color,
    viewport: document.querySelector('meta[name=viewport]').content,
    cards: document.querySelectorAll("article.card").length,
    count: document.getElementById("count").textContent,
    doneOpen: document.getElementById("done-list").open,
  }));
  ok(m.sw <= m.cw, `нет горизонтального скролла (scrollWidth ${m.sw} <= ${m.cw})`);
  ok(/viewport-fit=cover/.test(m.viewport), `viewport: ${m.viewport}`);
  ok(m.cards === 118, `на странице 118 карточек пунктов (${m.cards})`);
  const doneVisible = await page.locator("#done-list article").first().isVisible();
  ok(!m.doneOpen && !doneVisible, "список «проверено командой» свёрнут по умолчанию (виден только заголовок)");
  ok(m.count === "0 из 100", `счётчик «${m.count}»`);
  const dark = scheme === "dark";
  ok(dark ? m.bg === "rgb(0, 0, 0)" : m.bg === "rgb(242, 242, 247)", `фон ${m.bg} (${scheme})`);
  const small = await page.evaluate(() => {
    const out = [];
    for (const e of document.querySelectorAll("body *")) {
      if (e.closest("script,style")) continue;
      const has = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (has && parseFloat(getComputedStyle(e).fontSize) < 16) out.push(e.tagName + ":" + e.textContent.trim().slice(0, 30));
    }
    return out;
  });
  ok(small.length === 0, `весь текст >= 16 px${small.length ? " (мельче: " + small.slice(0, 3).join("; ") + ")" : ""}`);
  const targets = await page.evaluate(() => {
    const bad = [];
    for (const e of document.querySelectorAll("button, summary, label.chk, a")) {
      if (e.offsetParent === null) continue;
      if (e.tagName === "A" && e.closest("p")) continue; // ссылка в тексте абзаца
      const r = e.getBoundingClientRect();
      if (r.height < 44 || (r.width < 44)) bad.push(e.tagName + " " + Math.round(r.width) + "x" + Math.round(r.height));
    }
    return bad;
  });
  ok(targets.length === 0, `цели касания >= 44 пт${targets.length ? " (меньше: " + targets.slice(0, 4).join(", ") + ")" : ""}`);
  const numBox = await page.locator("#item-1 .chk input").boundingBox();
  ok(numBox.width >= 28, `чекбокс ${Math.round(numBox.width)}x${Math.round(numBox.height)} внутри строки >= 44 пт`);
  await page.screenshot({ path: `${ART}/cl-${scheme}-top.png` });

  // чекбокс переживает перезагрузку
  await page.locator("#item-3 .chk").tap();
  await page.locator("#item-3 textarea").fill("Стекло приятное, но слишком светлое");
  await page.locator("#item-5 .chk").tap();
  let c = await page.locator("#count").textContent();
  ok(c === "2 из 100", `после двух отметок счётчик «${c}»`);
  await page.reload();
  await page.waitForSelector("#item-3");
  c = await page.locator("#count").textContent();
  const st = await page.evaluate(() => ({ c3: document.querySelector("#item-3 input").checked, c5: document.querySelector("#item-5 input").checked, c1: document.querySelector("#item-1 input").checked, n3: document.querySelector("#item-3 textarea").value }));
  ok(c === "2 из 100" && st.c3 && st.c5 && !st.c1, `после перезагрузки отметки на месте (3 и 5), счётчик «${c}»`);
  ok(st.n3 === "Стекло приятное, но слишком светлое", "заметка сохранилась");
  // необязательный пункт не меняет счётчик
  await page.locator("#done-list > summary").tap();
  await page.locator("#item-11 .chk").tap();
  c = await page.locator("#count").textContent();
  ok(c === "2 из 100", `отметка необязательного пункта не меняет счётчик («${c}»)`);
  await page.screenshot({ path: `${ART}/cl-${scheme}-done.png` });
  await page.locator("#item-11 .chk").tap();
  await page.locator("#done-list > summary").tap();

  // копирование через clipboard API (подмена, чтобы увидеть текст)
  await page.evaluate(() => { window.__copied = null; Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__copied = t; return Promise.resolve(); } }, configurable: true }); });
  await page.locator("#copy").tap();
  await page.waitForTimeout(300);
  const copied = await page.evaluate(() => window.__copied);
  const msg = await page.locator("#msg").textContent();
  ok(!!copied && /пройдено 2 из 100/.test(copied) && /Не пройдено \(98\)/.test(copied), `clipboard.writeText получил отчёт («${(copied || "").split("\n")[0]}»)`);
  ok(/Заметки к остальным пунктам \(1\)/.test(copied) && /3\. \[Установка и запуск\].*\n\s+Заметка: Стекло/.test(copied), "раздел заметок содержит пункт 3");
  ok(!/\n  3\. /.test(copied.split("Заметки к остальным")[0]), "пункт 3 отмечен - в списке «не пройдено» его нет");
  ok(/Скопировано/.test(msg), `сообщение «${msg}»`);
  await page.screenshot({ path: `${ART}/cl-${scheme}-copied.png` });

  // запасной путь: нет clipboard API
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); });
  await page.locator("#copy").tap();
  await page.waitForTimeout(300);
  const fb = await page.evaluate(() => { const o = document.getElementById("out"); return { shown: document.getElementById("result").classList.contains("show"), sel: o.selectionEnd - o.selectionStart, len: o.value.length, msg: document.getElementById("msg").textContent, focus: document.activeElement === o }; });
  ok(fb.shown && fb.len > 100 && fb.sel === fb.len && fb.focus, `без clipboard API текст показан и выделен целиком (${fb.sel}/${fb.len}); сообщение «${fb.msg}»`);
  await page.screenshot({ path: `${ART}/cl-${scheme}-fallback.png` });

  // clipboard отклонил запись (нет разрешения)
  await page.evaluate(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true }); });
  await page.locator("#copy").tap();
  await page.waitForTimeout(300);
  const fb2 = await page.evaluate(() => { const o = document.getElementById("out"); return { sel: o.selectionEnd - o.selectionStart, len: o.value.length, msg: document.getElementById("msg").textContent }; });
  ok(fb2.sel === fb2.len && fb2.len > 100, `при отказе clipboard текст тоже выделен (${fb2.sel}/${fb2.len}); «${fb2.msg}»`);

  // горизонтальная прокрутка после раскрытия и ввода
  const m2 = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(m2.sw <= m2.cw, `после копирования нет горизонтального скролла (${m2.sw} <= ${m2.cw})`);
  const net = requests.filter((u) => !u.startsWith("file://") && !u.startsWith("about:") && !u.startsWith("data:"));
  ok(net.length === 0, `сетевых запросов нет${net.length ? ": " + net.join(", ") : ""}`);
  await ctx.close();
}

// новые пункты «Н…» (ios-owner-steps.md): метка, слитые номера, отметка и заметка переживают перезагрузку, счётчик верный
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(URL_);
  await page.waitForSelector("#item-u22");
  ok(await page.locator("article.card[id^=item-u]").count() === 48, "48 карточек пунктов «Н…»");
  ok((await page.locator("#item-u22 .num").textContent()) === "Н22" && /включает Н1/.test(await page.locator("#item-u22 .head").textContent()), "Н22 помечен и включает Н1");
  await page.locator("#item-u22 .chk").tap();
  await page.locator("#item-u22 textarea").fill("Шестерёнка ок");
  let c = await page.locator("#count").textContent();
  ok(c === "1 из 100", `после отметки Н22 счётчик «${c}»`);
  await page.reload();
  await page.waitForSelector("#item-u22");
  c = await page.locator("#count").textContent();
  ok(c === "1 из 100" && await page.locator("#item-u22 input").isChecked() && (await page.locator("#item-u22 textarea").inputValue()) === "Шестерёнка ок", "отметка и заметка Н22 сохранились");
  await page.locator("#copy").tap();
  const rep = await page.locator("#out").inputValue();
  ok(/Заметка: Шестерёнка ок/.test(rep) && /\n  Н21\. \[/.test(rep) && !/\n  Н22\. \[/.test(rep.split("Заметки к остальным")[0]), "в отчёте метки «Н» и Н22 уже не в «не пройдено»");
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "нет горизонтального скролла");
  await ctx.close();
}

// узкий экран 320 и крупный шрифт
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(URL_);
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  ok(m.sw <= m.cw, `узкий экран 320 пт: нет горизонтального скролла (${m.sw} <= ${m.cw})`);
  await page.screenshot({ path: `${ART}/cl-narrow.png` });
  await ctx.close();
}
await browser.close();
console.log(fails ? `\nНЕ ПРОШЛО: ${fails}` : "\nвсе проверки самотеста прошли");
process.exit(fails ? 1 : 0);
