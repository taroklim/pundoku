/**
 * PD-225 — живая проверка свайп-удаления строки режима на хабе Play (спецификация design/pd224-swipe-gestures.md, часть A;
 * приёмка §A11) на РЕАЛЬНОЙ сборке, chromium + webkit, контекст с касанием (hasTouch).
 *
 *   cd apps/web && pnpm build
 *   python3 -m http.server 5225 -d apps/web/dist &              # «после» (эта ветка)
 *   python3 -m http.server 5226 -d <dist main до PD-225> &        # «до» — только кадры разделителей «Продолжить»
 *   PD_PW_HOME=… BASE=http://localhost:5225 BEFORE=http://localhost:5226 node design/pd225-check.mjs
 *
 * Ввод: мышь (page.mouse — настоящие события) в обоих браузерах; касание — chromium через CDP `Input.dispatchTouchEvent`
 * (настоящий тач: touch-action, прокрутка, pointercancel), webkit — синтетические PointerEvent `pointerType: "touch"` (у
 * Playwright для webkit нет протяжки пальцем; браузерная прокрутка там не участвует — это отмечено в выводе).
 *
 * Проверки (§A11): 1 частичный свайп → открыта / < A/2 → закрыта; 2 тап по другой строке при открытой — закрыта, другая не
 * открылась; 3 полный свайп → слот null в IDB, описание, тост; «Отменить» → слот байт в байт; 4 за T и назад ниже T−24 — не
 * удаляет; 5 вертикаль под крутым углом — строка не едет, хаб прокручивается; 6 слева направо / строка без игры — ничего;
 * 7 клавиатура Delete → Enter → фокус на «Отменить», тост не гаснет; 8 меню «Удалить сетку» красным последним; 9 удаление
 * запаркованной партии → тап по строке — шит режима; 10 Reduce Motion, 320/AX3, light/dark, en/uk/ru — без переполнения.
 * Плюс: разделители «Продолжить» до/после переноса на .srow. Кадры — design/pd225-shots/. Никаких pkill: браузеры в finally.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PW_HOME = process.env.PD_PW_HOME || "/tmp/pundoku-qa/pw";
if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(PW_HOME, "browsers"))) process.env.PLAYWRIGHT_BROWSERS_PATH = join(PW_HOME, "browsers");
function loadPlaywright() {
  for (const b of [process.cwd() + "/", PW_HOME + "/"]) {
    try {
      return createRequire(b)("playwright");
    } catch {
      /* следующий */
    }
  }
  console.error("Playwright не найден (cwd, " + PW_HOME + ")");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();

const BASE = process.env.BASE ?? "http://localhost:5225";
const BEFORE = process.env.BEFORE ?? "";
const ONLY = process.env.ONLY ?? ""; // "cr" | "wk" — один браузер (отладка)
const OUT = join(HERE, "pd225-shots");
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/\.png$/.test(f)) rmSync(join(OUT, f), { force: true });

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const note = (s) => console.log("NOTE  " + s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w ?? 390, height: c.h ?? 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    colorScheme: c.scheme ?? "light",
    reducedMotion: c.reduced ? "reduce" : "no-preference",
    locale: "en-US",
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ lang }) => {
      try {
        if (!localStorage.getItem("pundoku.locale")) localStorage.setItem("pundoku.locale", lang);
        const fs = Number(localStorage.getItem("pd225.fs") || 0);
        if (fs) {
          const add = () => {
            const s = document.createElement("style");
            s.textContent = `html{font-size:${fs}px !important}`;
            document.documentElement.appendChild(s);
          };
          if (document.documentElement) add();
          else document.addEventListener("DOMContentLoaded", add);
        }
      } catch {
        /* приватный режим */
      }
    },
    { lang: c.lang ?? "en" },
  );
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|501|net::|access control/.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs };
}

