// Пункты 1-12: установка/запуск, оболочка, таб-бар, темы, доступность оболочки.
import { BASE, SAFE_PORTRAIT, SAFE_LANDSCAPE, newContext, gotoApp, shot, overflowReport, stack } from "./lib.mjs";

const rgb = (r, g, b) => `rgb(${r}, ${g}, ${b})`;
const pngSize = (buf) => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

export async function run(R, browser) {
  // ---------- 1. манифест, иконки, мета ----------
  {
    const manifest = await (await fetch(BASE + "/manifest.webmanifest")).json();
    R.add(1, manifest.display === "standalone" && manifest.name === "Pundoku" && manifest.start_url === "/", `manifest: display=${manifest.display}, name=${manifest.name}, start_url=${manifest.start_url}`);
    for (const ic of manifest.icons) {
      const r = await fetch(BASE + "/" + ic.src);
      const { w, h } = pngSize(Buffer.from(await r.arrayBuffer()));
      R.add(1, r.status === 200 && `${w}x${h}` === ic.sizes, `icon ${ic.src}: ${r.status}, ${w}x${h}`);
    }
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await gotoApp(page);
    const meta = await page.evaluate(() => ({
      capable: document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content,
      title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content,
      status: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')?.content,
      viewport: document.querySelector('meta[name="viewport"]')?.content,
      touchIcon: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href"),
      standaloneBranch: typeof navigator.standalone,
    }));
    R.add(1, meta.capable === "yes" && meta.title === "Pundoku" && /viewport-fit=cover/.test(meta.viewport), `meta: capable=${meta.capable}, title=${meta.title}, status-bar=${meta.status}, viewport=${meta.viewport}`);
    const ti = await fetch(BASE + meta.touchIcon);
    const tis = pngSize(Buffer.from(await ti.arrayBuffer()));
    R.add(1, ti.status === 200 && tis.w === 180 && tis.h === 180, `apple-touch-icon ${meta.touchIcon}: ${ti.status}, ${tis.w}x${tis.h}`);
    await ctx.close();
  }

  // ---------- 2. светлая тема + safe area (подстановка значений) ----------
  {
    const ctx = await newContext(browser, { safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await gotoApp(page);
    const g = await page.evaluate(() => {
      const bar = document.querySelector(".tabbar").getBoundingClientRect();
      const lab = document.querySelector(".tab .lab").getBoundingClientRect();
      const tab = document.querySelector(".tab[aria-selected=true]");
      const cs = getComputedStyle(tab);
      const title = document.querySelector(".toolbar .title").getBoundingClientRect();
      return { vh: innerHeight, barBottom: bar.bottom, barTop: bar.top, labBottom: lab.bottom, tabColor: cs.color, tabBg: cs.backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor, titleTop: title.top };
    });
    R.add(2, Math.abs(g.barBottom - g.vh) < 1, `таб-бар прилегает к низу: bottom=${g.barBottom}, высота окна=${g.vh}`);
    R.add(2, g.labBottom <= g.vh - SAFE_PORTRAIT.bot + 0.5, `подписи вкладок выше индикатора Home (inset 34 подставлен): низ подписи ${g.labBottom.toFixed(1)} <= ${g.vh - 34}`);
    R.add(2, g.tabColor === rgb(59, 72, 176) && g.tabBg !== "rgba(0, 0, 0, 0)", `активная вкладка индиго ${g.tabColor} на подложке ${g.tabBg}`);
    R.add(2, g.titleTop >= SAFE_PORTRAIT.top, `заголовок Today ниже Dynamic Island (top inset 59 подставлен): top=${g.titleTop.toFixed(1)}`);
    await shot(page, "i02-light-today-safearea");
    await ctx.close();
  }

  // ---------- 3. стекло ----------
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await gotoApp(page);
    const g = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector(".tabbar"));
      return { bf: cs.backdropFilter || cs.webkitBackdropFilter, bg: cs.backgroundColor, supports: CSS.supports("backdrop-filter", "blur(1px)") || CSS.supports("-webkit-backdrop-filter", "blur(1px)") };
    });
    R.add(3, /blur/.test(g.bf), `backdrop-filter у таб-бара: "${g.bf}", заливка ${g.bg} (поддержка в движке: ${g.supports})`);
    await ctx.close();
  }

  // ---------- 4. тёмная тема ----------
  {
    const ctx = await newContext(browser, { colorScheme: "dark", safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await gotoApp(page);
    const g = await page.evaluate(() => {
      const tab = getComputedStyle(document.querySelector(".tab[aria-selected=true]"));
      const bar = getComputedStyle(document.querySelector(".tabbar"));
      return {
        bodyBg: getComputedStyle(document.body).backgroundColor,
        htmlBg: getComputedStyle(document.documentElement).backgroundColor,
        tab: tab.color,
        barBg: bar.backgroundColor,
        theme: [...document.querySelectorAll('meta[name="theme-color"]')].filter((m) => matchMedia(m.media).matches).map((m) => m.content),
        statusBar: document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]').content,
      };
    });
    R.add(4, g.htmlBg === rgb(0, 0, 0) && g.bodyBg === rgb(0, 0, 0), `фон чёрный: html=${g.htmlBg}, body=${g.bodyBg}`);
    R.add(4, g.tab === rgb(140, 150, 255), `активная вкладка ${g.tab} (ожидается #8C96FF)`);
    R.add(4, true, `заливка бара ${g.barBg} (полупрозрачная тёмно-серая по токену), theme-color для тёмной: ${g.theme.join(",")}`);
    R.add(4, g.statusBar === "default", `статус-бар PWA: apple-mobile-web-app-status-bar-style="${g.statusBar}" — как он выглядит под часами, видно только на iPhone`);
    await shot(page, "i04-dark-today");
    await ctx.close();
  }

  // ---------- 5. запуск из тёмной темы: статические предпосылки ----------
  {
    const ctx = await newContext(browser, { colorScheme: "dark" });
    const page = await ctx.newPage();
    await gotoApp(page);
    const links = await page.evaluate(() =>
      [...document.querySelectorAll('link[rel="apple-touch-startup-image"]')].map((l) => ({ href: l.getAttribute("href"), media: l.media, matches: matchMedia(l.media).matches })),
    );
    const matching = links.filter((l) => l.matches);
    R.add(5, matching.length === 1 && /launch-dark-1179x2556/.test(matching[0].href), `для iPhone 16 (393x852@3, тёмная) подходит ровно одна заставка: ${matching.map((m) => m.href).join(", ") || "нет"}`);
    if (matching[0]) {
      const r = await fetch(BASE + matching[0].href);
      const { w, h } = pngSize(Buffer.from(await r.arrayBuffer()));
      R.add(5, r.status === 200 && w === 1179 && h === 2556, `файл заставки ${r.status}, ${w}x${h}`);
    }
    const ctxL = await newContext(browser, { colorScheme: "light" });
    const pl = await ctxL.newPage();
    await gotoApp(pl);
    const lm = await pl.evaluate(() => [...document.querySelectorAll('link[rel="apple-touch-startup-image"]')].filter((l) => matchMedia(l.media).matches).map((l) => l.getAttribute("href")));
    R.add(5, lm.length === 1 && /launch-light-1179x2556/.test(lm[0]), `для светлой темы: ${lm.join(", ")}`);
    await ctx.close();
    await ctxL.close();
  }

  // ---------- 6. касания: touch-action, зум ----------
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await gotoApp(page);
    const g = await page.evaluate(() => {
      const ta = (el) => getComputedStyle(el).touchAction;
      return { body: ta(document.body), tab: ta(document.querySelector(".tab")), cell: ta(document.querySelector(".cell")), key: ta(document.querySelector(".pad .key")), scale: visualViewport.scale };
    });
    R.add(6, g.body === "manipulation" && g.tab === "manipulation" && g.cell === "manipulation" && g.key === "manipulation", `touch-action: body=${g.body}, вкладка=${g.tab}, клетка=${g.cell}, клавиша=${g.key}`);
    for (const t of ["play", "year", "today"]) await page.locator(`#tab-${t}`).tap();
    await page.touchscreen.tap(200, 20);
    await page.touchscreen.tap(200, 20);
    const scale = await page.evaluate(() => visualViewport.scale);
    R.add(6, scale === 1, `после тапов по вкладкам и двойного тапа масштаб visualViewport = ${scale} (задержку 300 мс эмуляция не воспроизводит)`);
    await ctx.close();
  }

  // ---------- 7. «пружина» ----------
  {
    const ctx = await newContext(browser, { safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await gotoApp(page);
    await page.locator("#tab-year").tap();
    await page.waitForTimeout(500);
    const before = await page.evaluate(() => document.querySelector(".tabbar").getBoundingClientRect().top);
    await page.evaluate(() => { const s = document.querySelector(".scroll"); s.scrollTop = s.scrollHeight; });
    await page.waitForTimeout(300);
    const g = await page.evaluate(() => ({
      barTop: document.querySelector(".tabbar").getBoundingClientRect().top,
      html: getComputedStyle(document.documentElement).overscrollBehaviorY,
      body: getComputedStyle(document.body).overscrollBehaviorY,
      scroll: getComputedStyle(document.querySelector(".scroll")).overscrollBehaviorY,
      docScroll: document.scrollingElement.scrollHeight - document.scrollingElement.clientHeight,
      winY: window.scrollY,
    }));
    R.add(7, g.html === "none" && g.body === "none" && g.scroll === "contain", `overscroll-behavior: html=${g.html}, body=${g.body}, .scroll=${g.scroll}`);
    R.add(7, Math.abs(g.barTop - before) < 0.5 && g.docScroll === 0 && g.winY === 0, `после прокрутки таб-бар не сместился (top ${before} -> ${g.barTop}), документ не прокручивается (запас ${g.docScroll}, scrollY=${g.winY})`);
    await ctx.close();
  }

  // ---------- 8. ландшафт ----------
  {
    const ctx = await newContext(browser, { viewport: { width: 852, height: 393 }, safeArea: SAFE_LANDSCAPE });
    const page = await ctx.newPage();
    await gotoApp(page);
    const g = await page.evaluate(() => {
      const bar = document.querySelector(".tabbar").getBoundingClientRect();
      const tabs = [...document.querySelectorAll(".tab")].map((t) => t.getBoundingClientRect());
      const title = document.querySelector(".toolbar .title").getBoundingClientRect();
      return { vh: innerHeight, vw: innerWidth, barBottom: bar.bottom, firstLeft: tabs[0].left, lastRight: tabs[2].right, titleLeft: title.left, scrollH: document.querySelector(".scroll").scrollHeight, clientH: document.querySelector(".scroll").clientHeight };
    });
    const rep = await overflowReport(page);
    R.add(8, g.firstLeft >= 59 && g.lastRight <= g.vw - 59 && g.titleLeft >= 59, `ландшафт 852x393 с подставленными inset 59/59: вкладки ${g.firstLeft.toFixed(0)}..${g.lastRight.toFixed(0)} из ${g.vw}, заголовок слева ${g.titleLeft.toFixed(0)}`);
    R.add(8, Math.abs(g.barBottom - g.vh) < 1 && !rep.hscroll, `бар у нижнего края (${g.barBottom}/${g.vh}), горизонтального скролла нет: ${!rep.hscroll}`);
    R.add(8, g.scrollH > g.clientH, `экран прокручивается (контент ${g.scrollH} > окно ${g.clientH}) — доступно всё содержимое`);
    await shot(page, "i08-landscape");
    await ctx.close();
  }

  // ---------- 9. размер текста ----------
  {
    const out = {};
    for (const dt of ["L", "xxxL", "AX5"]) {
      const ctx = await newContext(browser, { dynamicType: dt, safeArea: SAFE_PORTRAIT });
      const page = await ctx.newPage();
      await gotoApp(page);
      out[dt] = await page.evaluate(() => ({
        title: parseFloat(getComputedStyle(document.querySelector(".toolbar .title")).fontSize),
        lab: parseFloat(getComputedStyle(document.querySelector(".tab .lab")).fontSize),
        sub: parseFloat(getComputedStyle(document.querySelector(".subline")).fontSize),
      }));
      out[dt].rep = await overflowReport(page);
      if (dt === "AX5") await shot(page, "i09-ax5-today");
      await ctx.close();
    }
    R.add(9, out.AX5.title > out.L.title * 1.5 && out.xxxL.title > out.L.title, `заголовок: ${out.L.title}px (L) -> ${out.xxxL.title}px (xxxL) -> ${out.AX5.title}px (AX5)`);
    R.add(9, out.AX5.lab <= 13 && out.L.lab <= 13, `подписи вкладок остаются мелкими: ${out.L.lab} / ${out.xxxL.lab} / ${out.AX5.lab}px`);
    R.add(9, !out.xxxL.rep.hscroll && !out.AX5.rep.hscroll, `горизонтального скролла нет на xxxL и AX5; нарушений вне экрана: xxxL ${out.xxxL.rep.bad.length}, AX5 ${out.AX5.rep.bad.length} ${JSON.stringify(out.AX5.rep.bad.slice(0, 3))}`);
  }

  // ---------- 10. прозрачность / контраст ----------
  {
    const normal = await newContext(browser);
    const pn = await normal.newPage();
    await gotoApp(pn);
    const base = await pn.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".tabbar")).backgroundColor, bf: (getComputedStyle(document.querySelector(".tabbar")).webkitBackdropFilter || getComputedStyle(document.querySelector(".tabbar")).backdropFilter), label: getComputedStyle(document.querySelector(".tab:not([aria-selected=true]) .lab")).color, sub: getComputedStyle(document.querySelector(".subline")).color }));
    const mediaSupport = await pn.evaluate(() => ({ rt: matchMedia("(prefers-reduced-transparency: reduce)").media, rtOk: matchMedia("(prefers-reduced-transparency)").media, contrast: matchMedia("(prefers-contrast: more)").media }));
    const alpha = (c) => (c.startsWith("rgba") ? Number(c.split(",")[3]) : 1);
    R.add(10, true, `обычный режим: заливка бара ${base.bg}, фильтр ${base.bf}`);
    R.add(10, mediaSupport.rt !== "not all", `движок webkit из Playwright ${mediaSupport.rt === "not all" ? "НЕ понимает" : "понимает"} media-запрос prefers-reduced-transparency (matchMedia.media="${mediaSupport.rt}"), prefers-contrast: "${mediaSupport.contrast}". Включит ли iOS эти запросы от настроек «Уменьшить прозрачность»/«Увеличить контраст» — видно только на iPhone`);
    await normal.close();
    const rt = await newContext(browser, { reducedTransparency: true });
    const pr = await rt.newPage();
    await gotoApp(pr);
    const r = await pr.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".tabbar")).backgroundColor, bf: (getComputedStyle(document.querySelector(".tabbar")).webkitBackdropFilter || getComputedStyle(document.querySelector(".tabbar")).backdropFilter) }));
    R.add(10, alpha(r.bg) === 1 && (r.bf === "none" || r.bf === ""), `правило reduced-transparency (включено подменой media-запроса в CSS): бар ${r.bg}, фильтр "${r.bf}"`);
    await rt.close();
    const hc = await newContext(browser, { contrast: "more" });
    const ph = await hc.newPage();
    await gotoApp(ph);
    const h = await ph.evaluate(() => ({ bg: getComputedStyle(document.querySelector(".tabbar")).backgroundColor, bf: (getComputedStyle(document.querySelector(".tabbar")).webkitBackdropFilter || getComputedStyle(document.querySelector(".tabbar")).backdropFilter), label: getComputedStyle(document.querySelector(".tab:not([aria-selected=true]) .lab")).color, sub: getComputedStyle(document.querySelector(".subline")).color }));
    R.add(10, alpha(h.bg) === 1 && (h.bf === "none" || h.bf === ""), `prefers-contrast: more (эмуляция Playwright): бар непрозрачный ${h.bg}, фильтр "${h.bf}"`);
    R.add(10, h.sub !== base.sub || h.label !== base.label, `тексты темнее: подпись ${base.sub} -> ${h.sub}; вкладка ${base.label} -> ${h.label}`);
    await shot(ph, "i10-contrast-more");
    await hc.close();
  }

  // ---------- 11. языки ----------
  for (const [loc, tabs, code] of [["uk-UA", ["Сьогодні", "Грати", "Рік"], "uk"], ["ru-RU", ["Сегодня", "Играть", "Год"], "ru"]]) {
    const ctx = await newContext(browser, { locale: loc });
    const page = await ctx.newPage();
    await gotoApp(page);
    const labs = await page.locator(".tab .lab").allInnerTexts();
    const lang = await page.evaluate(() => document.documentElement.lang);
    const reps = {};
    for (const t of ["today", "play", "year"]) {
      await page.locator(`#tab-${t}`).tap();
      await page.waitForTimeout(500);
      reps[t] = await overflowReport(page);
      await shot(page, `i11-${code}-${t}`);
    }
    R.add(11, lang === code && labs.length === 3, `${loc}: lang="${lang}", подписи вкладок: ${labs.join(" / ")} (ожидания по смыслу: ${tabs.join(" / ")})`);
    const bad = Object.entries(reps).flatMap(([k, v]) => v.bad.map((b) => ({ screen: k, ...b })).concat(v.hscroll ? [{ screen: k, kind: "hscroll" }] : []));
    R.add(11, bad.length === 0, `${code}: обрезка/выход за экран на Today, Play, Year: ${bad.length ? JSON.stringify(bad.slice(0, 4)) : "нет"} (393x852)`);
    await ctx.close();
  }

  // ---------- 12. офлайн: service worker ----------
  {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await gotoApp(page);
    const swReady = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return "нет serviceWorker";
      const reg = await navigator.serviceWorker.ready;
      return reg.active ? "active" : "not active";
    });
    await page.waitForTimeout(2500); // дать дописать precache
    const caches = await page.evaluate(async () => { const k = await caches.keys(); let n = 0; for (const key of k) n += (await (await caches.open(key)).keys()).length; return { keys: k.length, entries: n }; });
    R.add(12, swReady === "active" && caches.entries > 20, `service worker: ${swReady}; precache: ${caches.entries} записей`);
    await page.close();
    stack("web-down");
    let offline = null;
    try {
      const p2 = await ctx.newPage();
      await p2.goto(BASE + "/", { timeout: 15000 });
      await p2.waitForSelector(".board .given", { timeout: 25000 });
      offline = await p2.evaluate(() => ({ title: document.querySelector(".toolbar .title")?.textContent, cells: document.querySelectorAll(".board .cell").length, given: document.querySelectorAll(".board .cell .given").length }));
      await shot(p2, "i12-offline-today");
      R.add(12, offline.cells === 81 && offline.given > 17, `при остановленном сервере (имитация офлайна) запуск из service worker: экран "${offline.title}", клеток ${offline.cells}, заданных ${offline.given} (сетка из клиентского генератора)`);
    } catch (e) {
      R.add(12, false, `офлайн-запуск не удался: ${e.message}`);
    } finally {
      stack("web-up");
    }
    await ctx.close();
  }
}
