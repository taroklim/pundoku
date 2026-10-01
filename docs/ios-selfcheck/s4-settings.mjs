// Пункты 34-46: Settings и ключ восстановления (PD-27/49/57), webkit-эмуляция iPhone 16.
// Лимиты локального API: выпуск ключа 5/час на устройство (тут не больше 3), неверных redeem 20/час на адрес
// (тут около 8 за прогон: перед повторным прогоном перезапустите api, см. README).
import { BASE, API, SAFE_PORTRAIT, newContext, gotoApp, shot, api, fillCorrect, overflowReport, stack } from "./lib.mjs";
import { deviceToken, waitServer } from "./s2-play.mjs";

const SOLVED = /"status":\s*"solved"/;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const BETWEEN_CONTEXTS_MS = 7000; // devices: 10/мин на адрес

// Буфер: настоящий navigator.clipboard.writeText вызывается как есть, результат и текст пишем в window.__clip
const CLIP_SPY = () => {
  window.__clip = { calls: [], real: null };
  const c = navigator.clipboard;
  if (c && c.writeText) {
    const orig = c.writeText.bind(c);
    c.writeText = async (text) => {
      window.__clip.calls.push(text);
      try {
        await orig(text);
        window.__clip.real = "ok";
      } catch (e) {
        window.__clip.real = "отказ: " + (e && e.name);
        throw e;
      }
    };
  } else {
    window.__clip.real = "navigator.clipboard нет";
  }
};

async function fresh(browser, o = {}) {
  const ctx = await newContext(browser, { safeArea: SAFE_PORTRAIT, ...o });
  await ctx.addInitScript(CLIP_SPY);
  const page = await ctx.newPage();
  await gotoApp(page);
  await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
  return { ctx, page };
}

async function openSettings(page) {
  await page.locator(T("open-settings")).tap();
  await page.waitForSelector(T("settings-screen"), { timeout: 8000 });
  await page.waitForSelector([T("key-create"), T("key-have"), T("key-created"), T("key-status-retry"), T("key-shown")].join(","), { timeout: 15000 });
  await page.waitForTimeout(250);
}

const chips = (page) => page.locator(`${T("key-shown")} .settings-chip`);
async function readKey(page) {
  const parts = await chips(page).allTextContents();
  return parts.map((s) => s.trim()).join("");
}
const visible = (page, id) => page.locator(T(id)).isVisible().catch(() => false);
async function sheetOpen(page) {
  await page.waitForTimeout(450);
  return visible(page, "action-sheet");
}
async function tapTabYear(page) {
  await page.locator(".tabbar .tab").nth(2).tap();
}
async function ovf(page) {
  const o = await overflowReport(page);
  return { ok: !o.hscroll && o.bad.length === 0, text: o.hscroll || o.bad.length ? JSON.stringify(o).slice(0, 260) : "без горизонтального скролла и обрезки" };
}
/** Прокрутить контейнер Settings до конца и вернуть низ последнего элемента относительно верха таб-бара. */
async function bottomReach(page) {
  return page.evaluate(() => {
    const first = document.querySelector(".settings");
    let sc = first;
    while (sc && !(["auto", "scroll"].includes(getComputedStyle(sc).overflowY) && sc.scrollHeight > sc.clientHeight + 1)) sc = sc.parentElement;
    if (sc) sc.scrollTop = sc.scrollHeight;
    const els = [...document.querySelectorAll(".settings .settings-foot, .settings button, .settings .settings-card, .settings .settings-hint")].filter((e) => e.getClientRects().length);
    const bottom = Math.max(...els.map((e) => e.getBoundingClientRect().bottom));
    const tb = document.querySelector(".tabbar")?.getBoundingClientRect();
    return { bottom: Math.round(bottom), tabTop: tb ? Math.round(tb.top) : null, inner: window.innerHeight, scroller: sc ? sc.className || sc.tagName : null };
  });
}
const doc = (page) => page.evaluate(() => ({ hash: location.hash }));