const BOARD = ".play:not(.today) .board";
async function toHub(page, base) {
  await page.goto("about:blank"); // иначе переход только по хешу — без перезагрузки (язык/размер текста не применились бы)
  await page.goto(`${base}/#/play`);
  await page.locator('[data-testid="mode-classic"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(400);
}
async function backToHub(page) {
  await page.locator("#tab-play").click();
  await page.locator('[data-testid="hub-scroll"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
}
/** Свободная партия режима с одним ходом, затем на хаб тапом по вкладке (партия паркуется). */
async function startGame(page, mode) {
  await page.locator(`[data-testid="mode-${mode}"]`).click();
  await page.locator('[data-testid="sheet-start"]').waitFor();
  await page.waitForTimeout(350);
  await page.locator('[data-testid="difficulty-easy"]').click();
  await page.locator('[data-testid="sheet-start"]').click();
  await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(500);
  await placeAny(page, BOARD, ".play:not(.today) .pad .key");
  await backToHub(page);
}
async function placeAny(page, board, keys) {
  const empty = await page.evaluate((b) => {
    for (const c of document.querySelectorAll(`${b} .cell`)) if (!c.querySelector(".d.given")) return c.getAttribute("data-i");
    return null;
  }, board);
  await page.locator(`${board} .cell[data-i="${empty}"]`).click();
  await page.locator(keys).nth(4).click();
  await page.waitForTimeout(300);
}
/** «Продолжить»: день Today с ходом и Лжец дня с ходом — две строки (разделитель между ними). */
async function setupContinue(page) {
  try {
    await page.locator("#tab-today").click();
    await page.locator(".play.today .board .cell .d.given").first().waitFor({ timeout: 45000 });
    await page.waitForTimeout(500);
    await placeAny(page, ".play.today .board", ".play.today .pad .key");
    await page.locator("#tab-play").click();
    await page.waitForTimeout(500);
    await page.locator('[data-testid="mode-liar"]').click();
    await page.locator('[data-testid="liar-daily"]').click();
    await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(500);
    await placeAny(page, BOARD, ".play:not(.today) .pad .key");
    await backToHub(page);
    return (await page.locator('[data-testid="hub-continue"] .hub-row').count()) === 2;
  } catch (e) {
    note("setupContinue: " + e.message.split("\n")[0]);
    return false;
  }
}

const idb = (page, key) =>
  page.evaluate(
    (key) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("pundoku");
        r.onsuccess = () => {
          const db = r.result;
          const g = db.transaction("kv", "readonly").objectStore("kv").get(key);
          g.onsuccess = () => {
            res(g.result === undefined || g.result === null ? null : JSON.stringify(g.result));
            db.close();
          };
          g.onerror = () => rej(g.error);
        };
        r.onerror = () => rej(r.error);
      }),
    key,
  );
const slotKey = (m) => `meta:playGame:${m}`;

/** Состояние строки: сдвиг, armed, ширина кнопки, геометрия и что сейчас видно. */
const rowState = (page, mode) =>
  page.evaluate((m) => {
    const w = document.querySelector(`[data-testid="srow-${m}"]`);
    const fg = w.querySelector(".fg");
    const del = w.querySelector(".del");
    const tr = getComputedStyle(fg).transform;
    const x = tr === "none" ? 0 : new DOMMatrix(tr).m41;
    const dr = del.getBoundingClientRect();
    const dl = del.querySelector(".dl");
    return {
      x: Math.round(x),
      inline: fg.style.transform,
      transition: fg.style.transition,
      armed: w.classList.contains("armed"),
      iconOnly: w.classList.contains("icon-only"),
      aw: parseFloat(getComputedStyle(w).getPropertyValue("--aw")) || null,
      W: w.clientWidth,
      delH: dr.height,
      delW: dr.width,
      delHidden: del.hidden,
      labelW: dl.scrollWidth,
      status: !!document.querySelector(`[data-testid="mode-status-${m}"]`),
      desc: !!document.querySelector(`[data-testid="mode-desc-${m}"]`),
      toast: !!document.querySelector('[data-testid="undo-toast"]:not(.out)'),
      sheet: !!document.querySelector('[data-testid="mode-sheet"]'),
      board: !!document.querySelector(`${".play:not(.today) .board"}`) && !document.querySelector('[data-testid="hub-scroll"]'),
      active: document.activeElement?.getAttribute("data-testid") ?? document.activeElement?.tagName,
    };
  }, mode);

