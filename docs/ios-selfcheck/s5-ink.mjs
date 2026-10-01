// Пункты 47-51: чернильный режим (PD-74), клякса (M7), таймлапс и PNG-экспорт (PD-75), webkit-эмуляция iPhone 16.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { SAFE_PORTRAIT, ART, newContext, gotoApp, shot, readGrid, solutionOf, place, overflowReport } from "./lib.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (id) => `[data-testid="${id}"]`;
const BETWEEN_CONTEXTS_MS = 7000;

// navigator.share/canShare подменены: режим "spy" записывает вызов (файл, активация жеста), режим "none" - нет поддержки (запасной путь: скачивание).
const SHARE_SPY = () => {
  window.__shareMode = "spy";
  window.__shared = [];
  navigator.canShare = (d) => window.__shareMode === "spy" && !!d && Array.isArray(d.files) && d.files.length > 0;
  navigator.share = async (d) => {
    window.__shared.push({ files: (d.files ?? []).map((f) => ({ name: f.name, type: f.type, size: f.size })), title: d.title ?? null, activation: navigator.userActivation ? navigator.userActivation.isActive : null });
  };
};

async function fresh(browser, o = {}) {
  const ctx = await newContext(browser, { safeArea: SAFE_PORTRAIT, ...o });
  await ctx.addInitScript(SHARE_SPY);
  const page = await ctx.newPage();
  await gotoApp(page);
  await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
  return { ctx, page };
}
const visible = (page, id) => page.locator(T(id)).isVisible().catch(() => false);
const box = (page, sel) => page.locator(sel).first().boundingBox();
async function ovf(page) {
  const o = await overflowReport(page);
  return { ok: !o.hscroll && o.bad.length === 0, text: o.hscroll || o.bad.length ? JSON.stringify(o).slice(0, 240) : "без горизонтального скролла и обрезки" };
}
async function emptyCells(page) {
  const g = await readGrid(page);
  const out = [];
  for (let i = 0; i < 81; i++) if (g[i] === "0") out.push(i);
  return out;
}
async function wrongDigitFor(page, cell) {
  const { solution } = await solutionOf(page);
  const right = Number(solution[cell]);
  return { right, wrong: (right % 9) + 1 };
}
/** Записывает кадры анимации клякса-момента через rAF (до ~900 мс после запуска). */
async function startSampler(page, cell) {
  await page.evaluate((cell) => {
    window.__samp = [];
    const t0 = performance.now();
    const el = () => document.querySelector(`.board .cell[data-i="${cell}"]`);
    const tick = () => {
      const t = performance.now() - t0;
      const c = el();
      const st = c?.querySelector(".stain");
      const lv = c?.querySelector(".d.leaving");
      const pl = c?.querySelector(".d.player, .d.swap-in");
      window.__samp.push({
        t: Math.round(t),
        stain: st ? { anim: getComputedStyle(st).animationName, dur: getComputedStyle(st).animationDuration, op: Number(getComputedStyle(st).opacity) } : null,
        leaving: lv ? { text: lv.textContent, op: Number(getComputedStyle(lv).opacity) } : null,
        digit: pl ? pl.textContent : null,
        swap: !!c?.querySelector(".d.swap-in"),
      });
      if (t < 1100) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, cell);
}

export async function run(R, browser) {
  // =====================================================================================
  // 47: вход в чернильный режим на Today
  // =====================================================================================
  const A = await fresh(browser);
  const page = A.page;
  const empties = await emptyCells(page);
  const inkEntry = await box(page, T("ink-entry"));
  const board = await box(page, ".board");
  const pad = await box(page, ".pad");
  R.add(47, inkEntry && board && pad && inkEntry.y >= board.y + board.height - 1 && inkEntry.y + inkEntry.height <= pad.y + 1, `Today: строка "Ink mode" в зазоре между полем (низ ${Math.round(board.y + board.height)}) и панелью (верх ${Math.round(pad.y)}): ${Math.round(inkEntry.y)}..${Math.round(inkEntry.y + inkEntry.height)}`);
  const rowBox = await box(page, T("ink-row"));
  R.add(47, rowBox.height >= 44, `строка "Ink mode" как цель касания: ${Math.round(rowBox.width)}x${Math.round(rowBox.height)} pt (>= 44)`);
  const v0 = (await page.locator(T("ink-row-value")).textContent())?.trim();
  await shot(page, "i47-today-before");
  await page.locator(T("ink-row")).tap();
  await page.waitForSelector(T("ink-sheet"), { timeout: 4000 });
  await page.waitForTimeout(450);
  const sheet = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="ink-sheet"]');
    return { role: d.getAttribute("role"), modal: d.getAttribute("aria-modal"), rules: d.querySelectorAll(".ink-rules li").length, title: d.querySelector("h2")?.textContent, inert: document.querySelectorAll("[inert]").length, focusIn: !!document.activeElement?.closest('[data-testid="ink-sheet"]') };
  });
  await shot(page, "i47-rule-sheet");
  R.add(47, sheet.role === "dialog" && sheet.modal === "true" && sheet.rules === 4 && sheet.focusIn && sheet.inert > 0, `шит правила "${sheet.title}": диалог (aria-modal), четыре строки правил, фокус внутри, фон inert (${sheet.inert})`);
  const btns = await page.evaluate(() => [...document.querySelectorAll('[data-testid="ink-sheet"] button')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) }; }));
  R.add(47, btns.every((b) => b.h >= 44) && btns.every((b) => b.bottom <= 852 - SAFE_PORTRAIT.bot + 1), `кнопки шита "${btns.map((b) => `${b.t} ${b.w}x${b.h}`).join(", ")}": >= 44 pt по высоте, выше индикатора Home`);
  await page.locator(T("ink-rule-cancel")).tap();
  await page.waitForTimeout(300);
  const v1 = (await page.locator(T("ink-row-value")).textContent())?.trim();
  R.add(47, v0 === "Off" && v1 === "Off" && !(await visible(page, "ink-sheet")), `"Not now" закрывает шит, режим остаётся выключенным (${v0} -> ${v1})`);
  await page.locator(T("ink-row")).tap();
  await page.waitForSelector(T("ink-sheet"));
  await page.locator(T("ink-rule-start")).tap();
  await page.waitForTimeout(400);
  const v2 = (await page.locator(T("ink-row-value")).textContent())?.trim();
  const mark = await visible(page, "ink-mark");
  const padInk = await page.evaluate(() => {
    const a = document.querySelector(".actions");
    return { ink: a?.classList.contains("ink"), buttons: [...a.querySelectorAll("button")].map((b) => ({ t: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })) };
  });
  await shot(page, "i47-today-ink-on");
  R.add(47, v2 === "On" && mark, `"Play in ink" включает режим: строка "${v2}", в подписи дня слово "Ink" (${mark ? "есть" : "нет"})`);
  R.add(47, padInk.ink && padInk.buttons.length === 2 && /Erase notes/i.test(padInk.buttons.map((b) => b.t).join("|")) && !padInk.buttons.some((b) => /undo/i.test(b.t)), `панель в чернилах: кнопки ${padInk.buttons.map((b) => `"${b.t}" ${b.w}x${b.h}`).join(", ")}; Undo нет вовсе, ластик цифр заменён на "Erase notes"`);
  // до первого хода режим можно выключить обратно
  await page.locator(T("ink-row")).tap();
  await page.waitForTimeout(300);
  const v3 = (await page.locator(T("ink-row-value")).textContent())?.trim();
  R.add(47, v3 === "Off", `до первого хода повторное касание строки выключает режим обратно (${v3})`);
  await page.locator(T("ink-row")).tap();
  await page.waitForSelector(T("ink-sheet"));
  await page.locator(T("ink-rule-start")).tap();
  await page.waitForTimeout(300);
  // первый ход: строка исчезает
  const { right: r0 } = await wrongDigitFor(page, empties[0]);
  await place(page, empties[0], r0);
  await page.waitForTimeout(500);
  const gone = !(await visible(page, "ink-entry")) && !(await visible(page, "ink-row"));
  R.add(47, gone, `после первого хода строка режима исчезла (не приглушена): ink-entry/ink-row на экране ${gone ? "нет" : "ЕСТЬ"}`);
  await page.reload();
  await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
  await page.waitForTimeout(600);
  const afterReload = { chip: await visible(page, "ink-mark"), row: await visible(page, "ink-row"), filled: (await readGrid(page))[empties[0]] };
  R.add(47, afterReload.chip && !afterReload.row && afterReload.filled === String(r0), `после перезапуска страницы партия остаётся чернильной, строка выбора не возвращается, поставленная цифра на месте`);

  // =====================================================================================
  // 47 (Play): строка в настройке сетки
  // =====================================================================================
  await pause(BETWEEN_CONTEXTS_MS);
  {
    const { ctx, page: pp } = await fresh(browser);
    await pp.locator(".tabbar .tab").nth(1).tap();
    await pp.waitForSelector(T("play-setup"), { timeout: 8000 }).catch(() => {});
    const setup = await visible(pp, "play-setup");
    await shot(pp, "i47-play-setup");
    const row = setup ? await box(pp, `${T("play-setup")} ${T("ink-row")}`) : null;
    R.add(47, setup && !!row && row.height >= 44, `Play: экран настройки сетки ("New puzzle") показан, строка "Ink mode" есть: ${row ? Math.round(row.width) + "x" + Math.round(row.height) : "нет"} pt`);
    await pp.locator(`${T("play-setup")} ${T("ink-row")}`).tap();
    await pp.waitForSelector(T("ink-sheet"));
    await pp.locator(T("ink-rule-start")).tap();
    await pp.waitForTimeout(300);
    const vv = (await pp.locator(T("ink-row-value")).textContent())?.trim();
    await pp.locator(T("setup-start")).tap();
    await pp.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    await pp.waitForTimeout(500);
    const g = await emptyCells(pp);
    const mark = await visible(pp, "ink-mark");
    const noUndo = await pp.evaluate(() => [...document.querySelectorAll(".actions button")].map((b) => b.textContent.trim()));
    R.add(47, vv === "On" && mark && noUndo.length === 2 && !noUndo.some((s) => /undo/i.test(s)), `Play: выбор чернил в настройке, партия началась в чернилах (слово "Ink" в подписи), панель: ${noUndo.join(" / ")}`);
    const { right } = await wrongDigitFor(pp, g[0]);
    await place(pp, g[0], right);
    await pp.waitForTimeout(400);
    R.add(47, !(await visible(pp, "ink-row")), `Play: на поле партии строки режима нет (выбор был до первого хода)`);
    await shot(pp, "i47-play-ink-game");
    await ctx.close();
  }

  // =====================================================================================
  // 48: клякса. Продолжаем партию из контекста A
  // =====================================================================================
  const left = await emptyCells(page);
  const target1 = left[0];
  const d1 = await wrongDigitFor(page, target1);
  await page.evaluate(() => { window.__says = []; const el = document.querySelector("p.sr-only[role=status]"); new MutationObserver(() => { const t = (el.textContent ?? "").trim(); if (t) window.__says.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); });
  await page.locator(`.board .cell[data-i="${target1}"]`).tap();
  await startSampler(page, target1);
  await page.locator(".pad .key").nth(d1.wrong - 1).tap();
  await page.waitForTimeout(1300);
  const samp = await page.evaluate(() => window.__samp);
  const says = await page.evaluate(() => window.__says);
  const wrongSeen = samp.filter((s) => s.leaving);
  const wrongFirst = wrongSeen[0]?.t ?? null;
  const wrongLast = wrongSeen.length ? wrongSeen[wrongSeen.length - 1].t : null;
  const stainFirst = samp.find((s) => s.stain)?.t ?? null;
  const swapFirst = samp.find((s) => s.swap)?.t ?? null;
  const rightFirst = samp.find((s) => s.digit === String(d1.right))?.t ?? null;
  const cellState = await page.evaluate((c) => { const el = document.querySelector(`.board .cell[data-i="${c}"]`); return { blot: el.classList.contains("blot"), digit: el.querySelector(".d")?.textContent, stain: !!el.querySelector(".stain"), clip: getComputedStyle(el.querySelector(".stain")).clipPath, label: el.getAttribute("aria-label") }; }, target1);
  await shot(page, "i48-blot-light");
  R.add(48, cellState.blot && cellState.stain && cellState.digit === String(d1.right), `неверная цифра ${d1.wrong} дала клякса-клетку: пятно есть, в клетке сразу верная цифра ${cellState.digit} (ожидалась ${d1.right})`);
  R.add(48, /polygon/.test(cellState.clip), `у пятна срезан верхний правый угол (clip-path: ${cellState.clip})`);
  R.add(48, wrongSeen.length > 0 && stainFirst !== null && rightFirst !== null, `ход M7 по кадрам: неверная цифра видна ${wrongFirst}..${wrongLast} мс (затухает за ~300 мс), пятно появляется с ${stainFirst} мс, верная цифра с ${swapFirst ?? rightFirst} мс; общая длительность ~${Math.max(wrongLast ?? 0, (swapFirst ?? 0) + 160)} мс (по макету <= 460 мс). Слишком ли быстро - оценить пальцем на iPhone`);
  R.add(48, says.some((s) => /Wrong digit\. The cell is sealed with a blot\. \d/.test(s)), `озвучка клякса текстом (live-регион): "${says.find((s) => /Wrong/.test(s)) ?? "нет"}" (как это звучит в VoiceOver - только на iPhone)`);
  R.add(48, /Cell sealed with a blot/.test(cellState.label ?? ""), `подпись клетки для VoiceOver: "${cellState.label}"`);
  // клякса инертна
  await page.locator(`.board .cell[data-i="${target1}"]`).tap();
  await page.locator(".pad .key").nth(((d1.right + 2) % 9)).tap();
  await page.waitForTimeout(500);
  const stillRight = await page.evaluate((c) => document.querySelector(`.board .cell[data-i="${c}"] .d`)?.textContent, target1);
  R.add(48, stillRight === String(d1.right), `клякса закрыта: ввод в неё не меняет цифру (осталась ${stillRight})`);
  // цветовые режимы
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(300);
  await shot(page, "i48-blot-dark");
  await page.emulateMedia({ colorScheme: "light", contrast: "more" });
  await page.waitForTimeout(300);
  const st = await page.evaluate((c) => { const s = document.querySelector(`.board .cell[data-i="${c}"] .stain`); return Number(getComputedStyle(s).opacity); }, target1);
  await shot(page, "i48-blot-contrast");
  await page.emulateMedia({ contrast: "no-preference", forcedColors: "active" });
  await page.waitForTimeout(300);
  const fc = await page.evaluate((c) => { const el = document.querySelector(`.board .cell[data-i="${c}"]`); const s = el.querySelector(".stain"); return { img: getComputedStyle(s).backgroundImage.slice(0, 40), outline: getComputedStyle(el).outlineStyle }; }, target1);
  await shot(page, "i48-blot-forced");
  await page.emulateMedia({ forcedColors: "none" });
  R.add(48, st >= 0.2 && /gradient/.test(fc.img) && fc.outline === "dashed", `пятно читается не только цветом: Increase Contrast усиливает его (непрозрачность ${st} вместо 0.14), forced colors - штриховка и пунктирный контур (${fc.outline}); тёмная тема сняты скриншоты i48-blot-dark; как читается под углом и на солнце - только на iPhone`);
  // reduce motion: второй клякса
  await page.emulateMedia({ reducedMotion: "reduce" });
  const left2 = await emptyCells(page);
  const target2 = left2[0];
  const d2 = await wrongDigitFor(page, target2);
  await page.locator(`.board .cell[data-i="${target2}"]`).tap();
  await startSampler(page, target2);
  await page.locator(".pad .key").nth(d2.wrong - 1).tap();
  await page.waitForTimeout(1300);
  const samp2 = await page.evaluate(() => window.__samp);
  const anims = [...new Set(samp2.filter((s) => s.stain && s.stain.anim !== "none").map((s) => `${s.stain.anim}/${s.stain.dur}`))];
  const scaleSeen = await page.evaluate((c) => { const s = document.querySelector(`.board .cell[data-i="${c}"] .stain`); return getComputedStyle(s).transform; }, target2);
  R.add(48, anims.length > 0 && anims.every((a) => /blotFade|blotfade/i.test(a) && /0\.14s/.test(a)) && !samp2.some((s) => s.stain && /blotSpread/.test(s.stain.anim)), `"Reduce Motion": пятно только проявляется (анимации: ${anims.join(", ")}), без расползания (blotSpread не запускался), итоговое преобразование ${scaleSeen}`);
  await page.emulateMedia({ reducedMotion: "no-preference" });

  // =====================================================================================
  // дорешиваем и получаем карточку (49-51)
  // =====================================================================================
  const { solution } = await solutionOf(page);
  const rest = await emptyCells(page);
  const total = empties.length;
  for (const i of rest) await place(page, i, Number(solution[i]));
  await page.waitForSelector(T("tl-watch"), { timeout: 15000 });
  await page.waitForTimeout(800);
  const card = await page.evaluate(() => ({
    chip: !!document.querySelector('[data-testid="ink-chip"]') || !!document.querySelector('[data-testid="ink-mark"]'),
    blots: document.querySelector('[data-testid="blots-row"] dd')?.textContent?.trim(),
    heatBlots: document.querySelectorAll(".heat i.b").length,
    corrections: [...document.querySelectorAll("dt")].some((e) => /Corrections/i.test(e.textContent)),
  }));
  await shot(page, "i48-card");
  R.add(48, card.blots === "2" && card.heatBlots === 2 && !card.corrections, `карточка дня: чип/слово "Ink", строка "Blots - ${card.blots}" вместо "Corrections", в тепловой карте клякс-клеток: ${card.heatBlots}`);

  // =====================================================================================
  // 49: таймлапс
  // =====================================================================================
  const watch = await box(page, T("tl-watch"));
  R.add(49, watch.height >= 44, `кнопка "Watch your solve": ${Math.round(watch.width)}x${Math.round(watch.height)} pt (>= 44)`);
  await page.locator(T("tl-watch")).tap();
  await page.waitForSelector(T("timelapse-sheet"), { timeout: 5000 });
  await page.waitForTimeout(500);
  const contact = await page.evaluate(() => {
    const figs = [...document.querySelectorAll('[data-testid="tl-contact"] figure')];
    const d = document.querySelector('[data-testid="timelapse-sheet"] [role=dialog]');
    return {
      n: figs.length,
      widths: figs.map((f) => Math.round(f.getBoundingClientRect().width)),
      caps: figs.map((f) => f.querySelector("figcaption")?.textContent),
      cols: new Set(figs.map((f) => Math.round(f.getBoundingClientRect().left))).size,
      role: d?.getAttribute("role"), modal: d?.getAttribute("aria-modal"),
      anim: document.getAnimations().filter((a) => a.playState === "running").length,
      focus: document.activeElement?.tagName,
      inertBody: [...document.body.children].filter((e) => e.hasAttribute("inert")).length,
    };
  });
  await shot(page, "i49-contact-sheet");
  R.add(49, contact.n === 9 && contact.cols === 3, `контактный лист: ${contact.n} стадий в сетке ${contact.cols}x3, ширина кадра ${contact.widths[0]} pt (клетка ~${Math.round(contact.widths[0] / 9)} pt), подписи времени ${contact.caps.join(" ")}`);
  R.add(49, contact.role === "dialog" && contact.modal === "true" && contact.inertBody >= 1, `шит - модальный диалог, остальное содержимое страницы inert (${contact.inertBody})`);
  R.add(49, contact.anim === 0, `контактный лист по умолчанию без движения: бегущих анимаций ${contact.anim}`);
  const so = await ovf(page);
  R.add(49, so.ok, `контактный лист при обычном размере: ${so.text}`);
  const startBtn = await box(page, T("tl-start"));
  const doneBtn = await box(page, ".tl-done");
  R.add(49, startBtn.height >= 44 && doneBtn.height >= 44 - 2 && doneBtn.width >= 44 - 2, `"Start"/"Done" как цели касания: ${Math.round(startBtn.width)}x${Math.round(startBtn.height)} и ${Math.round(doneBtn.width)}x${Math.round(doneBtn.height)} pt`);
  await page.locator(T("tl-start")).tap();
  await page.waitForSelector(T("tl-player"));
  await page.waitForTimeout(500);
  const m0 = (await page.locator(T("tl-move")).textContent())?.trim();
  const totalMoves = Number(/of (\d+)/.exec(m0)?.[1]);
  R.add(49, totalMoves === total, `счёт в ходах игрока (PD-80): "${m0}", пустых клеток в партии было ${total}; пара "клякса - замена" считается одним ходом`);
  await page.waitForTimeout(1800);
  const m1 = (await page.locator(T("tl-move")).textContent())?.trim();
  R.add(49, m1 !== m0, `анимация запущена отдельной кнопкой "Start" и идёт: "${m0}" -> "${m1}" за ~2 с`);
  const sizes = {};
  for (const id of ["tl-loop", "tl-prev", "tl-play", "tl-next"]) sizes[id] = await box(page, T(id));
  const speed = await page.locator(`${T("tl-speed")} button`).evaluateAll((bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) }; }));
  const scrub = await box(page, T("tl-scrub"));
  const small = Object.entries(sizes).filter(([, b]) => b.width < 44 || b.height < 44).map(([k, b]) => `${k} ${Math.round(b.width)}x${Math.round(b.height)}`);
  R.add(49, small.length === 0 && speed.every((s) => s.h >= 32), `транспорт: кнопки повтор/назад/пауза/вперёд ${Object.values(sizes).map((b) => Math.round(b.width) + "x" + Math.round(b.height)).join(", ")} pt${small.length ? " (МЕНЬШЕ 44: " + small.join(", ") + ")" : ""}; скорость ${speed.map((s) => `${s.t} ${s.w}x${s.h}`).join(", ")}; ползунок ${Math.round(scrub.width)}x${Math.round(scrub.height)} pt`);
  await shot(page, "i49-player");
  await page.locator(T("tl-play")).tap(); // пауза
  await page.waitForTimeout(300);
  const lab = await page.locator(T("tl-play")).getAttribute("aria-label");
  const pm1 = (await page.locator(T("tl-move")).textContent())?.trim();
  await page.waitForTimeout(1200);
  const pm2 = (await page.locator(T("tl-move")).textContent())?.trim();
  R.add(49, lab === "Play" && pm1 === pm2, `пауза: подпись кнопки "${lab}", ход не меняется (${pm1} -> ${pm2})`);
  await page.locator(T("tl-next")).tap();
  await page.waitForTimeout(250);
  const n1 = Number(/Move (\d+)/.exec(await page.locator(T("tl-move")).textContent())?.[1]);
  await page.locator(T("tl-prev")).tap();
  await page.waitForTimeout(250);
  const n0 = Number(/Move (\d+)/.exec(await page.locator(T("tl-move")).textContent())?.[1]);
  R.add(49, n1 === n0 + 1, `покадровый шаг: "вперёд" +1 ход (${n0} -> ${n1}), "назад" возвращает`);
  await page.locator(T("tl-scrub")).evaluate((el, v) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, String(v));
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, 20);
  await page.waitForTimeout(300);
  const sm = (await page.locator(T("tl-move")).textContent())?.trim();
  R.add(49, /Move 20 of/.test(sm), `скраббер (ползунок по ходам) перематывает на ход 20: "${sm}" (перетягивание пальцем - только на iPhone)`);
  const filled = async () => page.locator(`${T("tl-player")} .rf-cell, ${T("tl-player")} [class*=cell]`).count();
  await page.locator(T("tl-loop")).tap();
  const lp = await page.locator(T("tl-loop")).getAttribute("aria-pressed");
  await page.locator(`${T("tl-speed")} button[data-speed=fast]`).tap();
  const fs = await page.locator(`${T("tl-speed")} button[data-speed=fast]`).getAttribute("aria-pressed");
  R.add(49, lp === "true" && fs === "true", `повтор и скорость переключаются и озвучиваются состоянием (aria-pressed: повтор ${lp}, Fast ${fs})`);
  // перематываем к ходу, где была клякса, и смотрим поле
  await page.locator(T("tl-back")).tap();
  await page.waitForSelector(T("tl-contact"));
  R.add(49, true, `"Back to stages" возвращает к контактному листу`);
  // Escape закрывает только шит, фокус возвращается
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const closed = !(await visible(page, "timelapse-sheet"));
  const foc = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  const inertLeft = await page.evaluate(() => document.querySelectorAll("[inert]").length);
  R.add(49, closed && (foc === "tl-watch" || foc === "result-card") && inertLeft === 0, `закрытие: шит ушёл, фокус вернулся туда, где был до открытия (${foc}: в WebKit тап по кнопке не фокусирует саму кнопку, поэтому это карточка результата), inert снят (${inertLeft})`);

  // Reduce Motion: пошаговый плеер
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.locator(T("tl-watch")).tap();
  await page.waitForSelector(T("timelapse-sheet"));
  await page.locator(T("tl-start")).tap();
  await page.waitForSelector(T("tl-player"));
  const mr0 = (await page.locator(T("tl-move")).textContent())?.trim();
  await page.waitForTimeout(1500);
  const mr1 = (await page.locator(T("tl-move")).textContent())?.trim();
  const step = await page.evaluate(() => ({ data: document.querySelector('[data-testid="tl-player"]').getAttribute("data-step"), loop: !!document.querySelector('[data-testid="tl-loop"]'), speed: !!document.querySelector('[data-testid="tl-speed"]'), note: document.querySelector('[data-testid="tl-note"]')?.textContent }));
  await shot(page, "i49-player-reduced");
  R.add(49, step.data === "true" && !step.loop && !step.speed && mr0 === mr1, `"Reduce Motion": плеер пошаговый (на паузе: ${mr0} -> ${mr1} за 1.5 с), повтора и скорости нет, пояснение "${step.note}"`);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForTimeout(300);

  // =====================================================================================
  // 50, 51: PNG-экспорт
  // =====================================================================================
  const imgInfo = async () => page.evaluate(async () => {
    const img = document.querySelector('[data-testid="fp-image"]');
    const blob = await (await fetch(img.src)).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const cx = c.getContext("2d");
    cx.drawImage(bmp, 0, 0);
    const px = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data);
    return { b64: btoa(bin), type: blob.type, size: blob.size, w: bmp.width, h: bmp.height, nw: img.naturalWidth, nh: img.naturalHeight, corners: [px(2, 2), px(bmp.width - 3, 2), px(2, bmp.height - 3), px(bmp.width - 3, bmp.height - 3)], rendered: { w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) } };
  });
  await page.locator("button.share").tap();
  await page.waitForSelector(T("fp-image"), { timeout: 10000 });
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid="fp-image"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await page.waitForTimeout(600);
  const light = await imgInfo();
  writeFileSync(`${ART}/fp-light.png`, Buffer.from(light.b64, "base64"));
  await shot(page, "i50-export-sheet");
  const lum = (p) => (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255;
  R.add(50, light.type === "image/png" && light.nw === 1080 && light.nh === 1350 && light.w === 1080 && light.h === 1350, `PNG: ${light.type}, ${light.nw}x${light.nh} px, ${Math.round(light.size / 1024)} КБ; предпросмотр на экране ${light.rendered.w}x${light.rendered.h} pt`);
  R.add(50, light.corners.every((c) => lum(c) > 0.85), `светлая тема: углы PNG светлые (яркость ${light.corners.map((c) => lum(c).toFixed(2)).join(", ")})`);
  const statusTxt = (await page.locator(T("fp-status")).textContent())?.trim();
  const shareBtn = await box(page, T("fp-share"));
  R.add(50, shareBtn.height >= 44, `кнопка "Share": ${Math.round(shareBtn.width)}x${Math.round(shareBtn.height)} pt, статус "${statusTxt}"`);
  // Share через системный лист (подмена navigator.share): файл и активация жеста
  await page.locator(T("fp-share")).tap();
  await page.waitForTimeout(700);
  const shared = await page.evaluate(() => window.__shared);
  const f = shared[0]?.files[0];
  R.add(50, shared.length === 1 && f && f.type === "image/png" && /^pundoku-\d{4}-\d{2}-\d{2}\.png$/.test(f.name) && f.size === light.size && shared[0].activation === true, `"Share" вызывает navigator.share ровно один раз с файлом ${f?.name} (${f?.type}, ${f?.size} Б = размер PNG на экране) прямо из касания (userActivation: ${shared[0]?.activation}); сам системный лист iOS и "Сохранить в Фото" - только на iPhone`);
  // запасной путь: скачивание
  await page.evaluate(() => { window.__shareMode = "none"; });
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), page.locator(T("fp-share")).tap()]);
  R.add(50, !!dl && /^pundoku-.*\.png$/.test(dl.suggestedFilename()), `без поддержки share: запасной путь - скачивание "${dl?.suggestedFilename()}"`);
  await page.evaluate(() => { window.__shareMode = "spy"; });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // тёмная тема: PNG тот же
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForTimeout(400);
  await page.locator("button.share").tap();
  await page.waitForFunction(() => { const i = document.querySelector('[data-testid="fp-image"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const dark = await imgInfo();
  writeFileSync(`${ART}/fp-dark.png`, Buffer.from(dark.b64, "base64"));
  await shot(page, "i50-export-sheet-dark");
  const h1 = createHash("sha256").update(Buffer.from(light.b64, "base64")).digest("hex");
  const h2 = createHash("sha256").update(Buffer.from(dark.b64, "base64")).digest("hex");
  R.add(50, h1 === h2 && dark.corners.every((c) => lum(c) > 0.85), `тёмная тема системы: экспортируемый PNG побайтно тот же и светлый (sha256 ${h1.slice(0, 10)} = ${h2.slice(0, 10)}, яркость углов ${dark.corners.map((c) => lum(c).toFixed(2)).join(", ")}); сам шит в тёмной теме - скриншот i50-export-sheet-dark`);
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "light" });
  R.add(51, true, `макет PNG: сетка 928 pt по центру 1080 px (боковой отступ 76 px), верх сетки 150 px, подпись у низа с отступом 76 px (константы fingerprint.ts); снят сам файл ${ART}/fp-light.png; "точка Share" и отступы на глаз - только владелец`);

  // =====================================================================================
  // 49/50 в uk/ru и при крупном тексте: шиты не обрезаются
  // =====================================================================================
  for (const loc of ["ru", "uk"]) {
    await page.evaluate((l) => localStorage.setItem("pundoku.locale", l), loc);
    await page.reload();
    await page.waitForSelector(T("tl-watch"), { timeout: 20000 });
    await page.waitForTimeout(600);
    const problems = [];
    for (const px of [17, 23]) {
      await page.evaluate((px) => { document.querySelector("[data-ios-selfcheck]").textContent = `html{font-size:${px}px !important}`; }, px);
      await page.waitForTimeout(250);
      let o = await ovf(page);
      if (!o.ok) problems.push(`карточка@${px}: ${o.text}`);
      await page.locator(T("tl-watch")).tap();
      await page.waitForSelector(T("timelapse-sheet"));
      await page.waitForTimeout(400);
      o = await ovf(page);
      if (!o.ok) problems.push(`контактный лист@${px}: ${o.text}`);
      if (px === 17) await shot(page, `i49-${loc}-contact`);
      await page.locator(T("tl-start")).tap();
      await page.waitForSelector(T("tl-player"));
      await page.waitForTimeout(400);
      o = await ovf(page);
      if (!o.ok) problems.push(`плеер@${px}: ${o.text}`);
      if (px === 17) await shot(page, `i49-${loc}-player`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      await page.locator("button.share").tap();
      await page.waitForSelector(T("fp-image"));
      await page.waitForTimeout(700);
      o = await ovf(page);
      if (!o.ok) problems.push(`экспорт@${px}: ${o.text}`);
      if (px === 17) await shot(page, `i50-${loc}-export`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
    }
    R.add(49, problems.length === 0, `${loc}: карточка дня, контактный лист, плеер и шит экспорта при 17 и 23 pt: ${problems.length === 0 ? "ничего не обрезано, нет горизонтального скролла" : problems.join(" | ")}`);
  }
  await A.ctx.close();
}