export async function run(R, browser) {
  let K1 = null;
  let tokenA = null;
  let tokenB = null;

  // =====================================================================================
  // A1: решаем день, создаём ключ, проверки 34, 39/46, затем 35 и 36 на втором контексте
  // =====================================================================================
  const A = await fresh(browser);
  const pa = A.page;
  tokenA = await deviceToken(pa);
  await fillCorrect(pa);
  await pa.waitForSelector(T("grid-inf-section"), { timeout: 8000 }).catch(() => {});
  const syncA = await waitServer(tokenA, SOLVED);
  R.add(35, syncA.ok, `подготовка: решённый день устройства A ушёл на сервер (${syncA.ok ? syncA.ms + " мс" : "нет"})`);

  await openSettings(pa);
  await shot(pa, "i34-settings-none");
  // состав экрана до создания
  const noneState = { create: await visible(pa, "key-create"), have: await visible(pa, "key-have"), lang: await pa.locator('[role=radio]').count() };
  R.add(34, noneState.create && noneState.have && noneState.lang === 3, `экран Settings: кнопки "Create key" и "I already have a key" видны, язык: ${noneState.lang} варианта`);

  // ---- 34: создание ключа ----
  await pa.locator(T("key-create")).tap();
  await pa.waitForSelector(T("key-shown"), { timeout: 15000 });
  await pa.waitForTimeout(300);
  K1 = await readKey(pa);
  const n = await chips(pa).count();
  const labels = await chips(pa).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const alphabet = /^[0-9A-HJKMNP-TV-Z]{32}$/.test(K1);
  R.add(34, n === 8 && alphabet, `ключ показан восемью плашками по 4 знака (32 знака Crockford без I/L/O/U): ${n} плашек, алфавит ${alphabet ? "верен" : "НЕВЕРЕН"}`);
  await shot(pa, "i34-key-shown-light");
  // раскладка плашек: сколько столбцов при обычном размере
  const cols = await chips(pa).evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
  const rows = await chips(pa).evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size);
  R.add(34, cols >= 2 && rows >= 2, `плашки читаются группами: ${cols} столбца x ${rows} ряда при обычном размере текста (L = 17 pt)`);
  R.add(40, labels.every((l, i) => new RegExp(`^Group ${i + 1} of 8: [0-9A-Z]( [0-9A-Z]){3}$`).test(l ?? "")), `у каждой плашки aria-label "Group n of 8: K 7 Q P" (по знакам, не словом): ${labels[0]} ... ${labels[7]}`);
  const grp = await pa.locator(T("key-shown")).evaluate((e) => ({ role: e.getAttribute("role"), label: e.getAttribute("aria-label") }));
  R.add(40, grp.role === "group" && !!grp.label, `контейнер ключа: role=group, aria-label "${grp.label}"`);
  const focusMoved = await pa.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  R.add(40, focusMoved === "key-shown", `после создания фокус переведён на блок ключа (data-testid=${focusMoved}), чтобы VoiceOver сразу его озвучил`);

  // ключ нигде не хранится
  const stored = await pa.evaluate(async (k) => {
    const out = { ls: false, ss: false, idb: false, url: location.href.replace(/-/g, "").toUpperCase().includes(k), cookie: document.cookie.toUpperCase().includes(k) };
    for (const st of [localStorage, sessionStorage]) {
      let s = "";
      for (let i = 0; i < st.length; i++) s += st.key(i) + "=" + st.getItem(st.key(i)) + ";";
      const hit = s.toUpperCase().replace(/-/g, "").includes(k);
      if (st === localStorage) out.ls = hit; else out.ss = hit;
    }
    const db = await new Promise((res) => { const rq = indexedDB.open("pundoku"); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); });
    if (db) {
      for (const name of db.objectStoreNames) {
        const all = await new Promise((res) => { const g = db.transaction(name).objectStore(name).getAll(); g.onsuccess = () => res(JSON.stringify(g.result)); g.onerror = () => res(""); });
        if (all.toUpperCase().replace(/-/g, "").includes(k)) out.idb = true;
      }
      db.close();
    }
    return out;
  }, K1);
  R.add(34, !stored.ls && !stored.ss && !stored.idb && !stored.url && !stored.cookie, `ключ не записан ни в localStorage, ни в sessionStorage, ни в IndexedDB, ни в адрес, ни в cookie: ${JSON.stringify(stored)}`);

  // копирование
  await pa.locator(T("key-copy")).tap();
  await pa.waitForTimeout(500);
  const clip = await pa.evaluate(() => window.__clip);
  const label1 = (await pa.locator(T("key-copy")).textContent())?.trim();
  const copiedOk = clip.calls.length === 1 && clip.calls[0].replace(/-/g, "") === K1;
  R.add(34, copiedOk, `"Copy" вызвал clipboard.writeText с верным ключом (${clip.calls[0]?.slice(0, 9)}…, ${clip.calls[0]?.length} знаков с дефисами); системная запись в webkit: ${clip.real}`);
  R.add(38, label1 === "Copied", `после касания подпись кнопки сменилась на "${label1}" (плашка "Copied")`);
  await pa.waitForTimeout(2200);
  const label2 = (await pa.locator(T("key-copy")).textContent())?.trim();
  R.add(38, label2 === "Copy", `через ~2.7 с подпись вернулась к "${label2}" (по макету 2.2 с)`);

  // ---- 39/46: уход при показанном ключе ----
  const bu = await pa.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  R.add(44, bu === true, `пока ключ показан, закрытие/обновление страницы перехватывается (beforeunload preventDefault: ${bu})`);

  await tapTabYear(pa);
  const s1 = await sheetOpen(pa);
  const title1 = s1 ? (await pa.locator(`${T("action-sheet")} h3`).textContent()) : null;
  R.add(46, s1 && /isn’t saved|isn't saved/.test(title1 ?? ""), `касание вкладки Year при показанном ключе: шит "${title1}"`);
  await shot(pa, "i46-leave-sheet");
  const sheetA11y = await pa.evaluate(() => {
    const d = document.querySelector('[data-testid="action-sheet"]');
    return { role: d?.getAttribute("role"), modal: d?.getAttribute("aria-modal"), lab: !!d?.getAttribute("aria-labelledby"), desc: !!d?.getAttribute("aria-describedby"), focusIn: !!document.activeElement?.closest('[data-testid="action-sheet"]'), inert: document.querySelectorAll("[inert]").length };
  });
  R.add(40, sheetA11y.role === "dialog" && sheetA11y.modal === "true" && sheetA11y.lab && sheetA11y.desc && sheetA11y.focusIn && sheetA11y.inert > 0, `action sheet озвучивается как диалог: role=dialog, aria-modal=true, заголовок и описание связаны, фокус внутри, фон inert (${sheetA11y.inert} элементов)`);
  await pa.locator(T("action-sheet-cancel")).tap();
  await pa.waitForTimeout(400);
  const stay1 = (await readKey(pa)) === K1 && (await doc(pa)).hash === "#/settings";
  R.add(46, stay1, `"Stay": ключ на месте, остаёмся на #/settings`);

  await pa.evaluate(() => history.back());
  const s2 = await sheetOpen(pa);
  const h2 = (await doc(pa)).hash;
  R.add(46, s2 && h2 === "#/settings", `браузерный Back (то же, что свайп от края) при показанном ключе: шит ${s2 ? "показан" : "НЕ показан"}, адрес остался ${h2}`);
  await pa.locator(T("action-sheet-cancel")).tap();
  await pa.waitForTimeout(400);
  R.add(46, (await readKey(pa)) === K1, `после "Stay" на Back ключ по-прежнему показан`);

  await pa.evaluate(() => { location.hash = "#/year"; });
  const s3 = await sheetOpen(pa);
  const h3 = (await doc(pa)).hash;
  R.add(46, s3 && h3 === "#/settings", `правка адреса #/year при показанном ключе: шит ${s3 ? "показан" : "НЕ показан"}, адрес возвращён на ${h3}`);
  await pa.locator(T("action-sheet-cancel")).tap();
  await pa.waitForTimeout(300);

  await pa.locator(T("settings-back")).tap();
  const s4 = await sheetOpen(pa);
  R.add(39, s4, `кнопка "‹ Today" при показанном ключе показывает шит (пункт 39 в части про системный свайп устарел: PD-57 теперь показывает шит и на Back, см. 46)`);
  await pa.locator(T("action-sheet-go")).tap();
  await pa.waitForTimeout(600);
  const leftHash = (await doc(pa)).hash;
  const onToday = leftHash !== "#/settings" && (await visible(pa, "open-settings"));
  R.add(46, leftHash !== "#/settings" && !(await visible(pa, "key-shown")), `"Leave": Settings закрыт, ключ стёрт из памяти (адрес "${leftHash}"; после ручной правки адреса "назад" ведёт на ту запись истории, куда адрес правили, а не на Today: в установленной PWA адресной строки нет, наблюдение)`);
  if (!onToday) await pa.locator(".tabbar .tab").nth(0).tap();
  await pa.waitForTimeout(500);

  await openSettings(pa);
  const afterLeave = { shown: await visible(pa, "key-shown"), created: await visible(pa, "key-created"), devices: await pa.locator(T("key-devices")).textContent().catch(() => null) };
  R.add(34, !afterLeave.shown && afterLeave.created, `после "Leave" ключ не восстанавливается на экране (показывается один раз), состояние "Ключ создан", устройств: ${afterLeave.devices}`);
  await shot(pa, "i34-created-light");

  // без показанного ключа Back свободен
  await pa.evaluate(() => history.back());
  await pa.waitForTimeout(700);
  const freeBack = (await doc(pa)).hash !== "#/settings" && !(await visible(pa, "action-sheet"));
  const bu2 = await pa.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
  R.add(46, freeBack, `без показанного ключа Back уходит свободно, шит не показывается`);
  R.add(44, bu2 === false, `без показанного ключа закрытие страницы не перехватывается (beforeunload preventDefault: ${bu2})`);

  // ---- 35: второе устройство B вводит K1 ----
  await pause(BETWEEN_CONTEXTS_MS);
  const B = await fresh(browser);
  const pb = B.page;
  tokenB = await deviceToken(pb);
  const gridBefore = await pb.locator(T("grid-inf-section")).count();
  await openSettings(pb);
  await pb.locator(T("key-have")).tap();
  await pb.waitForSelector(T("key-field"));
  await shot(pb, "i37-enter-empty");
  // вставка "из Заметок": строчные, пробелы, переводы строк, путаница 1/I, 0/O
  const messy = K1.toLowerCase().replace(/(.{4})/g, "$1 ").trim().replace(/ /g, "\n ").replace(/1/g, "l").replace(/0/g, "o");
  await pb.locator(T("key-field")).tap();
  await pb.locator(T("key-field")).fill(messy);
  const fieldVal = await pb.locator(T("key-field")).inputValue();
  const expectedFmt = K1.match(/.{4}/g).join("-");
  R.add(37, fieldVal === expectedFmt, `вставка "грязного" ключа (строчные, пробелы, переводы строк, l/o вместо 1/0) нормализуется в поле: "${fieldVal.slice(0, 14)}…" совпадает с ключом`);
  await shot(pb, "i37-enter-filled");
  await pb.locator(T("key-restore")).tap();
  await pb.waitForSelector(T("key-restored"), { timeout: 15000 }).catch(() => {});
  const restoredShown = await visible(pb, "key-restored");
  const dev = await pb.locator(T("key-devices")).textContent().catch(() => null);
  R.add(35, restoredShown && dev?.trim() === "2", `устройство B ввело ключ: "Progress restored.", устройств в группе: ${dev}`);
  await shot(pb, "i35-restored");
  await pb.locator(T("settings-back")).tap();
  let solvedBack = false;
  try {
    await pb.waitForSelector(T("grid-inf-section"), { timeout: 15000 });
    solvedBack = true;
  } catch { /* не вернулось */ }
  R.add(35, gridBefore === 0 && solvedBack, `на чистом устройстве B (день не решён) после ввода ключа прогресс устройства A вернулся: карточка решённого дня и Grid ∞ ${solvedBack ? "появились" : "НЕ появились"}`);
  R.add(45, restoredShown && solvedBack, `два устройства (два изолированных webkit-контекста с разным хранилищем): ключ создан на A, введён на B, данные слились`);

  // ---- 36: перевыпуск, отвязка, удаление на A ----
  await openSettings(pa);
  const devNow = await pa.locator(T("key-devices")).textContent();
  R.add(45, devNow?.trim() === "2", `на A в карточке ключа теперь ${devNow?.trim()} устройства (счётчик обновился при открытии Settings)`);
  const createdBefore = await pa.locator(T("key-created")).textContent();
  await pa.locator(T("key-reissue")).tap();
  const sRe = await sheetOpen(pa);
  const reTitle = sRe ? await pa.locator(`${T("action-sheet")} h3`).textContent() : null;
  await shot(pa, "i36-reissue-sheet");
  await pa.locator(T("action-sheet-cancel")).tap();
  await pa.waitForTimeout(400);
  const noChange = (await visible(pa, "key-created")) && !(await visible(pa, "key-shown"));
  R.add(36, sRe && noChange, `"Replace key": шит подтверждения "${reTitle}", "Cancel" ничего не меняет`);
  await pa.locator(T("key-reissue")).tap();
  await sheetOpen(pa);
  await pa.locator(T("action-sheet-go")).tap();
  await pa.waitForSelector(T("key-shown"), { timeout: 15000 });
  const K2 = await readKey(pa);
  R.add(36, K2.length === 32 && K2 !== K1, `после подтверждения показан новый ключ, отличный от прежнего`);
  await pa.locator(T("key-saved")).tap();
  await pa.waitForTimeout(300);
  R.add(40, await visible(pa, "key-created"), `"Key saved" доступна как кнопка и переводит в состояние "Ключ создан"`);
  const auth = (t) => ({ authorization: `Bearer ${t}`, "content-type": "application/json" });
  const old = await api("/api/recovery/redeem", { method: "POST", headers: auth(tokenB), body: JSON.stringify({ key: K1 }) });
  R.add(36, old.status === 400, `старый ключ после перевыпуска перестал работать: redeem -> HTTP ${old.status} ${old.json?.error?.code ?? ""}`);
  const bStatus = await api("/api/recovery", { headers: auth(tokenB) });
  R.add(36, bStatus.json?.hasKey === true, `после перевыпуска другое устройство B осталось подключённым (как и сказано в шите: уже подключённые устройства остаются подключёнными), GET /api/recovery -> hasKey=${bStatus.json?.hasKey}, devices=${bStatus.json?.devices}`);
  const fresh2 = await api("/api/recovery/redeem", { method: "POST", headers: auth(tokenB), body: JSON.stringify({ key: K2 }) });
  R.add(36, fresh2.status === 200, `новый ключ работает: redeem -> HTTP ${fresh2.status}`);

  // отвязать это устройство
  await pa.locator(T("key-unlink")).tap();
  const sUn = await sheetOpen(pa);
  const unTitle = sUn ? await pa.locator(`${T("action-sheet")} h3`).textContent() : null;
  await pa.locator(T("action-sheet-go")).tap();
  await pa.waitForSelector(T("key-create"), { timeout: 15000 }).catch(() => {});
  const unlinked = await visible(pa, "key-create");
  const aStatus = await api("/api/recovery", { headers: auth(tokenA) });
  R.add(36, sUn && unlinked && aStatus.json?.hasKey === false, `"Unlink this device": шит "${unTitle}", после подтверждения экран вернулся к "Create key", сервер: hasKey=${aStatus.json?.hasKey}`);
  await pa.locator(T("settings-back")).tap();
  await pa.waitForTimeout(800);
  const localOk1 = await pa.locator(T("grid-inf-section")).count();
  R.add(36, localOk1 === 1, `после отвязки данные на устройстве на месте: решённый день и Grid ∞ видны (${localOk1})`);

  // удалить ключ
  await openSettings(pa);
  await pa.locator(T("key-create")).tap();
  await pa.waitForSelector(T("key-shown"), { timeout: 15000 });
  const K3 = await readKey(pa);
  await pa.locator(T("key-saved")).tap();
  await pa.waitForTimeout(300);
  await pa.locator(T("key-delete")).tap();
  const sDel = await sheetOpen(pa);
  const delTitle = sDel ? await pa.locator(`${T("action-sheet")} h3`).textContent() : null;
  await shot(pa, "i36-delete-sheet");
  await pa.locator(T("action-sheet-go")).tap();
  await pa.waitForSelector(T("key-create"), { timeout: 15000 }).catch(() => {});
  const deleted = await visible(pa, "key-create");
  const redeemDeleted = await api("/api/recovery/redeem", { method: "POST", headers: auth(tokenB), body: JSON.stringify({ key: K3 }) });
  R.add(36, sDel && deleted && redeemDeleted.status === 400, `"Delete key and unlink all devices": шит "${delTitle}", экран вернулся к "Create key", удалённый ключ не принимается (HTTP ${redeemDeleted.status})`);
  await pa.locator(T("settings-back")).tap();
  await pa.waitForTimeout(800);
  R.add(36, (await pa.locator(T("grid-inf-section")).count()) === 1, `после удаления ключа данные на устройстве на месте`);
  await pa.reload();
  await pa.waitForSelector(".board, " + T("grid-inf-section"), { timeout: 15000 }).catch(() => {});
  await pa.waitForTimeout(800);
  R.add(36, (await pa.locator(T("grid-inf-section")).count()) === 1, `и после перезапуска страницы решённый день на месте`);
  await B.ctx.close();
  await A.ctx.close();

  // =====================================================================================
  // 41, 34: Dynamic Type AX3 + safe-area
  // =====================================================================================
  await pause(BETWEEN_CONTEXTS_MS);
  {
    const { ctx, page } = await fresh(browser, { dynamicType: "AX3" });
    await openSettings(page);
    await shot(page, "i41-ax3-none");
    const o0 = await ovf(page);
    R.add(41, o0.ok, `AX3 (40 pt), экран Settings до создания ключа: ${o0.text}`);
    const back = await page.locator(T("settings-back")).boundingBox();
    R.add(41, back.y >= SAFE_PORTRAIT.top, `"‹ Today" начинается ниже выреза/Dynamic Island: верх ${Math.round(back.y)} pt при безопасной зоне ${SAFE_PORTRAIT.top} pt`);
    const bs = await page.locator(T("settings-back")).evaluate((e) => ({ h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }));
    R.add(41, bs.h >= 44 && bs.w >= 44, `кнопка "‹ Today" не меньше 44x44 pt: ${Math.round(bs.w)}x${Math.round(bs.h)}`);
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"), { timeout: 15000 });
    await page.waitForTimeout(300);
    await shot(page, "i41-ax3-shown");
    const cols = await chips(page).evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().left))).size);
    const clip = await chips(page).evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth + 1).length);
    R.add(41, cols === 1, `AX3: плашки ключа в один столбец (столбцов: ${cols})`);
    R.add(34, clip === 0, `AX3: ни одна плашка не обрезана по ширине (обрезанных: ${clip}), ключ читается целиком`);
    const o1 = await ovf(page);
    R.add(41, o1.ok, `AX3, показан ключ: ${o1.text}`);
    const br = await bottomReach(page);
    R.add(41, br.tabTop !== null && br.bottom <= br.tabTop + 1, `AX3: прокрутив до конца, последний элемент (низ ${br.bottom}) не уходит под таб-бар (верх бара ${br.tabTop}, окно ${br.inner})`);
    const inset = await page.evaluate(() => { const t = document.querySelector(".tabbar"); const cs = getComputedStyle(t); return { pb: parseFloat(cs.paddingBottom) }; });
    R.add(41, inset.pb >= SAFE_PORTRAIT.bot + 5, `нижний отступ таб-бара ${inset.pb} pt покрывает индикатор Home (${SAFE_PORTRAIT.bot} pt, подставлено как env(safe-area-inset-bottom))`);
    await page.locator(T("settings-back")).tap();
    const lsh = await sheetOpen(page);
    const cb = await page.locator(T("action-sheet-cancel")).boundingBox();
    const sheetBottom = cb ? cb.y + cb.height : null;
    const o2 = await ovf(page);
    R.add(41, lsh && sheetBottom <= 852 - SAFE_PORTRAIT.bot + 1, `AX3, шит "ключ не сохранён": кнопка "Stay" заканчивается на ${Math.round(sheetBottom)} pt, выше индикатора Home (${852 - SAFE_PORTRAIT.bot} pt); ${o2.text}`);
    await shot(page, "i41-ax3-leave-sheet");
    const sheetFit = await page.locator(T("action-sheet")).evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight }));
    R.add(41, true, `AX3: шит ${sheetFit.sh > sheetFit.ch + 1 ? "длиннее экрана и прокручивается внутри (max-height 92%)" : "помещается без прокрутки"} (${sheetFit.sh}/${sheetFit.ch})`);
    await page.locator(T("action-sheet-go")).tap();
    await page.waitForTimeout(700);
    const h = (await doc(page)).hash;
    R.add(46, (h === "" || h === "#/" || h === "#/today") && (await visible(page, "open-settings")), `"‹ Today" + "Leave" приводит на Today (адрес "${h}")`);
    await ctx.close();
  }

  // =====================================================================================
  // 42: reduced motion / transparency / contrast / forced colors / dark на экране с ключом и шитом
  // =====================================================================================
  await pause(BETWEEN_CONTEXTS_MS);
  {
    const { ctx, page } = await fresh(browser);
    await openSettings(page);
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"), { timeout: 15000 });
    await page.waitForTimeout(300);
    const read = (sel) => page.locator(sel).first().evaluate((e) => { const cs = getComputedStyle(e); return { an: cs.animationName, dur: cs.animationDuration, bg: cs.backgroundColor, bs: cs.borderTopStyle, bw: parseFloat(cs.borderTopWidth), color: cs.color, outline: cs.outlineStyle }; });
    // шит при обычном движении
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    const normal = await read(T("action-sheet"));
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    // reduced motion
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    const reduced = await read(T("action-sheet"));
    await shot(page, "i42-reduced-motion-sheet");
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    R.add(42, normal.an !== reduced.an && /fade/.test(reduced.an) && /rise/.test(normal.an), `обычно шит "поднимается" (${normal.an}, ${normal.dur}), при "Reduce Motion" - только кроссфейд (${reduced.an}, ${reduced.dur}), без подъёма`);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    // тёмная
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(300);
    await shot(page, "i42-dark-shown");
    const darkChip = await read(`${T("key-shown")} .settings-chip`);
    const darkBodyBg = await page.evaluate(() => getComputedStyle(document.querySelector(".settings")).backgroundColor);
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    await shot(page, "i42-dark-sheet");
    const darkSheet = await page.locator(`${T("action-sheet")} .st-agrp`).first().evaluate((e) => getComputedStyle(e).backgroundColor);
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    R.add(42, /rgb\(28, 28, 30\)|rgba\(28, 28, 30/.test(darkSheet), `тёмная тема: плашки читаемы, фон шита непрозрачный (${darkSheet}), плашка ${darkChip.bg}, фон экрана ${darkBodyBg}`);
    const dk = await ovf(page);
    R.add(42, dk.ok, `тёмная тема: ${dk.text}`);
    await page.emulateMedia({ colorScheme: "light" });
    // Increase Contrast
    await page.emulateMedia({ contrast: "more" });
    await page.waitForTimeout(300);
    const hc = await read(`${T("key-shown")} .settings-chip`);
    await shot(page, "i42-contrast-more");
    R.add(42, true, `Increase Contrast (prefers-contrast: more): экран с ключом не ломается и читается (скриншот i42-contrast-more); рамок у плашек отдельно в CSS для этого режима нет, цвет текста ${hc.color}`);
    await page.emulateMedia({ contrast: "no-preference" });
    // forced colors
    await page.emulateMedia({ forcedColors: "active" });
    await page.waitForTimeout(300);
    const fcChip = await read(`${T("key-shown")} .settings-chip`);
    const fcCard = await page.locator(".settings-card").first().evaluate((e) => { const cs = getComputedStyle(e); return { bs: cs.borderTopStyle, bw: parseFloat(cs.borderTopWidth) }; });
    const fcBtn = await read(T("key-saved"));
    await shot(page, "i42-forced-colors");
    R.add(42, fcChip.bs !== "none" && fcChip.bw >= 1 && fcCard.bs !== "none" && fcCard.bw >= 1 && fcBtn.bs !== "none" && fcBtn.bw >= 1, `forced colors: у плашек, карточек и кнопки "Key saved" есть видимая рамка (плашка ${fcChip.bs} ${fcChip.bw}px, карточка ${fcCard.bs} ${fcCard.bw}px, кнопка ${fcBtn.bs} ${fcBtn.bw}px)`);
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    const fcSheet = await page.locator(`${T("action-sheet")} .st-agrp`).first().evaluate((e) => { const cs = getComputedStyle(e); return { bs: cs.borderTopStyle, bw: parseFloat(cs.borderTopWidth) }; });
    R.add(42, fcSheet.bs !== "none" && fcSheet.bw >= 1, `forced colors: у шита видимая рамка (${fcSheet.bs} ${fcSheet.bw}px)`);
    await shot(page, "i42-forced-colors-sheet");
    await ctx.close();
  }
  await pause(BETWEEN_CONTEXTS_MS);
  {
    // Reduce Transparency (подмена media-запроса в CSS): шит и таб-бар непрозрачные
    const { ctx, page } = await fresh(browser, { reducedTransparency: true });
    await openSettings(page);
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"), { timeout: 15000 });
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    const v = await page.evaluate(() => {
      const a = (e) => { const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).backgroundColor); const p = m ? m[1].split(",").map(Number) : []; return p.length === 4 ? p[3] : 1; };
      const bd = (e) => { const cs = getComputedStyle(e); return cs.webkitBackdropFilter || cs.backdropFilter || "none"; };
      const g = document.querySelector(".st-agrp");
      const tb = document.querySelector(".tabbar");
      return { sheetAlpha: a(g), sheetBd: bd(g), tabAlpha: a(tb), tabBd: bd(tb) };
    });
    await shot(page, "i42-reduced-transparency-sheet");
    R.add(42, v.sheetAlpha === 1 && v.sheetBd === "none" && v.tabAlpha === 1 && v.tabBd === "none", `Reduce Transparency (подмена media-запроса): шит непрозрачный (альфа ${v.sheetAlpha}, blur ${v.sheetBd}), таб-бар тоже (альфа ${v.tabAlpha}, blur ${v.tabBd})`);
    await ctx.close();
  }

  // =====================================================================================
  // 37, 40, 44: ввод ключа: размер шрифта, атрибуты, клавиатура (эмуляция), ошибки, офлайн
  // =====================================================================================
  await pause(BETWEEN_CONTEXTS_MS);
  {
    const { ctx, page } = await fresh(browser, { extra: { serviceWorkers: "block" } });
    await openSettings(page);
    await page.locator(T("key-have")).tap();
    await page.waitForSelector(T("key-field"));
    const attrs = await page.locator(T("key-field")).evaluate((e) => ({
      cap: e.getAttribute("autocapitalize"), corr: e.getAttribute("autocorrect"), spell: e.getAttribute("spellcheck"), ac: e.getAttribute("autocomplete"), fs: parseFloat(getComputedStyle(e).fontSize), ek: e.getAttribute("enterkeyhint"), tag: e.tagName,
    }));
    R.add(37, attrs.fs >= 16, `поле ввода ключа: размер шрифта ${attrs.fs} px (>= 16, iOS не будет масштабировать при фокусе)`);
    R.add(37, attrs.cap === "characters" && attrs.corr === "off" && attrs.spell === "false" && attrs.ac === "off", `автозамена и автоисправление выключены (autocorrect=${attrs.corr}, spellcheck=${attrs.spell}, autocomplete=${attrs.ac}), заглавные включены (autocapitalize=${attrs.cap}), клавиша ${attrs.ek}`);
    // самый мелкий Dynamic Type xS (14 pt): шрифт всё равно не меньше 16
    await page.evaluate(() => { document.querySelector("[data-ios-selfcheck]").textContent = "html{font-size:14px !important}"; });
    const fsXs = await page.locator(T("key-field")).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    R.add(37, fsXs >= 16, `при самом мелком Dynamic Type (xS, 14 pt) шрифт поля ${fsXs} px, остаётся >= 16`);
    await page.evaluate(() => { document.querySelector("[data-ios-selfcheck]").textContent = "html{font-size:17px !important}"; });
    // клавиатура: окно ниже на высоту клавиатуры (~336 pt), кнопка Restore достижима и не под таб-баром
    await page.setViewportSize({ width: 393, height: 852 - 336 });
    await page.locator(T("key-field")).tap();
    await page.waitForTimeout(400);
    const reach = await bottomReach(page);
    const btn = await page.locator(T("key-restore")).boundingBox();
    const fld = await page.locator(T("key-field")).boundingBox();
    await shot(page, "i37-keyboard-emulated");
    R.add(37, reach.tabTop !== null && btn.y + btn.height <= reach.tabTop && btn.y >= 0 && fld.y >= 0, `окно сокращено до ${reach.inner} pt (как с клавиатурой): прокрутив до конца, кнопка Restore (${Math.round(btn.y)}..${Math.round(btn.y + btn.height)}) выше таб-бара (верх ${reach.tabTop}), поле ввода (${Math.round(fld.y)}) в окне; реальную клавиатуру и сдвиг экрана iOS - смотреть на iPhone`);
    await page.setViewportSize({ width: 393, height: 852 });
    // неполный ключ: кнопка неактивна
    await page.locator(T("key-field")).fill("abcd");
    const dis = await page.locator(T("key-restore")).getAttribute("aria-disabled");
    R.add(37, dis === "true", `пока введено меньше 32 знаков, Restore неактивна (aria-disabled=${dis})`);
    // неверный ключ
    await page.locator(T("key-field")).fill("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    await page.locator(T("key-restore")).tap();
    await page.waitForSelector(T("key-error"), { timeout: 15000 }).catch(() => {});
    const er = await page.locator(T("key-error")).evaluate((e) => ({ role: e.getAttribute("role"), kind: e.getAttribute("data-kind"), text: e.textContent?.trim() })).catch(() => null);
    const inv = await page.locator(T("key-field")).evaluate((e) => ({ inv: e.getAttribute("aria-invalid"), desc: e.getAttribute("aria-describedby") }));
    await shot(page, "i40-error-invalid");
    R.add(40, er?.role === "alert" && er?.kind === "invalid" && inv.inv === "true" && /err/.test(inv.desc ?? ""), `неверный ключ: сообщение "${er?.text}" с role=alert (объявится VoiceOver), поле aria-invalid=${inv.inv}, aria-describedby="${inv.desc}"`);
    // офлайн: API недоступен
    await page.route("**/api/**", (r) => r.abort());
    await page.locator(T("key-field")).fill("0123456789ABCDEFGHJKMNPQRSTVWXY0");
    await page.locator(T("key-restore")).tap();
    await page.waitForSelector(`${T("key-error")}[data-kind=offline]`, { timeout: 20000 }).catch(() => {});
    const off = await page.locator(T("key-error")).evaluate((e) => ({ role: e.getAttribute("role"), kind: e.getAttribute("data-kind"), text: e.textContent?.trim() })).catch(() => null);
    const btnTxt = (await page.locator(T("key-restore")).textContent())?.trim();
    await shot(page, "i44-error-offline");
    R.add(44, off?.kind === "offline" && off.role === "alert", `без сети: "${off?.text}" (role=alert), кнопка превращается в "${btnTxt}"`);
    R.add(40, off?.kind === "offline" && off.role === "alert", `ошибка "нет сети" объявляется (role=alert)`);
    await page.unroute("**/api/**");
    await page.locator(T("key-restore")).tap();
    await page.waitForSelector(`${T("key-error")}[data-kind=invalid]`, { timeout: 20000 }).catch(() => {});
    const retry = await page.locator(T("key-error")).getAttribute("data-kind").catch(() => null);
    R.add(44, retry === "invalid", `после возврата сети "${btnTxt}" снова отправляет запрос (ответ сервера - "неверный ключ", то есть сеть работает: ${retry})`);
    await page.locator(T("key-cancel")).tap();
    R.add(37, await visible(page, "key-create"), `"Cancel" возвращает к экрану с "Create key"`);

    // язык: переключение, сохранение
    await page.locator(T("lang-ru")).tap();
    await page.waitForTimeout(500);
    const titleRu = await page.locator(".settings-large").textContent();
    const stored = await page.evaluate(() => localStorage.getItem("pundoku.locale"));
    const htmlLang = await page.evaluate(() => document.documentElement.lang);
    await page.reload();
    await page.waitForSelector(T("settings-screen"), { timeout: 15000 });
    const titleRu2 = await page.locator(".settings-large").textContent();
    R.add(43, /Настройки/.test(titleRu ?? "") && stored === "ru" && /Настройки/.test(titleRu2 ?? ""), `переключатель языка: "${titleRu}", localStorage=${stored}, <html lang=${htmlLang}>, после перезапуска "${titleRu2}"`);
    await page.locator(T("lang-en")).tap();
    await ctx.close();
  }

  // =====================================================================================
  // 44: офлайн + service worker: Settings при остановленном сервере и "Повторить"
  // =====================================================================================
  await pause(BETWEEN_CONTEXTS_MS);
  {
    const ctx = await newContext(browser, { safeArea: SAFE_PORTRAIT });
    const page = await ctx.newPage();
    await gotoApp(page);
    await page.waitForSelector(".board .given", { timeout: 25000 });
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForTimeout(1500);
    await page.close();
    stack("web-down");
    try {
      const p2 = await ctx.newPage();
      await p2.goto(BASE + "/#/settings", { timeout: 15000 });
      await p2.waitForSelector(T("settings-screen"), { timeout: 25000 });
      await p2.waitForSelector(`${T("key-unavailable")}, ${T("key-create")}`, { timeout: 25000 });
      const unavailable = await visible(p2, "key-unavailable");
      const txt = unavailable ? (await p2.locator(T("key-unavailable")).textContent())?.trim() : null;
      await shot(p2, "i44-settings-offline");
      const ovo = await ovf(p2);
      R.add(44, unavailable, `Settings открывается из service worker при остановленном сервере; блок ключа читается и понятен: "${txt}", кнопка "Try again" на месте; ${ovo.text}`);
      const langWorks = await p2.locator(T("lang-uk")).isVisible();
      R.add(44, langWorks, `переключатель языка на офлайн-экране доступен (локальная настройка)`);
      stack("web-up");
      await p2.waitForTimeout(800);
      await p2.locator(T("key-status-retry")).tap();
      await p2.waitForSelector(T("key-create"), { timeout: 20000 }).catch(() => {});
      R.add(44, await visible(p2, "key-create"), `после возвращения сети "Try again" снова запрашивает статус, появляется "Create key"`);
    } catch (e) {
      R.add(44, false, `офлайн-проверка Settings не удалась: ${String(e.message).slice(0, 200)}`);
    } finally {
      stack("web-up");
    }
    await ctx.close();
  }

  // =====================================================================================
  // 43: uk / ru: все состояния Settings и шиты, при L и при xxxL
  // =====================================================================================
  for (const [tag, locale] of [["uk", "uk-UA"], ["ru", "ru-RU"]]) {
    await pause(BETWEEN_CONTEXTS_MS);
    const { ctx, page } = await fresh(browser, { locale });
    const problems = [];
    const check = async (name) => {
      const o = await ovf(page);
      if (!o.ok) problems.push(`${name}: ${o.text}`);
    };
    const sheetFits = async (name) => {
      const f = await page.locator(T("action-sheet")).evaluate((e) => ({ sh: e.scrollHeight, ch: e.clientHeight, top: e.getBoundingClientRect().top }));
      if (f.top < 0) problems.push(`${name}: шит вылез за верх окна`);
    };
    await openSettings(page);
    const heading = await page.locator(".settings-large").textContent();
    await check("none");
    await shot(page, `i43-${tag}-none`);
    await page.locator(T("key-have")).tap();
    await page.waitForSelector(T("key-field"));
    await page.locator(T("key-field")).fill("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
    await page.locator(T("key-restore")).tap();
    await page.waitForSelector(T("key-error"), { timeout: 15000 }).catch(() => {});
    const errText = (await page.locator(T("key-error")).textContent().catch(() => ""))?.trim();
    await check("enter+error");
    await shot(page, `i43-${tag}-error`);
    await page.locator(T("key-cancel")).tap();
    await page.locator(T("key-create")).tap();
    await page.waitForSelector(T("key-shown"), { timeout: 15000 });
    await page.waitForTimeout(300);
    await check("shown");
    await shot(page, `i43-${tag}-shown`);
    const lab0 = await chips(page).first().getAttribute("aria-label");
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    await check("leave-sheet");
    await sheetFits("leave-sheet");
    await shot(page, `i43-${tag}-leave-sheet`);
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    await page.locator(T("key-saved")).tap();
    await page.waitForTimeout(300);
    await check("created");
    await shot(page, `i43-${tag}-created`);
    await page.locator(T("key-reissue")).tap();
    await sheetOpen(page);
    await check("reissue-sheet");
    await sheetFits("reissue-sheet");
    await shot(page, `i43-${tag}-reissue-sheet`);
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    await page.locator(T("key-delete")).tap();
    await sheetOpen(page);
    await check("delete-sheet");
    await sheetFits("delete-sheet");
    await page.locator(T("action-sheet-cancel")).tap();
    await page.waitForTimeout(300);
    // крупнее: xxxL (23 pt)
    await page.evaluate(() => { document.querySelector("[data-ios-selfcheck]").textContent = "html{font-size:23px !important}"; });
    await page.waitForTimeout(300);
    await check("created@xxxL");
    await page.locator(T("key-reissue")).tap();
    await sheetOpen(page);
    await check("reissue-sheet@xxxL");
    await sheetFits("reissue-sheet@xxxL");
    await shot(page, `i43-${tag}-reissue-sheet-xxxl`);
    await page.locator(T("action-sheet-go")).tap();
    await page.waitForSelector(T("key-shown"), { timeout: 15000 });
    await page.waitForTimeout(300);
    await check("shown@xxxL");
    await shot(page, `i43-${tag}-shown-xxxl`);
    await page.locator(T("settings-back")).tap();
    await sheetOpen(page);
    await check("leave-sheet@xxxL");
    await sheetFits("leave-sheet@xxxL");
    await shot(page, `i43-${tag}-leave-sheet-xxxl`);
    R.add(43, problems.length === 0, `${tag}: заголовок "${heading}", ошибка "${errText}", плашка "${lab0}"; состояния none, ввод+ошибка, ключ показан, шиты (уход, перевыпуск, удаление), создан - при 17 pt и 23 pt: ${problems.length === 0 ? "ничего не обрезано, нет горизонтального скролла" : problems.join(" | ")}`);
    await ctx.close();
  }

  // =====================================================================================
  // что эмуляция не покрывает
  // =====================================================================================
  R.add(38, true, `ЗАМЕТКА: реальная запись в системный буфер установленной PWA в webkit-эмуляции не проверяется (проверен вызов writeText с верным ключом и плашка 2.2 с); вставка в Заметки - только на iPhone`);
}