/** Мышью: от правого края строки (−40) на `dx` (отрицательный — влево). `hold` — не отпускать; `pause` — без броска. */
async function mouseDrag(page, mode, dx, { hold = false, pause = 160, steps = 10, back = null } = {}) {
  const b = await page.locator(`[data-testid="mode-${mode}"]`).boundingBox();
  const x0 = b.x + b.width - 40;
  const y = b.y + b.height / 2;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 + dx, y, { steps });
  if (back !== null) await page.mouse.move(x0 + back, y, { steps });
  if (hold) return async () => {
    await page.waitForTimeout(pause);
    await page.mouse.up();
  };
  await page.waitForTimeout(pause);
  await page.mouse.up();
  await page.waitForTimeout(350);
  return null;
}

/** Касание: chromium — настоящий тач через CDP; webkit — синтетические PointerEvent (pointerType touch). */
async function touchDrag(page, cdp, mode, pts) {
  const b = await page.locator(`[data-testid="mode-${mode}"]`).boundingBox();
  const at = ([dx, dy]) => ({ x: b.x + b.width - 40 + dx, y: b.y + b.height / 2 + dy });
  if (cdp) {
    const p0 = at(pts[0]);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p0.x, y: p0.y }] });
    for (const p of pts.slice(1)) {
      await sleep(16);
      const q = at(p);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: q.x, y: q.y }] });
    }
    await sleep(160);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await page.evaluate(
      async ({ m, pts }) => {
        const el = document.querySelector(`[data-testid="mode-${m}"]`);
        const fire = (type, p) =>
          el.dispatchEvent(
            new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", isPrimary: true, clientX: p.x, clientY: p.y, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1 }),
          );
        fire("pointerdown", pts[0]);
        for (const p of pts.slice(1)) {
          await new Promise((r) => setTimeout(r, 16));
          fire("pointermove", p);
        }
        await new Promise((r) => setTimeout(r, 160));
        fire("pointerup", pts[pts.length - 1]);
      },
      { m: mode, pts: pts.map(at) },
    );
  }
  await page.waitForTimeout(400);
}

const shot = (page, name, clip) => page.screenshot({ path: join(OUT, `${name}.png`), ...(clip ? { clip } : {}) });

/** Тост и строки: ничего не вылезает, цели ≥ 44, тост над таб-баром, хаб без горизонтальной прокрутки. */
const layoutProblems = (page, mode) =>
  page.evaluate((m) => {
    const p = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) p.push("document horizontal overflow");
    const hub = document.querySelector('[data-testid="hub-scroll"]');
    if (hub && hub.scrollWidth > hub.clientWidth + 1) p.push("hub scrolls horizontally");
    const w = document.querySelector(`[data-testid="srow-${m}"]`);
    if (w) {
      const del = w.querySelector(".del");
      if (!del.hidden && del.getBoundingClientRect().height < 44) p.push("delete < 44");
      const aw = parseFloat(getComputedStyle(w).getPropertyValue("--aw"));
      if (!w.classList.contains("icon-only") && w.querySelector(".dl").scrollWidth > aw - 16) p.push("delete label wider than A");
    }
    const toast = document.querySelector('[data-testid="undo-toast"]');
    if (toast) {
      const r = toast.getBoundingClientRect();
      const tb = document.querySelector(".tabbar").getBoundingClientRect();
      if (r.bottom > tb.top + 0.5) p.push("toast overlaps tab bar");
      if (r.left < -0.5 || r.right > de.clientWidth + 0.5 || r.top < 0) p.push("toast outside viewport");
      const tt = toast.querySelector(".tt");
      if (tt.scrollWidth > tt.clientWidth + 1) p.push("toast text clipped");
      const u = toast.querySelector(".tu").getBoundingClientRect();
      if (u.width < 44 || u.height < 44) p.push("undo < 44");
      if (u.right > r.right + 0.5) p.push("undo outside toast");
    }
    return p;
  }, mode);

