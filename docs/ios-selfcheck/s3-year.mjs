// Пункты 23-33: Year, шит месяца/дня, архив прошлых дней.
// «Пользователь с историей» собирается честным прохождением: часы страницы отодвигаются на 3 дня назад, решается день,
// затем часы идут вперёд, следующий день начинается и не дорешивается; IndexedDB выгружается в storageState.
import { BASE, SAFE_PORTRAIT, newContext, shot, api, fillCorrect, solutionOf, place, readGrid, givensOnly, overflowReport, ART } from "./lib.mjs";
import { deviceToken, waitServer, setVisibility } from "./s2-play.mjs";

const SOLVED = /"status":\s*"solved"/;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = (n, h = 12) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, h, 0, 0);
};

/** Возвращает { state, d3, d2, d1, partial: {cell,digit}[] }. */
export async function buildHistory(browser) {
  const ctx = await newContext(browser, { extra: { serviceWorkers: "block" } });
  const page = await ctx.newPage();
  await page.clock.install({ time: daysAgo(3) });
  await page.goto(BASE + "/");
  await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
  await page.waitForTimeout(1500);
  await fillCorrect(page);
  await page.waitForSelector("[data-testid=grid-inf-section]", { timeout: 6000 });
  await page.waitForTimeout(1500);
  const token = await deviceToken(page);
  await waitServer(token, SOLVED);
  // следующий день: начать и не дорешивать
  await setVisibility(page, "hidden");
  await page.clock.setSystemTime(daysAgo(2));
  await setVisibility(page, "visible");
  await page.waitForFunction(() => /./.test(document.querySelector(".subline")?.textContent ?? "") && !document.querySelector("[data-testid=grid-inf-section]"), null, { timeout: 15000 });
  await page.waitForSelector(".board .cell .d.given");
  await page.waitForTimeout(1500);
  const { puzzle, solution } = await solutionOf(page);
  const empties = [...puzzle].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0).slice(0, 6);
  const partial = [];
  for (const i of empties) {
    await place(page, i, Number(solution[i]));
    partial.push({ cell: i, digit: Number(solution[i]) });
  }
  await page.waitForTimeout(3000); // debounce записи на сервер
  const state = await ctx.storageState({ indexedDB: true });
  const h = { state, token, d3: iso(daysAgo(3)), d2: iso(daysAgo(2)), d1: iso(daysAgo(1)), partial, d2given: await givensOnly(page) };
  await ctx.close();
  return h;
}

/** Year загружает записи асинхронно: ждём не просто экран, а месяц с данными. */
async function yearReady(page) {
  await page.waitForSelector("[data-testid=year-screen] .title", { timeout: 20000 });
  try {
    await page.waitForSelector('.year-month i.is-solved', { timeout: 20000 });
  } catch (e) {
    const dump = await page.evaluate(() => ({ hash: location.hash, totals: document.querySelector(".year-totals")?.textContent, months: [...document.querySelectorAll(".year-month")].map((m) => m.getAttribute("aria-label")).filter((x) => !/nothing/.test(x)) }));
    await page.screenshot({ path: `${ART}/yearready-fail.png` });
    throw new Error("Year не показал записи за 20 с: " + JSON.stringify(dump));
  }
  await page.waitForTimeout(300);
}

async function openYearDay(page, date) {
  await page.evaluate(() => (location.hash = "#/year"));
  await yearReady(page);
  await page.locator(`.year-month:has(i[data-date="${date}"])`).tap();
  await page.waitForSelector("[data-testid=year-sheet]");
  await page.locator(`.ycell[data-date="${date}"]`).tap();
  await page.waitForSelector("[data-testid=day-card]");
}

