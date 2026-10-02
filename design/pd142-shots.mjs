/**
 * PD-142 — живая проверка шага «проверьте запись ключа» на реальной сборке + кадры в design/pd142-shots/.
 *
 * Среда (изолированный worktree, свой api/web, БД pundoku_keyv):
 *   BASE=http://127.0.0.1:3995 API=http://127.0.0.1:5995 PW_DIR=/tmp/pd16-pw \
 *   PLAYWRIGHT_BROWSERS_PATH=/tmp/pd16-pw/browsers ART=<worktree>/design/pd142-shots \
 *   node design/pd142-shots.mjs [wk|cr|all|rep|red|scroll]   (rep — только замена, red — только Reduce Motion,
 *   scroll — AX3 на 320×568: последний элемент каждого шага достижим выше таб-бара/safe-area)
 *
 * Лимиты api: devices 10/мин на адрес — между контекстами пауза 7 с; выпуск ключа 5/час на устройство (тут ≤ 2).
 * Что проверяется в каждом контексте: фокус в первом поле, шрифт ≥ 16 px, цели ≥ 44, нет горизонтального скролла,
 * ключа нет на экране проверки, неверный ввод → alert + aria-invalid на нужном поле, пропуск → шит с предупреждением.
 * Отдельный сценарий (замена): пока проверка не пройдена — старый ключ на сервере жив, pendingRotation на месте.
 */
import { createRequire } from "node:module";
import { BASE, API, ART, SAFE_PORTRAIT, newContext, overflowReport, shot, api } from "../docs/ios-selfcheck/lib.mjs";
const require = createRequire((process.env.PW_DIR ?? "/tmp/pd16-pw") + "/");
const { webkit, chromium } = require("playwright");

const T = (id) => `[data-testid="${id}"]`;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (ok, name, extra = "") => {
  results.push({ ok: !!ok, name, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
};
const which = process.argv[2] ?? "all";

const LOCALES = { en: "en-US", uk: "uk-UA", ru: "ru-RU" };
const token = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const rq = indexedDB.open("pundoku");
        rq.onsuccess = () => {
          const g = rq.result.transaction("kv").objectStore("kv").get("meta:deviceToken");
          g.onsuccess = () => resolve(g.result ?? null);
          g.onerror = () => resolve(null);
        };
        rq.onerror = () => resolve(null);
      }),
  );
const auth = (t) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });

async function open(browser, o) {
  const ctx = await newContext(browser, { safeArea: SAFE_PORTRAIT, locale: LOCALES[o.locale], ...o.ctx });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/settings`);
  await page.waitForSelector(T("key-create"), { timeout: 25000 });
  await page.locator(T(`lang-${o.locale}`)).tap();
  await page.waitForTimeout(200);
  return { ctx, page };
}
const readKey = async (page) => (await page.locator(`${T("key-shown")} .settings-chip`).allTextContents()).map((s) => s.trim()).join("");
const asked = async (page) => {
  const out = [];
  for (const i of [0, 1]) {
    const id = await page.locator(T(`key-check-${i}`)).getAttribute("id");
    out.push(Number((await page.locator(`label[for="${id}"]`).textContent()).match(/\d+/)[0]) - 1);
  }
  return out;
};
const fillRight = async (page, key) => {
  const [a, b] = await asked(page);
  await page.locator(T("key-check-0")).fill(key.slice(a * 4, a * 4 + 4).toLowerCase());
  await page.locator(T("key-check-1")).fill(key.slice(b * 4, b * 4 + 4));
};
const box = (page, id) => page.locator(T(id)).boundingBox();

async function flow(browser, tag, o, frames) {
  const { ctx, page } = await open(browser, o);
  const name = (f) => `${tag}-${f}`;
  try {
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"));
    const key = await readKey(page);
    check(key.length === 32, `${tag}: ключ показан (32 знака)`);
    if (frames.includes("01")) await shot(page, name("01-key"));
    const written = await page.locator(T("key-saved")).textContent();
    await page.locator(T("key-saved")).tap();
    await page.waitForSelector(T("key-check-0"));
    await page.waitForTimeout(350);
    const focused = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check(focused === "key-check-0", `${tag}: фокус в первом поле после «${written}»`, focused);
    const body = await page.locator("body").innerText();
    check(![...Array(8).keys()].some((i) => body.includes(key.slice(i * 4, i * 4 + 4))), `${tag}: ключа на экране проверки нет`);
    // размеры и атрибуты
    const fs = await page.locator(T("key-check-0")).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const b0 = await box(page, "key-check-0"), b1 = await box(page, "key-check-1");
    const bg = await box(page, "key-check-go"), bb = await box(page, "key-check-back"), bs = await box(page, "key-check-skip");
    check(fs >= 16, `${tag}: шрифт поля ≥ 16 px (iOS-зум)`, `${fs}px`);
    check([b0, b1, bg, bb, bs].every((b) => b.height >= 44 && b.width >= 44), `${tag}: цели ≥ 44`, [b0, b1, bg, bb, bs].map((b) => `${Math.round(b.width)}x${Math.round(b.height)}`).join(" "));
    const attrs = await page.locator(T("key-check-0")).evaluate((el) => ({ ac: el.getAttribute("autocapitalize"), ag: el.getAttribute("autocorrect"), au: el.getAttribute("autocomplete"), sp: el.spellcheck, eh: el.getAttribute("enterkeyhint"), ty: el.type }));
    check(attrs.ac === "characters" && attrs.ag === "off" && attrs.au === "off" && attrs.sp === false && attrs.eh === "next" && attrs.ty === "text", `${tag}: атрибуты ввода`, JSON.stringify(attrs));
    const vp = page.viewportSize();
    const ov = await overflowReport(page);
    check(!ov.hscroll && ov.bad.length === 0, `${tag}: без горизонтального скролла/обрезки (${vp.width}pt)`, ov.bad.length ? JSON.stringify(ov.bad).slice(0, 200) : "");
    if (frames.includes("02")) await shot(page, name("02-check"));
    // «Check» неактивна до заполнения
    check((await page.locator(T("key-check-go")).getAttribute("aria-disabled")) === "true", `${tag}: «Check» неактивна на пустых полях`);
    // неверно: первое поле верное, второе нет
    const [a, b] = await asked(page);
    await page.locator(T("key-check-0")).fill(key.slice(a * 4, a * 4 + 4));
    await page.locator(T("key-check-1")).fill("2222" === key.slice(b * 4, b * 4 + 4) ? "3333" : "2222");
    await page.locator(T("key-check-go")).tap();
    await page.waitForSelector(T("key-error"));
    await page.waitForTimeout(250);
    const alert = await page.locator(T("key-error")).evaluate((el) => ({ role: el.getAttribute("role"), kind: el.dataset.kind, text: el.textContent }));
    const inv = await page.locator("input[data-testid^=key-check-]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-invalid")));
    check(alert.role === "alert" && alert.kind === "mismatch" && inv[0] === null && inv[1] === "true", `${tag}: неверный ввод → alert + aria-invalid только у неверного`, `${alert.text} / ${inv.join()}`);
    if (frames.includes("03")) await shot(page, name("03-mismatch"));
    // пропуск → шит
    await page.locator(T("key-check-skip")).tap();
    await page.waitForSelector(T("action-sheet"));
    await page.waitForTimeout(450);
    const focusedSheet = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check(focusedSheet === "action-sheet-cancel", `${tag}: шит пропуска, фокус на безопасном «Проверить ключ»`, focusedSheet);
    if (o.reduced) {
      // Конвенция продукта: при Reduce Motion шит не едет (--mo = 0, только проявление), длительность короче обычной 300 мс.
      const mo = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--mo").trim());
      const anim = await page.locator(T("action-sheet")).evaluate((el) => getComputedStyle(el).animationDuration);
      check(parseFloat(mo) === 0 && parseFloat(anim) < 0.3, `${tag}: Reduce Motion — шит без смещения (--mo=${mo}), только проявление ${anim}`);
    }
    if (frames.includes("04")) await shot(page, name("04-skip"));
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    check(await page.locator(T("key-check-0")).isVisible(), `${tag}: после «Проверить ключ» шаг проверки на месте`);
    // назад к ключу и снова
    await page.locator(T("key-check-back")).tap();
    await page.waitForSelector(T("key-shown"));
    const back = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
    check(back === "key-shown" && (await readKey(page)) === key, `${tag}: «Показать ключ ещё раз» — тот же ключ, фокус на нём`);
    await page.locator(T("key-saved")).tap();
    await page.waitForSelector(T("key-check-0"));
    await fillRight(page, key); // нижний регистр и целый ключ вставкой во второе поле проверены в юнитах; здесь нижний регистр
    await page.locator(T("key-check-1")).press("Enter");
    await page.waitForSelector(T("key-created"), { timeout: 8000 });
    check(true, `${tag}: верный ввод (нижний регистр) + Enter → «Ключ создан»`);
    return key;
  } finally {
    await ctx.close();
    await pause(7000);
  }
}

async function replaceFlow(browser, tag, o) {
  const { ctx, page } = await open(browser, o);
  try {
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"));
    const K1 = await readKey(page);
    await page.locator(T("key-saved")).tap();
    await page.waitForSelector(T("key-check-0"));
    await fillRight(page, K1);
    await page.locator(T("key-check-go")).tap();
    await page.waitForSelector(T("key-created"));
    const tok = await token(page);
    // замена
    await page.locator(T("key-reissue")).tap();
    await page.waitForSelector(T("action-sheet"));
    await page.waitForTimeout(450);
    await page.locator(T("action-sheet-go")).tap();
    await page.waitForSelector(T("key-shown"));
    const K2 = await readKey(page);
    await page.locator(T("key-saved")).tap();
    await page.waitForSelector(T("key-check-0"));
    const goLabel = await page.locator(T("key-check-go")).textContent();
    // неверный ввод: сервер не тронут
    await page.locator(T("key-check-0")).fill("AAAA");
    await page.locator(T("key-check-1")).fill("BBBB");
    await page.locator(T("key-check-go")).tap();
    await page.waitForSelector(T("key-error"));
    const st1 = await api("/api/recovery", { headers: auth(tok) });
    check(st1.json?.pendingRotation, `${tag}: замена, неверный ввод — на сервере ожидающий ключ, не подтверждён`, `кнопка «${goLabel}»`);
    // старый ключ жив (второе устройство)
    const newDevice = async () => {
      await pause(7000); // devices: 10/мин на адрес
      const d = await api("/api/devices", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      return d;
    };
    const dev = await newDevice();
    const tokB = dev.json?.deviceToken;
    check(tokB, `${tag}: второе устройство зарегистрировано`, `HTTP ${dev.status}`);
    if (tokB) {
      const old = await api("/api/recovery/redeem", { method: "POST", headers: auth(tokB), body: JSON.stringify({ key: K1 }) });
      check(old.status === 200, `${tag}: пока проверка не пройдена, СТАРЫЙ ключ работает (redeem → ${old.status})`);
      const nw = await api("/api/recovery/redeem", { method: "POST", headers: auth((await newDevice()).json?.deviceToken), body: JSON.stringify({ key: K2 }) });
      check(nw.status !== 200, `${tag}: пока проверка не пройдена, НОВЫЙ ключ ещё не работает (redeem → ${nw.status})`);
    }
    await shot(page, `${tag}-05-replace-mismatch`);
    // верный ввод → активация
    await fillRight(page, K2);
    await page.locator(T("key-check-go")).tap();
    await page.waitForSelector(T("key-replaced"), { timeout: 8000 });
    const dev2 = await newDevice();
    const t2 = dev2.json?.deviceToken;
    const old2 = await api("/api/recovery/redeem", { method: "POST", headers: auth(t2), body: JSON.stringify({ key: K1 }) });
    check(old2.status === 400, `${tag}: после проверки старый ключ перестал работать (redeem → ${old2.status})`);
    await shot(page, `${tag}-06-replaced`);
  } finally {
    await ctx.close();
    await pause(7000);
  }
}

/**
 * Доработка по QA: на крупнейшем Dynamic Type (AX3) и узком экране страницу можно прокрутить так, чтобы ПОСЛЕДНИЙ элемент
 * каждого шага (показ ключа, проверка, ошибка, шит пропуска) оказался выше таб-бара и безопасной зоны.
 * Мерим на реальной сборке: scroll-контейнер `.scroll` прокручен до конца → нижняя граница самого нижнего элемента `.settings`
 * не ниже верхней границы `.tabbar`; для шита — нижняя граница последней кнопки не ниже окна минус нижний inset.
 */
const SA_BOT = SAFE_PORTRAIT.bot;
async function bottomProbe(page, tag, step, frame) {
  const m = await page.evaluate(() => {
    const sc = document.querySelector(".scroll");
    const tabTop = document.querySelector(".tabbar").getBoundingClientRect().top;
    const lowest = (root) => {
      let low = 0, lowEl = "";
      for (const el of root.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || el.closest(".sr-only")) continue; // sr-only — для скринридера, глазу не видно
        if (r.bottom > low) { low = r.bottom; lowEl = (el.dataset.testid || el.className || el.tagName).toString().slice(0, 40); }
      }
      return { low, lowEl };
    };
    const keySec = document.querySelector('section[aria-labelledby="settings-h-key"]');
    // 1) выводим НИЖНИЙ элемент шага (раздел ключа) на 8 px выше таб-бара — достижимо ли это прокруткой
    const k0 = lowest(keySec);
    sc.scrollTop += k0.low - (tabTop - 8);
    const k1 = lowest(keySec);
    // 2) конец всей страницы тоже выше таб-бара
    sc.scrollTop = sc.scrollHeight;
    const pageEnd = lowest(document.querySelector(".settings"));
    return { keyLow: k1.low, keyEl: k1.lowEl, tabTop, pageEnd: pageEnd.low, scrollable: sc.scrollHeight > sc.clientHeight + 1 };
  });
  check(m.keyLow <= m.tabTop + 0.5, `${tag}: «${step}» — нижний элемент шага («${m.keyEl}») можно вывести выше таб-бара`,
    `низ ${Math.round(m.keyLow)} ≤ верх таб-бара ${Math.round(m.tabTop)}`);
  check(m.pageEnd <= m.tabTop + 0.5, `${tag}: «${step}» — конец страницы выше таб-бара`, `запас ${Math.round(m.tabTop - m.pageEnd)} px, прокручивается: ${m.scrollable}`);
  if (frame) {
    // кадр: нижний элемент шага у самого таб-бара (последнее, до чего можно довести прокруткой)
    await page.evaluate(() => {
      const sc = document.querySelector(".scroll");
      const tabTop = document.querySelector(".tabbar").getBoundingClientRect().top;
      const keySec = document.querySelector('section[aria-labelledby="settings-h-key"]');
      let low = 0;
      for (const el of keySec.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height && !el.closest(".sr-only") && r.bottom > low) low = r.bottom;
      }
      sc.scrollTop += low - (tabTop - 8);
    });
    await page.waitForTimeout(150);
    await shot(page, `${tag}-${frame}`);
  }
  await page.evaluate(() => { document.querySelector(".scroll").scrollTop = 0; });
}
async function sheetProbe(page, tag, step, frame) {
  await page.waitForTimeout(450);
  const m = await page.evaluate(() => {
    const sh = document.querySelector('[data-testid="action-sheet"]');
    sh.scrollTop = sh.scrollHeight;
    const btns = [...sh.querySelectorAll("button")];
    const last = btns[btns.length - 1].getBoundingClientRect();
    const head = sh.querySelector("h3").getBoundingClientRect();
    return { lastBottom: last.bottom, headTop: head.top, scrollable: sh.scrollHeight > sh.clientHeight + 1, vh: innerHeight };
  });
  await page.waitForTimeout(150);
  check(m.lastBottom <= m.vh - SA_BOT + 0.5, `${tag}: «${step}» — последняя кнопка шита выше нижнего inset`,
    `низ ${Math.round(m.lastBottom)} ≤ ${m.vh - SA_BOT}, прокручивается: ${m.scrollable}`);
  if (frame) await shot(page, `${tag}-${frame}`);
  await page.evaluate(() => { document.querySelector('[data-testid="action-sheet"]').scrollTop = 0; });
  const top = await page.evaluate(() => document.querySelector('[data-testid="action-sheet"] h3').getBoundingClientRect().top);
  check(top >= 0, `${tag}: «${step}» — заголовок шита при прокрутке вверх виден`, `верх ${Math.round(top)}`);
}

async function scrollFlow(browser, tag, o) {
  const { ctx, page } = await open(browser, o);
  try {
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"));
    const key = await readKey(page);
    await bottomProbe(page, tag, "показ ключа", "07-key-bottom");
    await page.locator(T("key-saved")).tap();
    await page.waitForSelector(T("key-check-0"));
    await page.waitForTimeout(350);
    await bottomProbe(page, tag, "проверка", "08-check-bottom");
    const [a, b] = await asked(page);
    await page.locator(T("key-check-0")).fill(key.slice(a * 4, a * 4 + 4));
    await page.locator(T("key-check-1")).fill("2222" === key.slice(b * 4, b * 4 + 4) ? "3333" : "2222");
    await page.locator(T("key-check-go")).tap();
    await page.waitForSelector(T("key-error"));
    await page.waitForTimeout(250);
    await bottomProbe(page, tag, "проверка с ошибкой", "09-mismatch-bottom");
    await page.locator(T("key-check-skip")).tap();
    await page.waitForSelector(T("action-sheet"));
    await sheetProbe(page, tag, "шит пропуска (создание)", "10-skip-sheet");
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    await fillRight(page, key);
    await page.locator(T("key-check-go")).tap();
    await page.waitForSelector(T("key-created"));
    await bottomProbe(page, tag, "ключ создан", null);
    // замена: показ нового ключа, проверка, шит пропуска замены
    await page.locator(T("key-reissue")).tap();
    await page.waitForSelector(T("action-sheet"));
    await sheetProbe(page, tag, "шит замены", null);
    await page.locator(T("action-sheet-go")).tap();
    await page.waitForSelector(T("key-shown"));
    await bottomProbe(page, tag, "показ ключа (замена)", "11-replace-key-bottom");
    await page.locator(T("key-saved")).tap();
    await page.waitForSelector(T("key-check-0"));
    await page.waitForTimeout(350);
    await bottomProbe(page, tag, "проверка (замена)", "12-replace-check-bottom");
    await page.locator(T("key-check-skip")).tap();
    await page.waitForSelector(T("action-sheet"));
    await sheetProbe(page, tag, "шит пропуска (замена)", "13-replace-skip-sheet");
  } finally {
    await ctx.close();
    await pause(7000);
  }
}

const engines = [];
if (which === "scroll") engines.push(["wk", await webkit.launch()]);
if (which === "wk" || which === "all" || which === "rep" || which === "red") engines.push(["wk", await webkit.launch()]);
if (which === "cr" || which === "all") engines.push(["cr", await chromium.launch()]);

for (const [eng, browser] of engines) {
  if (eng === "wk" && which === "scroll") {
    const small = { width: 320, height: 568 };
    for (const locale of ["en", "uk"]) {
      await scrollFlow(browser, `wk-${locale}-light-320x568-AX3`, { locale, ctx: { viewport: small, dynamicType: "AX3" } });
    }
    await scrollFlow(browser, "wk-ru-dark-320x568-AX3", { locale: "ru", ctx: { colorScheme: "dark", viewport: small, dynamicType: "AX3" } });
  } else if (eng === "wk" && which === "rep") {
    for (const locale of ["en", "uk", "ru"]) await replaceFlow(browser, `wk-${locale}-replace`, { locale, ctx: {} });
  } else if (eng === "wk" && which === "red") {
    await flow(browser, "wk-en-light-393-reduce", { locale: "en", reduced: true, ctx: { reducedMotion: "reduce" } }, []);
  } else if (eng === "wk") {
    for (const locale of ["en", "uk", "ru"]) {
      for (const scheme of ["light", "dark"]) {
        await flow(browser, `wk-${locale}-${scheme}-393`, { locale, ctx: { colorScheme: scheme } }, ["01", "02", "03", "04"]);
      }
    }
    for (const locale of ["en", "uk", "ru"]) {
      for (const scheme of ["light", "dark"]) {
        await flow(browser, `wk-${locale}-${scheme}-320`, { locale, ctx: { colorScheme: scheme, viewport: { width: 320, height: 640 } } }, ["02", "03", "04"]);
      }
      await flow(browser, `wk-${locale}-light-430`, { locale, ctx: { viewport: { width: 430, height: 932 } } }, ["02", "03"]);
      await flow(browser, `wk-${locale}-light-393-AX3`, { locale, ctx: { dynamicType: "AX3" } }, ["02", "03", "04"]);
    }
    await flow(browser, "wk-en-light-320-AX3", { locale: "en", ctx: { viewport: { width: 320, height: 640 }, dynamicType: "AX3" } }, ["02", "03"]);
    await flow(browser, "wk-uk-dark-320-AX3", { locale: "uk", ctx: { colorScheme: "dark", viewport: { width: 320, height: 640 }, dynamicType: "AX3" } }, ["02", "03"]);
    await flow(browser, "wk-en-light-393-reduce", { locale: "en", reduced: true, ctx: { reducedMotion: "reduce" } }, []);
    for (const locale of ["en", "uk", "ru"]) await replaceFlow(browser, `wk-${locale}-replace`, { locale, ctx: {} });
  } else {
    for (const scheme of ["light", "dark"]) {
      await flow(browser, `cr-en-${scheme}-390`, { locale: "en", ctx: { colorScheme: scheme, viewport: { width: 390, height: 844 } } }, ["02", "03", "04"]);
    }
    await flow(browser, "cr-uk-light-320", { locale: "uk", ctx: { viewport: { width: 320, height: 640 } } }, ["02", "03"]);
    await flow(browser, "cr-ru-light-430", { locale: "ru", ctx: { viewport: { width: 430, height: 932 } } }, ["02", "03"]);
    await flow(browser, "cr-en-forced-390", { locale: "en", ctx: { forcedColors: "active", viewport: { width: 390, height: 844 } } }, ["02", "03", "04"]);
    await replaceFlow(browser, "cr-en-replace", { locale: "en", ctx: { viewport: { width: 390, height: 844 } } });
  }
  await browser.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} PASS${failed.length ? ", FAIL: " + failed.map((f) => f.name).join(" | ") : ""}`);
process.exit(failed.length ? 1 : 0);