/** Разделитель «Продолжить» (между днём и Лжецом дня) и строк режимов: computed `::before`. */
const separators = (page) =>
  page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el, "::before");
      return { content: s.content, left: s.left, height: s.height, top: s.top, bg: s.backgroundColor, transform: s.transform };
    };
    return {
      cont: pick(document.querySelector('[data-testid="hub-continue"] .hub-row + .hub-row')),
      contFirst: pick(document.querySelector('[data-testid="hub-continue"] .hub-row')),
      modeRow: pick(document.querySelector('[data-testid="hub-modes"] .srow + .srow') ?? document.querySelector('[data-testid="hub-modes"] .hub-row + .hub-row')),
    };
  });

async function continueShots(type, bn, base, tag, scheme) {
  const browser = await type.launch();
  try {
    const { ctx, page, errs } = await open(browser, { scheme });
    await toHub(page, base);
    const two = await setupContinue(page);
    ok(`${bn} ${tag} ${scheme}: «Продолжить» — две строки (день + Лжец дня)`, two);
    const sec = await page.locator('[data-testid="hub-continue"]').boundingBox();
    const modes = await page.locator('[data-testid="hub-modes"]').boundingBox();
    if (sec && modes) await shot(page, `${bn}-continue-${tag}-390-${scheme}`, { x: 0, y: sec.y - 4, width: 390, height: modes.y + modes.height - sec.y + 8 });
    const sep = await separators(page);
    ok(`${bn} ${tag} ${scheme}: errors`, errs.length === 0, errs.slice(0, 2).join(" | "));
    await ctx.close();
    return sep;
  } finally {
    await browser.close();
  }
}