export async function run(R, browser) {
  const H = await buildHistory(browser);
  R.add("hist", true, `история собрана: решён ${H.d3}, начат ${H.d2} (поставлено ${H.partial.length} цифр), ${H.d1} пропущен`);
  const hist = (o = {}) => newContext(browser, { storageState: H.state, ...o });

  // ---------- 23-24. Year: safe-area, прозрачность/контраст, подписи, шит, Dynamic Type ----------
  {
    const ctx = await hist({ safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await page.goto(BASE + "/#/year");
    await yearReady(page);
    const g = await page.evaluate(() => {
      const title = document.querySelector(".year .title").getBoundingClientRect();
      const bar = document.querySelector(".tabbar").getBoundingClientRect();
      const scroll = document.querySelector(".scroll");
      scroll.scrollTop = scroll.scrollHeight;
      const leg = document.querySelector(".year-legend")?.getBoundingClientRect();
      const months = [...document.querySelectorAll(".year-month")].map((m) => m.getAttribute("aria-label"));
      return { titleTop: title.top, barTop: bar.top, legBottom: leg?.bottom, months, hscroll: document.documentElement.scrollWidth > innerWidth };
    });
    R.add(23, g.titleTop >= SAFE_PORTRAIT.top && !g.hscroll, `Year с подставленными safe-area (59 сверху, 34 снизу): заголовок на ${g.titleTop.toFixed(0)}pt (ниже выреза), горизонтальной прокрутки нет`);
    R.add(23, g.legBottom <= g.barTop + 0.5, `легенда в конце прокрутки заканчивается на ${g.legBottom?.toFixed(0)}pt, таб-бар начинается на ${g.barTop.toFixed(0)}pt — под бар не уходит`);
    const sep = g.months.find((m) => /Sep/.test(m ?? ""));
    R.add(23, g.months.length === 12 && !!sep && /\d+ of \d+/.test(sep), `подписи месяцев словами (для VoiceOver): "${sep}"`);
    await shot(page, "i23-year-safearea");
    // тап по месяцу -> шит; тап по дню -> карточка; подписи дней словами
    await page.locator(`.year-month:has(i[data-date="${H.d3}"])`).tap();
    await page.waitForSelector("[data-testid=year-sheet]");
    const cells = await page.evaluate((d) => {
      const c = document.querySelector(`.ycell[data-date="${d}"]`);
      const r = c.getBoundingClientRect();
      return { label: c.getAttribute("aria-label"), w: r.width, h: r.height, dialog: document.querySelector("[data-testid=year-sheet]").getAttribute("role"), root: document.getElementById("root")?.hasAttribute("inert") };
    }, H.d3);
    R.add(23, cells.dialog === "dialog" && cells.root, `шит месяца — диалог, фон inert (VoiceOver не уходит за шит); подпись дня "${cells.label}"; ячейка дня ${cells.w.toFixed(0)}x${cells.h.toFixed(0)}pt`);
    await shot(page, "i23-month-sheet");
    await page.locator(`.ycell[data-date="${H.d3}"]`).tap();
    await page.waitForSelector("[data-testid=day-card]");
    const card = await page.evaluate(() => ({ kind: document.querySelector("[data-testid=day-card]").getAttribute("data-kind"), text: document.querySelector("[data-testid=day-card]").innerText.replace(/\n+/g, " | ") }));
    R.add(23, card.kind === "solved", `тап по дню открывает карточку решённого дня: ${card.text}`);
    await ctx.close();
  }
  {
    const ctx = await hist({ reducedTransparency: true, contrast: "more" });
    const page = await ctx.newPage();
    await page.goto(BASE + "/#/year");
    await yearReady(page);
    const g = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".tabbar"));
      return { bg: cs.backgroundColor, bf: cs.backdropFilter || cs.webkitBackdropFilter, more: matchMedia("(prefers-contrast: more)").matches };
    });
    R.add(23, /^rgb\(/.test(g.bg) && !/blur/.test(g.bf ?? "") && g.more, `Year при «уменьшить прозрачность» (подмена медиа-запроса) и «увеличить контраст»: таб-бар непрозрачный ${g.bg}, blur=${g.bf}, prefers-contrast=${g.more}`);
    await ctx.close();
  }
  for (const [dt, vp] of [["L", { width: 393, height: 852 }], ["xxxL", { width: 393, height: 852 }], ["AX3", { width: 393, height: 852 }], ["AX5", { width: 393, height: 852 }]]) {
    const ctx = await hist({ dynamicType: dt, viewport: vp, safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await page.goto(BASE + "/#/year");
    await yearReady(page);
    const g = await page.evaluate(() => {
      const ml = document.querySelector(".mlab");
      const scroll = document.querySelector(".scroll");
      scroll.scrollTop = scroll.scrollHeight;
      const leg = document.querySelector(".year-legend");
      const bar = document.querySelector(".tabbar").getBoundingClientRect();
      const items = [...leg.querySelectorAll("li")].map((li) => ({ t: li.textContent, clip: li.scrollWidth > li.clientWidth + 1 }));
      return { mlabPx: parseFloat(getComputedStyle(ml).fontSize), title: parseFloat(getComputedStyle(document.querySelector(".year .title")).fontSize), legBottom: leg.getBoundingClientRect().bottom, barTop: bar.top, items, hscroll: document.documentElement.scrollWidth > innerWidth + 0.5 };
    });
    const ov = await overflowReport(page);
    R.add(24, g.legBottom <= g.barTop + 0.5 && !g.hscroll && ov.bad.filter((b) => b.kind === "out-of-viewport").length === 0 && g.items.every((i) => !i.clip), `текст ${dt}: подпись месяца ${g.mlabPx.toFixed(1)}px, заголовок ${g.title.toFixed(1)}px, легенда ${g.legBottom.toFixed(0)}<=${g.barTop.toFixed(0)} (над таб-баром), прокрутки вбок нет${ov.bad.length ? ", замечания: " + JSON.stringify(ov.bad.slice(0, 3)) : ""}`);
    if (dt === "AX3" || dt === "xxxL") await shot(page, `i24-year-${dt}`);
    await ctx.close();
  }

  // ---------- 26. архив: пропущенный день -> играть -> решить -> в Year остаётся пропуском ----------
  {
    const ctx = await hist({ safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(1500);
    await openYearDay(page, H.d1);
    const pre = await page.evaluate(() => ({ kind: document.querySelector("[data-testid=day-card]").dataset.kind, btn: document.querySelector("[data-testid=play-day]")?.textContent }));
    R.add(26, pre.kind === "missed" && !!pre.btn, `Year: прошлый непройденный день ${H.d1} — карточка «${pre.kind}», кнопка «${pre.btn}»`);
    await page.locator("[data-testid=play-day]").tap();
    await page.waitForSelector("[data-testid=archive-screen] .board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(500);
    const g1 = await page.evaluate(() => ({ title: document.querySelector("[data-testid=archive-screen] .title").textContent, sub: document.querySelector("[data-testid=archive-screen] .subline").textContent, hash: location.hash }));
    R.add(26, g1.hash === `#/day/${H.d1}` && /\d/.test(g1.sub), `сетка архивного дня открылась (${g1.hash}), заголовок «${g1.title}», подпись «${g1.sub}»`);
    await fillCorrect(page);
    await page.waitForSelector("[data-testid=archive-screen] .card, [data-testid=archive-screen] [data-testid=late-note]", { timeout: 8000 }).catch(() => {});
    const card = await page.evaluate(() => ({ late: document.querySelector("[data-testid=late-note]")?.textContent, grid: !!document.querySelector("[data-testid=grid-inf-section]"), text: document.querySelector("[data-testid=archive-screen]").innerText.replace(/\n+/g, " | ").slice(0, 200) }));
    R.add(26, !!card.late && !card.grid, `после решения — карточка дня с пометкой «${card.late}», без улёта в Grid ∞`);
    await shot(page, "i26-archive-solved");
    R.add(29, !!card.late, `карточка архивного дня содержит текст «${card.late}» (проверен текст; озвучку VoiceOver — только на iPhone)`);
    await page.locator("[data-testid=archive-back]").tap();
    await page.waitForSelector("[data-testid=day-card]");
    const back = await page.evaluate(() => ({ kind: document.querySelector("[data-testid=day-card]").dataset.kind, late: document.querySelector("[data-testid=day-card]").dataset.late, hash: location.hash }));
    await page.locator(".ysheet .done").tap();
    await page.waitForTimeout(500);
    const mark = await page.evaluate((d) => document.querySelector(`.year-month i[data-date="${d}"]`)?.className, H.d1);
    R.add(26, back.late === "true" && /is-missed/.test(mark ?? ""), `«‹ Year» вернул в карточку дня (${back.hash}), data-late=${back.late}; отметка дня в Year "${mark}" — осталась пропуском (is-missed), не «решён»`);
    await ctx.close();
  }

  // ---------- 27, 28. начатый архивный день и кнопка «‹ Year» ----------
  {
    const ctx = await hist({ safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(1500);
    await openYearDay(page, H.d2);
    const info = await page.evaluate(() => ({ kind: document.querySelector("[data-testid=day-card]").dataset.kind, note: document.querySelector("[data-testid=unfinished-note]")?.textContent, btn: document.querySelector("[data-testid=finish-day]")?.textContent }));
    R.add(27, info.kind === "unfinished" && !!info.btn, `Year: начатый ${H.d2} — «${info.kind}», «${info.note}», кнопка «${info.btn}»`);
    await page.locator("[data-testid=finish-day]").tap();
    await page.waitForSelector("[data-testid=archive-screen] .board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(700);
    const grid = await readGrid(page);
    const same = H.partial.every((p) => grid[p.cell] === String(p.digit));
    R.add(27, same, `«Finish this puzzle» продолжает с того же места: ${H.partial.length} из ${H.partial.length} ранее поставленных цифр на местах`);
    // дополнительная цифра, выйти, вернуться
    const { puzzle, solution } = await solutionOf(page);
    const extra = [...puzzle].findIndex((c, i) => c === "0" && grid[i] === "0");
    await place(page, extra, Number(solution[extra]));
    await page.waitForTimeout(500);
    const b = await page.evaluate(() => {
      const r = document.querySelector("[data-testid=archive-back]").getBoundingClientRect();
      return { l: r.left, t: r.top, w: r.width, h: r.height, vw: innerWidth };
    });
    R.add(28, b.t >= SAFE_PORTRAIT.top && b.h >= 32 && b.l >= 0, `«‹ Year» (safe-area подставлена): левый верхний угол (${b.l.toFixed(0)}, ${b.t.toFixed(0)})pt, ${b.w.toFixed(0)}x${b.h.toFixed(0)}pt — ниже выреза (59pt) и не вылезает за край; удобство большим пальцем — только на iPhone`);
    await shot(page, "i28-archive-back", { clip: { x: 0, y: 0, width: 393, height: 200 } });
    await page.locator("[data-testid=archive-back]").tap();
    await page.waitForSelector("[data-testid=day-card]");
    await page.locator("[data-testid=finish-day]").tap();
    await page.waitForSelector("[data-testid=archive-screen] .board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(700);
    const grid2 = await readGrid(page);
    R.add(27, same && grid2[extra] === solution[extra] && H.partial.every((p) => grid2[p.cell] === String(p.digit)), `вышел и вернулся ещё раз: старые цифры и добавленная (клетка ${extra}) сохранены`);
    await ctx.close();
  }

  // ---------- 30, 32. архив: темы, крупный текст, reduced motion, контраст; uk/ru ----------
  for (const o of [
    { name: "тёмная", colorScheme: "dark" },
    { name: "светлая, текст AX3", dynamicType: "AX3" },
    { name: "reduce motion", reducedMotion: "reduce" },
    { name: "увеличенный контраст", contrast: "more" },
    { name: "forced colors", forcedColors: "active" },
    { name: "uk, 320pt", locale: "uk-UA", viewport: { width: 320, height: 568 } },
    { name: "ru, 320pt", locale: "ru-RU", viewport: { width: 320, height: 568 } },
    { name: "uk, текст AX3", locale: "uk-UA", dynamicType: "AX3" },
    { name: "ru, текст AX3", locale: "ru-RU", dynamicType: "AX3" },
  ]) {
    const { name, ...opts } = o;
    await new Promise((r) => setTimeout(r, 4000)); // локальный API ограничивает 60 запросов/мин на адрес
    const ctx = await hist({ safeArea: SAFE_PORTRAIT, ...opts });
    const page = await ctx.newPage();
    let r429 = 0;
    page.on("response", (r) => { if (r.status() === 429) r429++; });
    await page.goto(BASE + `/#/day/${H.d1}`);
    const shown = await page.waitForSelector("[data-testid=archive-screen] .board .cell .d.given", { timeout: 25000 }).then(() => true, () => false);
    if (!shown) {
      const txt = await page.evaluate(() => document.querySelector("main")?.innerText.replace(/\n+/g, " | ").slice(0, 200));
      R.add(/uk|ru/.test(name) ? 32 : 30, false, `архив (${name}): сетка не появилась за 25 с; ответов 429 от локального API: ${r429}; на экране: ${txt}`);
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(600);
    const ov1 = await overflowReport(page);
    const idOk = await page.locator("[data-testid=archive-back]").isVisible();
    const sub = await page.evaluate(() => document.querySelector("[data-testid=archive-screen] .subline").textContent);
    const bad1 = ov1.bad.filter((b) => b.kind === "out-of-viewport" || b.kind === "text-clipped");
    const item = /uk|ru/.test(name) ? [32, 30] : [30];
    for (const it of item) R.add(it, !ov1.hscroll && bad1.length === 0 && idOk, `архив играющий (${name}): прокрутки вбок нет=${!ov1.hscroll}, «‹ ${(await page.locator("[data-testid=archive-back] span").textContent())}» виден, подпись «${sub}»${bad1.length ? "; замечания " + JSON.stringify(bad1.slice(0, 3)) : ""}`);
    if (/uk|ru/.test(name) || name.includes("AX3") || name === "тёмная") await shot(page, `i30-archive-${name.replace(/[ ,]+/g, "_")}`);
    // карточка решённого дня и «solved that day»: открываем решённый D3 в Year
    await page.evaluate(() => (location.hash = "#/year"));
    await yearReady(page);
    await page.locator(`.year-month:has(i[data-date="${H.d3}"])`).tap();
    await page.locator(`.ycell[data-date="${H.d3}"]`).tap();
    await page.waitForSelector("[data-testid=day-card]");
    await page.waitForTimeout(500);
    const ov2 = await overflowReport(page);
    const bad2 = ov2.bad.filter((b) => b.kind === "out-of-viewport" || b.kind === "text-clipped");
    for (const it of item) R.add(it, !ov2.hscroll && bad2.length === 0, `карточка дня в шите Year (${name}): прокрутки вбок нет=${!ov2.hscroll}${bad2.length ? "; замечания " + JSON.stringify(bad2.slice(0, 4)) : ", обрезанного текста нет"}`);
    if (/uk|ru/.test(name)) await shot(page, `i32-daycard-${name.replace(/[ ,]+/g, "_")}`);
    await ctx.close();
  }

  // ---------- 31. архивный день без сети; прогресс уходит после возврата сети ----------
  {
    const ctx = await hist({ extra: { serviceWorkers: "block" } });
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(2500);
    const token = await deviceToken(page);
    await page.route("**/api/**", (r) => r.abort("internetdisconnected"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await openYearDay(page, H.d1);
    await page.locator("[data-testid=play-day]").tap();
    let opened = true;
    await page.waitForSelector("[data-testid=archive-screen] .board .cell .d.given", { timeout: 30000 }).catch(() => (opened = false));
    const unavailable = await page.locator("[data-testid=archive-unavailable]").count();
    R.add(31, opened && unavailable === 0, `без сети архивный день ${H.d1} ${opened ? "открылся (сетка построена на устройстве)" : "НЕ открылся"}`);
    if (opened) {
      await fillCorrect(page);
      await page.waitForSelector("[data-testid=late-note]", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(3500);
      const before = await api("/api/snapshot", { headers: { authorization: `Bearer ${token}` } });
      const hasD1 = new RegExp(`"${H.d1}":\\s*\\{[^}]*"status":\\s*"solved"`).test(before.text);
      await page.unroute("**/api/**");
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      let r = { ok: false };
      const t0 = Date.now();
      while (Date.now() - t0 < 30000) {
        const s = await api("/api/snapshot", { headers: { authorization: `Bearer ${token}` } });
        if (new RegExp(`"${H.d1}":\\s*\\{[^}]*"status":\\s*"solved"`).test(s.text)) { r = { ok: true, ms: Date.now() - t0, late: /"late":\s*true/.test(s.text) }; break; }
        await new Promise((x) => setTimeout(x, 500));
      }
      R.add(31, !hasD1 && r.ok, `решён без сети: на сервере дня не было (${!hasD1}); после возврата сети (событие online) на сервере решённый ${H.d1} за ${r.ms} мс`);
    }
    await ctx.close();
  }

  // ---------- 33. дата раньше первого дня и будущая — недоступны ----------
  {
    const ctx = await hist();
    const page = await ctx.newPage();
    await page.goto(BASE + "/");
    await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(1000);
    const early = iso(daysAgo(10));
    const future = iso(daysAgo(-3));
    const res = {};
    for (const [k, d] of [["раньше первого дня", early], ["будущая", future], ["первый день (граница)", H.d3]]) {
      await page.evaluate((d) => (location.hash = `#/day/${d}`), d);
      await page.waitForTimeout(2500);
      res[k] = { unavailable: await page.locator("[data-testid=archive-unavailable]").count(), board: await page.locator("[data-testid=archive-screen] .board .cell .d.given").count() };
      if (k === "раньше первого дня") await shot(page, "i33-unavailable");
    }
    R.add(33, res["раньше первого дня"].unavailable === 1 && res["раньше первого дня"].board === 0, `#/day/${early} (до первого дня): «недоступно» показано, сетки нет`);
    R.add(33, res["будущая"].unavailable === 1 && res["будущая"].board === 0, `#/day/${future} (будущая): «недоступно», сетки нет — как у дат до первого дня`);
    R.add(33, res["первый день (граница)"].unavailable === 0, `#/day/${H.d3} (сам первый день, уже решён): не блокируется как «недоступный»`);
    await ctx.close();
  }
}