async function mainFlow(type, bn) {
  const browser = await type.launch();
  try {
    const { ctx, page, errs } = await open(browser, {});
    const cdp = bn === "cr" ? await ctx.newCDPSession(page) : null;
    await toHub(page, BASE);
    await startGame(page, "classic");
    await startGame(page, "glyphs"); // последняя — «запаркована» за хабом живой (§A11 п. 9)
    ok(`${bn}: обе партии в слотах`, (await idb(page, slotKey("classic"))) !== null && (await idb(page, slotKey("glyphs"))) !== null);
    await shot(page, `${bn}-closed-390-light-en`);

    // 1. Частичный свайп: кадр во время ведения, отпустили ≥ A/2 → открыта, партия на месте.
    let s0 = await rowState(page, "classic");
    const release = await mouseDrag(page, "classic", -60, { hold: true });
    const mid = await rowState(page, "classic");
    ok(`${bn} §1: строка едет за мышью 1:1`, Math.abs(mid.x + 50) <= 2, `x=${mid.x}`); // −60 минус slop 10
    await shot(page, `${bn}-partial-390-light-en`);
    await release();
    await page.waitForTimeout(400);
    let st = await rowState(page, "classic");
    ok(`${bn} §1: отпустили ≥ A/2 → открыта на −A`, st.x === -st.aw && st.aw >= 80, `x=${st.x} A=${st.aw} W=${st.W}`);
    ok(`${bn} §1: открыта — партия на месте, статус, без тоста`, st.status && !st.toast && (await idb(page, slotKey("classic"))) !== null);
    await shot(page, `${bn}-open-390-light-en`);

    // 2. Тап по другой строке при открытой: закрылась, другая НЕ открылась (шита/партии нет).
    await page.locator('[data-testid="mode-melody"]').click();
    await page.waitForTimeout(400);
    st = await rowState(page, "classic");
    ok(`${bn} §2: тап по другой строке — открытая закрылась, другая не открылась`, st.x === 0 && !st.sheet && !st.board, JSON.stringify({ x: st.x, sheet: st.sheet }));
    // тап по самой открытой строке — закрывает, партию не открывает
    await mouseDrag(page, "classic", -70);
    await page.locator('[data-testid="mode-classic"]').click({ position: { x: 160, y: 20 } });
    await page.waitForTimeout(400);
    st = await rowState(page, "classic");
    ok(`${bn} §2: тап по открытой строке — закрыта, партия не открыта`, st.x === 0 && !st.board && !st.sheet);

    // 1b. < A/2 → закрылась
    await mouseDrag(page, "classic", -40); // −30 < A/2
    st = await rowState(page, "classic");
    ok(`${bn} §1: < A/2 → закрылась`, st.x === 0, `x=${st.x}`);

    // 3. Полный свайп → IDB null, описание, тост; «Отменить» → байт в байт.
    const before = await idb(page, slotKey("classic"));
    const W = st.W;
    const rel3 = await mouseDrag(page, "classic", -Math.round(W * 0.8), { hold: true });
    st = await rowState(page, "classic");
    ok(`${bn} §3: за T — armed`, st.armed, `x=${st.x}`);
    await shot(page, `${bn}-armed-390-light-en`);
    await rel3();
    await page.waitForTimeout(500);
    st = await rowState(page, "classic");
    const after = await idb(page, slotKey("classic"));
    ok(`${bn} §3: полный свайп удалил: слот null в IDB, строка с описанием, строка на месте, тост`, after === null && st.desc && st.x === 0 && st.toast, JSON.stringify({ after, desc: st.desc, x: st.x, toast: st.toast }));
    ok(`${bn} §3: красный слой снят после доводки`, st.delHidden);
    await shot(page, `${bn}-undo-390-light-en`);
    ok(`${bn} §3: тост — раскладка`, (await layoutProblems(page, "classic")).length === 0, (await layoutProblems(page, "classic")).join(", "));
    await page.locator('[data-testid="undo-toast-action"]').click();
    await page.waitForTimeout(500);
    st = await rowState(page, "classic");
    ok(`${bn} §3: «Отменить» — слот байт в байт, статус снова`, (await idb(page, slotKey("classic"))) === before && st.status && !st.toast);
    const live = await page.locator('[data-testid="undo-toast-live"]').textContent();
    ok(`${bn} §3: объявление «восстановлена»`, /restored/.test(live ?? ""), live);

    // 4. За T и назад ниже T − 24 → не удаляет.
    const T = Math.round(Math.max(0.55 * W, st.aw + 72));
    await mouseDrag(page, "classic", -Math.round(W * 0.8), { back: -(T - 60) + 10 });
    st = await rowState(page, "classic");
    ok(`${bn} §4: вперёд за T и назад ниже T−24 — не удалено`, (await idb(page, slotKey("classic"))) === before && st.status && !st.toast, `x=${st.x}`);
    await page.locator('[data-testid="hub-foot"]').click();
    await page.waitForTimeout(400);

    // 6. Слева направо на закрытой; строка без игры; строка «Продолжить» (если есть) — ничего.
    await mouseDrag(page, "classic", +80);
    st = await rowState(page, "classic");
    ok(`${bn} §6: слева направо на закрытой — не двигается`, st.x === 0 && !st.board && !st.sheet);
    await mouseDrag(page, "melody", -150);
    const mel = await rowState(page, "melody");
    ok(`${bn} §6: строка без игры не свайпается`, mel.x === 0 && mel.delHidden && !mel.sheet, JSON.stringify({ x: mel.x, sheet: mel.sheet }));

    // Касание: полный свайп пальцем → удалено; «Отменить».
    await touchDrag(page, cdp, "classic", [[0, 0], [-12, 0], [-60, 2], [-140, 3], [-230, 4], [-280, 4]]);
    st = await rowState(page, "classic");
    ok(`${bn} касание: полный свайп пальцем удалил + тост (${cdp ? "CDP touch" : "синтетический touch-pointer"})`, (await idb(page, slotKey("classic"))) === null && st.toast);
    await page.locator('[data-testid="undo-toast-action"]').tap();
    await page.waitForTimeout(500);
    ok(`${bn} касание: «Отменить» тапом — вернулась`, (await idb(page, slotKey("classic"))) === before);
    await touchDrag(page, cdp, "classic", [[0, 0], [-12, 0], [-50, 1], [-70, 1]]);
    st = await rowState(page, "classic");
    ok(`${bn} касание: частичный свайп пальцем — открыта`, st.x === -st.aw, `x=${st.x}`);
    await page.touchscreen.tap(30, 760);
    await page.waitForTimeout(400);
    ok(`${bn} касание: тап вне строки закрыл`, (await rowState(page, "classic")).x === 0);

    // 7. Клавиатура: Delete → «Удалить» в фокусе, строка открыта; Enter → удалено, фокус на «Отменить», тост не гаснет.
    await page.locator('[data-testid="mode-classic"]').focus();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(400);
    st = await rowState(page, "classic");
    ok(`${bn} §7: Delete — фокус на «Удалить», строка открыта`, st.active === "del-classic" && st.x === -st.aw, `${st.active} x=${st.x}`);
    await shot(page, `${bn}-kbd-390-light-en`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    st = await rowState(page, "classic");
    ok(`${bn} §7: Esc — закрыта, фокус на строке`, st.active === "mode-classic" && st.x === 0);
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(300);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    st = await rowState(page, "classic");
    ok(`${bn} §7: Enter — удалено, фокус на «Отменить»`, (await idb(page, slotKey("classic"))) === null && st.active === "undo-toast-action");
    await page.waitForTimeout(7000);
    ok(`${bn} §7: пока фокус в тосте — не гаснет (7 с)`, (await rowState(page, "classic")).toast);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    st = await rowState(page, "classic");
    ok(`${bn} §7: «Отменить» с клавиатуры — восстановлена, фокус на строке`, (await idb(page, slotKey("classic"))) === before && st.active === "mode-classic");

    // 8. Меню долгого нажатия: «Удалить сетку» последним, красным → удаление + тост.
    const rb = await page.locator('[data-testid="mode-classic"]').boundingBox();
    await page.mouse.move(rb.x + 100, rb.y + rb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.locator('[data-testid="ctx-menu"]').waitFor();
    await page.waitForTimeout(300);
    const menu = await page.evaluate(() => {
      const items = [...document.querySelectorAll('[data-testid="ctx-menu"] [role="menuitem"]')];
      const d = document.querySelector('[data-testid="ctx-delete"]');
      const wax = getComputedStyle(document.documentElement).getPropertyValue("--wax").trim();
      const probe = document.createElement("i");
      probe.style.color = wax;
      document.body.append(probe);
      const waxRgb = getComputedStyle(probe).color;
      probe.remove();
      return { last: items.at(-1) === d, color: d && getComputedStyle(d).color, waxRgb, text: d?.textContent };
    });
    ok(`${bn} §8: «Delete puzzle» последним пунктом, цветом --wax`, menu.last && menu.color === menu.waxRgb && menu.text === "Delete puzzle", JSON.stringify(menu));
    await shot(page, `${bn}-menu-390-light-en`);
    await page.locator('[data-testid="ctx-delete"]').click();
    await page.waitForTimeout(500);
    st = await rowState(page, "classic");
    ok(`${bn} §8: пункт меню удалил + тост`, (await idb(page, slotKey("classic"))) === null && st.toast);
    await page.locator('[data-testid="undo-toast-action"]').click();
    await page.waitForTimeout(400);

    // 9. Запаркованная живая партия (Глифы): удалить → тап по строке открывает шит режима, а не удалённую партию.
    await mouseDrag(page, "glyphs", -Math.round(W * 0.8));
    ok(`${bn} §9: Глифы удалены`, (await idb(page, slotKey("glyphs"))) === null);
    await page.locator('[data-testid="mode-glyphs"]').click();
    await page.waitForTimeout(500);
    const sh = await page.evaluate(() => document.querySelector('[data-testid="mode-sheet"]')?.getAttribute("data-mode") ?? null);
    const g = await rowState(page, "glyphs");
    ok(`${bn} §9: тап по строке — шит режима (не удалённая партия); тост ушёл`, sh === "glyphs" && !g.toast, `sheet=${sh}`);
    await page.locator('[data-testid="sheet-cancel"]').click();
    await page.waitForTimeout(400);

    // 5 + 10. 320×568: вертикаль, раскладка по языкам/темам/AX3.
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(400);
    const sc0 = await page.evaluate(() => document.querySelector('[data-testid="hub-scroll"]').scrollTop);
    await touchDrag(page, cdp, "classic", [[0, 0], [-4, -8], [-8, -16], [-14, -40], [-20, -90], [-24, -140]]);
    const sc1 = await page.evaluate(() => document.querySelector('[data-testid="hub-scroll"]').scrollTop);
    st = await rowState(page, "classic");
    ok(`${bn} §5: вертикаль под крутым углом — строка не двигается, не удалено`, st.x === 0 && (await idb(page, slotKey("classic"))) === before && !st.sheet && !st.board);
    if (cdp) ok(`${bn} §5: хаб прокрутился (настоящий тач)`, sc1 > sc0, `scrollTop ${sc0} → ${sc1}`);
    else note(`${bn} §5: прокрутка браузером не проверяема синтетикой (webkit) — проверено только «строка не едет»`);
    await page.evaluate(() => document.querySelector('[data-testid="hub-scroll"]').scrollTo(0, 0));

    const combos =
      bn === "cr"
        ? [
            ...["en", "uk", "ru"].flatMap((lang) => ["light", "dark"].flatMap((scheme) => [{ w: 320, h: 568, lang, scheme, fs: 0 }, { w: 320, h: 568, lang, scheme, fs: 40 }])),
            ...["en", "uk", "ru"].map((lang) => ({ w: 390, h: 844, lang, scheme: lang === "en" ? "dark" : "light", fs: 0 })),
            { w: 390, h: 844, lang: "ru", scheme: "light", fs: 40 },
            { w: 430, h: 932, lang: "uk", scheme: "dark", fs: 0 },
          ]
        : [
            { w: 320, h: 568, lang: "ru", scheme: "dark", fs: 40 },
            { w: 320, h: 568, lang: "uk", scheme: "light", fs: 0 },
            { w: 390, h: 844, lang: "en", scheme: "dark", fs: 0 },
          ];
    for (const c of combos) {
      await page.setViewportSize({ width: c.w, height: c.h });
      await page.emulateMedia({ colorScheme: c.scheme });
      await page.evaluate(({ lang, fs }) => {
        localStorage.setItem("pundoku.locale", lang);
        localStorage.setItem("pd225.fs", String(fs));
      }, c);
      await toHub(page, BASE);
      const tag = `${c.w}-${c.scheme}-${c.lang}${c.fs ? "-ax3" : ""}`;
      await page.locator('[data-testid="srow-classic"]').scrollIntoViewIfNeeded();
      await mouseDrag(page, "classic", -70);
      st = await rowState(page, "classic");
      const p1 = await layoutProblems(page, "classic");
      const Tc = Math.round(Math.max(0.55 * st.W, st.aw + 72));
      ok(`${bn} §10 ${tag}: открыта, без переполнения, «Удалить» ≥ 44, T < W`, st.x === -st.aw && p1.length === 0 && Tc < st.W, `A=${st.aw}${st.iconOnly ? " (значок)" : ""} W=${st.W} T=${Tc} ${p1.join(", ")}`);
      await shot(page, `${bn}-open-${tag}`);
      await page.locator('[data-testid="del-classic"]').click();
      await page.waitForTimeout(600);
      const p2 = await layoutProblems(page, "classic");
      ok(`${bn} §10 ${tag}: тост — над таб-баром, текст не обрезан, «Отменить» ≥ 44`, (await rowState(page, "classic")).toast && p2.length === 0, p2.join(", "));
      await shot(page, `${bn}-undo-${tag}`);
      await page.locator('[data-testid="undo-toast-action"]').click();
      await page.waitForTimeout(400);
    }
    await page.evaluate(() => {
      localStorage.setItem("pundoku.locale", "en");
      localStorage.setItem("pd225.fs", "0");
    });

    // 10. Reduce Motion: доводка мгновенная (transition none), тост — только прозрачность (длительность × .72).
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await toHub(page, BASE);
    await mouseDrag(page, "classic", -70, { pause: 160 });
    st = await rowState(page, "classic");
    ok(`${bn} §10 Reduce Motion: открыта мгновенно (transition none)`, st.x === -st.aw && st.transition === "none", `transition=${st.transition}`);
    await shot(page, `${bn}-open-390-light-en-rm`);
    await page.locator('[data-testid="del-classic"]').click();
    await page.waitForTimeout(50);
    const anim = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="undo-toast"]');
      const s = getComputedStyle(t);
      return { dur: s.animationDuration, mo: getComputedStyle(document.documentElement).getPropertyValue("--mo").trim() };
    });
    st = await rowState(page, "classic");
    ok(`${bn} §10 Reduce Motion: строка сразу на месте, тост 144 мс без сдвига (--mo 0)`, st.x === 0 && /0?\.144s|144ms/.test(anim.dur) && anim.mo === "0", JSON.stringify(anim));
    await page.waitForTimeout(400);
    await shot(page, `${bn}-undo-390-light-en-rm`);
    await page.locator('[data-testid="undo-toast-action"]').click();
    await page.waitForTimeout(300);

    ok(`${bn}: ошибок в консоли нет`, errs.length === 0, errs.slice(0, 3).join(" | "));
    await ctx.close();
  } finally {
    await browser.close();
  }
}

const browsers = [
  ["cr", chromium],
  ["wk", webkit],
].filter(([bn]) => !ONLY || ONLY === bn);
for (const [bn, type] of browsers) {
  try {
    await mainFlow(type, bn);
  } catch (e) {
    ok(`${bn}: сценарий без исключений`, false, e.message.split("\n").slice(0, 14).join(" | "));
  }
}
// Разделители «Продолжить» до/после переноса разделителя строк режимов на .srow (вопрос designer'а №3).
for (const [bn, type] of browsers.filter(([b]) => b === "cr" && !process.env.NO_CONT)) {
  for (const scheme of ["light", "dark"]) {
    try {
      const a = await continueShots(type, bn, BASE, "after", scheme);
      if (BEFORE) {
        const b = await continueShots(type, bn, BEFORE, "before", scheme);
        ok(`${bn} ${scheme}: разделитель «Продолжить» тот же, что до PD-225`, JSON.stringify(a.cont) === JSON.stringify(b.cont) && a.cont?.content !== "none", `after=${JSON.stringify(a.cont)} before=${JSON.stringify(b.cont)}`);
        ok(`${bn} ${scheme}: разделитель строк режимов тот же по виду (left/height/цвет)`, a.modeRow && b.modeRow && a.modeRow.left === b.modeRow.left && a.modeRow.height === b.modeRow.height && a.modeRow.bg === b.modeRow.bg, `after=${JSON.stringify(a.modeRow)} before=${JSON.stringify(b.modeRow)}`);
        ok(`${bn} ${scheme}: у первой строки «Продолжить» разделителя нет (до и после)`, a.contFirst?.content === "none" && b.contFirst?.content === "none");
      } else note("BEFORE не задан — кадры «до» не сняты");
    } catch (e) {
      ok(`${bn} ${scheme}: кадры разделителей`, false, e.message.split("\n")[0]);
    }
  }
}

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} PASS${failed.length ? " — FAIL: " + failed.map((f) => f.name).join("; ") : ""}`);
process.exit(failed.length ? 1 : 0);
