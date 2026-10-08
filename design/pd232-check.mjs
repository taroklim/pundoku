/**
 * PD-232 — живая проверка десктоп-фиксов (а) клавиатура без клика по клетке, (б) справка из низа Settings с начала,
 * (в) Enter в шитах, (г) Esc = назад / снимает выбор в партии.
 *
 * Запуск (dev-стенд поднят отдельно, API не нужен — Today берёт фолбэк-генератор с seed = дата):
 *   cd apps/web && vite --port 3932 --strictPort --host 127.0.0.1
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend BASE=http://127.0.0.1:3932 \
 *     node design/pd232-check.mjs [chromium-1280] [webkit-1280] [webkit-390] [chromium-390]   (без аргументов — все по очереди)
 *
 * Один браузер за раз, закрывается в finally. Кадры: design/pd232-shots/<набор>-<шаг>.png, итог: design/pd232-shots/results.json.
 * Никаких pkill.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function loadPlaywright() {
  const bases = [process.cwd(), process.env.PD_PW_HOME, "/Users/taroklim/Documents/KlymWork/gr487-w2/frontend"].filter(Boolean);
  for (const b of bases) {
    try {
      return createRequire(join(b, "noop.js"))("playwright");
    } catch {
      /* next */
    }
  }
  console.error("Playwright не найден — задай PD_PW_HOME.");
  process.exit(1);
}
const pw = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd232-shots");
const BASE = process.env.BASE ?? "http://127.0.0.1:3932";
const TODAY = "2026-10-08";
mkdirSync(OUT, { recursive: true });

const SETS = {
  "chromium-1280": { engine: "chromium", w: 1280, h: 800, full: true },
  "webkit-1280": { engine: "webkit", w: 1280, h: 800, full: false },
  "webkit-390": { engine: "webkit", w: 390, h: 844, mobile: true },
  "chromium-390": { engine: "chromium", w: 390, h: 844, mobile: true },
};
const want = process.argv.slice(2);
const results = [];

const q = (page, id) => page.locator(`[data-testid="${id}"]`);
const settle = (page, ms = 600) => page.waitForTimeout(ms);
let nav = 0;
async function go(page, hash, wait = ".shell") {
  await page.goto(`${BASE}/?n=${++nav}#/${hash}`);
  await page.waitForSelector(wait, { timeout: 60000 });
  await settle(page, 1200);
}
const BOARD = () => {
  const cells = [...document.querySelectorAll(".tab-pane:not(.off) .board .cell, .push-layer .board .cell")];
  const sel = cells.find((c) => c.getAttribute("aria-current") === "true");
  const a = document.activeElement;
  return {
    sel: sel ? Number(sel.dataset.i) : null,
    val: sel ? (sel.querySelector(".d.player") ? sel.querySelector(".d.player").textContent || "glyph" : sel.querySelector(".d.given") ? "given" : "") : null,
    notes: sel ? [...sel.querySelectorAll(".marks span")].map((s) => (s.textContent || (s.querySelector("svg") ? "g" : ""))).join("") : null,
    notesMode: document.querySelector(".tab-pane:not(.off) .act[aria-pressed], .push-layer .act[aria-pressed]")?.getAttribute("aria-pressed") ?? null,
    dock: !!document.querySelector('[data-testid="hint-dock"]'),
    dialog: !!document.querySelector('[role="dialog"]'),
    menu: !!document.querySelector('[role="menu"]'),
    hash: location.hash,
    active: a === document.body ? "body" : (a?.getAttribute("data-testid") ?? a?.className?.toString().slice(0, 30) ?? a?.tagName ?? ""),
    activeCell: a?.classList?.contains("cell") ? Number(a.dataset.i) : null,
  };
};

async function runSet(name) {
  const o = SETS[name];
  const rec = { set: name, checks: [], errs: [] };
  results.push(rec);
  const k = (label, ok, detail) => {
    rec.checks.push({ label, ok, detail });
    console.log(`${ok ? "ok   " : "FAIL "}[${name}] ${label}  ${JSON.stringify(detail)}`);
  };
  const b = await pw[o.engine].launch();
  try {
    const ctx = await b.newContext({ viewport: { width: o.w, height: o.h }, locale: "en-US", colorScheme: "light", ...(o.mobile ? { hasTouch: true, isMobile: o.engine === "chromium" } : {}) });
    const page = await ctx.newPage();
    await page.clock.install({ time: new Date(`${TODAY}T12:00:00`) });
    // Стенд без API: WebKit бросает «api/devices due to access control checks» (CORS при 502) — артефакт стенда (как в PD-228).
    page.on("pageerror", (e) => { if (!/api\/devices|access control/.test(e.message)) rec.errs.push("pageerror: " + e.message); });
    page.on("console", (m) => {
      if (m.type() === "error" && !/502|Bad Gateway|Failed to load resource|api\/|access control|CORS/i.test(m.text())) rec.errs.push("console: " + m.text());
    });
    const st = () => page.evaluate(BOARD);
    const shot = (step) => page.screenshot({ path: join(OUT, `${name}-${step}.png`) });

    if (!o.mobile) {
      // ---------------- (а) Today: клавиши сразу после загрузки, без клика
      await go(page, "today", ".board .cell .d.given");
      let s0 = await st();
      await page.keyboard.press("7");
      await settle(page, 300);
      let s1 = await st();
      k("(а) Today: цифра сразу после загрузки ставится", s0.active === "body" && s1.sel === s0.sel && s1.val === "7", { before: s0, after: s1 });
      await page.keyboard.press("Backspace");
      await settle(page, 200);
      k("(а) Today: Backspace без клика стирает", (await st()).val === "", await st());
      await page.keyboard.press("ArrowRight");
      await settle(page, 200);
      let s2 = await st();
      k("(а) Today: стрелка без клика двигает выбор, фокус уходит на клетку", s2.sel !== s1.sel && s2.activeCell === s2.sel, { from: s1.sel, to: s2 });
      await shot("a-today-arrow");
      // Клик по вкладке Today в таб-баре → цифра (стрелки у вкладки свои).
      await page.locator(".tabbar .tab").first().click();
      await settle(page, 400);
      // найти пустую клетку и выбрать её через стор-нейтральный способ: стрелками с поля нельзя (фокус на вкладке) — берём текущий выбор
      s0 = await st();
      if (s0.val !== "") {
        await page.locator(".tab-pane:not(.off) .board .cell:not(:has(.d))").first().click();
        await page.locator(".tabbar .tab").first().click();
        await settle(page, 300);
        s0 = await st();
      }
      await page.keyboard.press("Shift+3");
      await settle(page, 250);
      s1 = await st();
      k("(а) Today: после клика по вкладке Shift+цифра — заметка", s0.active !== "body" && !!s1.notes?.includes("3"), { before: s0, after: s1 });
      await page.keyboard.press("ArrowRight");
      await settle(page, 600);
      k("(а) Today: стрелка на вкладке переключает вкладку (не ход)", (await st()).hash === "#/play", await st());
      await page.locator(".tabbar .tab").first().click();
      await settle(page, 700);
      // Клик по пустому месту сбоку от поля.
      const box = await page.locator(".tab-pane:not(.off) .board").boundingBox();
      await page.mouse.click(Math.max(8, box.x - 60), box.y + box.height / 2);
      await settle(page, 200);
      s0 = await st();
      await page.keyboard.press("n");
      await settle(page, 200);
      s1 = await st();
      await page.keyboard.press("n");
      k("(а) Today: после клика мимо поля N переключает заметки", s0.notesMode !== s1.notesMode, { before: s0.notesMode, after: s1.notesMode, active: s0.active });
      // Settings открыт — клавиши не ходят в Today.
      await page.locator(".tab-pane:not(.off) [data-testid=\"open-settings\"]").click();
      await page.locator('[data-testid="settings-screen"]').waitFor();
      await settle(page, 600);
      await page.keyboard.press("5");
      await page.keyboard.press("Escape");
      await settle(page, 700);
      s1 = await st();
      k("(а)+(г) Settings: цифра не уходит в партию; Esc возвращает на Today", s1.hash === "#/today" && s1.val !== "5", s1);

      // ---------------- (г) Esc в партии снимает выбор, из партии не выводит
      await page.keyboard.press("Escape");
      await settle(page, 300);
      s1 = await st();
      k("(г) Today: Esc снимает выбор, остаёмся в партии", s1.sel === null && s1.hash === "#/today" && (await page.locator(".tab-pane:not(.off) .board").count()) === 1, s1);
      await shot("d-today-esc-deselect");
      await page.keyboard.press("ArrowDown");
      await settle(page, 200);
      k("(г) Today: стрелка после Esc снова выбирает клетку", (await st()).sel !== null, await st());

      // ---------------- (в) Enter в шитах: Play-хаб → шит режима → Enter запускает
      await go(page, "play", '[data-testid="hub-modes"]');
      await q(page, "mode-classic").click();
      await page.locator('[data-testid="mode-sheet"]').waitFor();
      await settle(page, 700);
      k("(в) шит режима (нечего отбрасывать): фокус на Start", (await st()).active === "sheet-start", await st());
      await shot("c-mode-sheet-focus");
      await page.keyboard.press("Enter");
      await page.waitForSelector('[data-tab="play"] .board .cell .d.given', { timeout: 60000 });
      await settle(page, 1200);
      k("(в) Enter в шите режима запускает партию", !(await st()).dialog, await st());
      // (а) Play: цифра без клика
      s0 = await st();
      if (s0.val !== "") {
        await page.locator('[data-tab="play"] .board .cell:not(:has(.d))').first().click();
        await page.evaluate(() => document.activeElement.blur());
        s0 = await st();
      }
      await page.keyboard.press("4");
      await settle(page, 300);
      s1 = await st();
      // После старта фокус — на заголовке экрана (не на клетке): раньше цифра шла только с фокуса внутри .play.
      k("(а) Play: цифра без фокуса на поле ставится", s0.activeCell === null && s1.val === "4", { before: s0, after: s1 });
      await page.locator(".tabbar .tab").nth(1).focus();
      await page.keyboard.press("Backspace");
      await settle(page, 300);
      k("(а) Play: фокус на вкладке Play — Backspace стирает", (await st()).val === "", await st());
      await page.keyboard.press("Meta+z");
      await settle(page, 300);
      k("(а) Play: ⌘Z с фокусом на вкладке отменяет стирание (4 вернулась)", (await st()).val === "4", await st());
      await page.keyboard.press("Backspace");
      // ⋯ → New → шит с «Start new» (отбросит партию): фокус на Cancel, Enter закрывает, партия цела
      await page.keyboard.press("4");
      await q(page, "more-button").click();
      await settle(page, 400);
      k("(а) меню ⋯ открыто: цифра не ход", true, {});
      await page.keyboard.press("6");
      await settle(page, 200);
      const menuVal = await st();
      await page.locator('[data-testid="more-menu"] [role="menuitem"]').first().click();
      await page.locator('[data-testid="mode-sheet"]').waitFor();
      await settle(page, 700);
      const disc = await q(page, "discard-note").count();
      k("(в) шит «Start new» с отбрасыванием: фокус на Cancel", disc > 0 && (await st()).active === "sheet-cancel", { disc, menuVal, ...(await st()) });
      await shot("c-mode-sheet-discard-focus");
      await page.keyboard.press("5");
      await page.keyboard.press("Enter");
      await settle(page, 700);
      s1 = await st();
      k("(в) Enter на Cancel: шит закрыт, партия цела (4 на месте, 5/6 не поставились)", !s1.dialog && s1.val === "4", s1);

      // Правило подсказки: H → шит → фокус на «Show the hint» → Enter → док
      await page.keyboard.press("h");
      await settle(page, 600);
      const rule = await q(page, "hint-rule-sheet").count();
      k("(в) шит правила подсказки: фокус на «Show the hint»", rule > 0 && (await st()).active === "hint-rule-go", { rule, ...(await st()) });
      if (rule) await shot("c-hint-rule-focus");
      await page.keyboard.press("Enter");
      await settle(page, 800);
      k("(в) Enter показывает подсказку (док открыт)", (await st()).dock, await st());
      await page.keyboard.press("Escape");
      await settle(page, 400);
      s1 = await st();
      k("(г) Esc сначала закрывает док, выбор остаётся", !s1.dock && s1.sel !== null, s1);

      // Fill candidates: правый клик по Notes → action sheet, фокус на «Fill»
      await page.locator('[data-tab="play"] .actions .act').first().click({ button: "right" });
      await settle(page, 600);
      k("(в) «Fill candidates»: фокус на действии", (await st()).active === "action-sheet-go", await st());
      await shot("c-fill-focus");
      await page.keyboard.press("Escape");
      await settle(page, 400);
      k("(г) Esc закрывает action sheet, из партии не выходим", !(await st()).dialog && (await st()).hash === "#/play", await st());

      if (o.full) {
        // Режимы: Ink (два шита, Enter, Enter), Glyphs, Melody, Liar — клавиши без клика
        for (const mode of ["ink", "glyphs", "melody", "liar"]) {
          await go(page, "play", '[data-testid="hub-modes"]');
          await q(page, `mode-${mode}`).click();
          await page.locator('[data-testid="mode-sheet"]').waitFor();
          await settle(page, 600);
          const f = (await st()).active;
          await page.keyboard.press("Enter");
          await settle(page, 800);
          if (mode === "ink" && (await q(page, "ink-sheet").count())) {
            k("(в) Ink: второй шит правил — фокус на «Play in ink»", (await st()).active === "ink-rule-start", await st());
            await shot("c-ink-rule-focus");
            await page.keyboard.press("Enter");
          }
          await page.waitForSelector('[data-tab="play"] .board .cell .d.given, [data-tab="play"] .board .cell .gd', { timeout: 60000 });
          await settle(page, 1200);
          if (mode === "liar") {
            await page.locator('[data-tab="play"] .board .cell:has(.d.given)').first().click();
            await page.evaluate(() => document.activeElement.blur());
            await page.keyboard.press("a");
            await settle(page, 500);
            k("(а) Лжец: A без фокуса в партии — меню «Обвинить»", (await q(page, "accuse-menu").count()) > 0, { sheetFocus: f });
            await shot("a-liar-accuse");
            await page.keyboard.press("Escape");
            await settle(page, 300);
            k("(г) Лжец: Esc закрывает меню, партия на месте", !(await st()).menu && (await st()).sel !== null, await st());
            continue;
          }
          let e0 = await st();
          if (e0.val !== "") {
            await page.locator('[data-tab="play"] .board .cell:not(:has(.d))').first().click();
            e0 = await st();
          }
          await page.evaluate(() => document.activeElement.blur());
          await page.keyboard.press("5");
          await settle(page, 400);
          const e1 = await st();
          k(`(а) ${mode}: Enter в шите стартует (фокус ${f}), цифра 5 без фокуса ставится`, f === "sheet-start" && e1.val !== "" && e1.sel === e0.sel, { e0, e1 });
          await shot(`a-${mode}-digit`);
        }
        // Архив: Esc в партии снимает выбор и не уводит
        // Архив: в партии Esc снимает выбор и не уводит; вне партии (недоступно/загрузка/карточка) — «‹ Year».
        await go(page, "day/2026-09-25", '[data-testid="archive-screen"]');
        await settle(page, 2500);
        const inGame = (await page.locator('.push-layer .board[data-phase="playing"]').count()) > 0;
        await shot(`d-archive-${inGame ? "game" : "nogame"}`);
        await page.evaluate(() => document.activeElement?.blur?.());
        await page.keyboard.press("Escape");
        await settle(page, 600);
        s1 = await st();
        if (inGame) {
          k("(г) архив в партии: Esc снимает выбор, остаёмся в архиве", s1.hash.startsWith("#/day/") && s1.sel === null, s1);
          await page.keyboard.press("Escape");
          await settle(page, 400);
          k("(г) архив в партии: второй Esc тоже не уводит", (await st()).hash.startsWith("#/day/"), await st());
        } else {
          k("(г) архив без партии (стенд без API — день недоступен): Esc = «‹ Year»", s1.hash.startsWith("#/year"), s1);
        }
      }
    }

    // ---------------- (б) справка из низа Settings — с начала; назад — позиция Settings
    await go(page, "settings", '[data-testid="settings-screen"]');
    const layer = page.locator(".push-layer");
    await layer.evaluate((e) => e.scrollTo(0, e.scrollHeight));
    await settle(page, 400);
    const before = await layer.evaluate((e) => e.scrollTop);
    await page.getByText(/How Pundoku works/).first().click();
    await page.locator('[data-testid="help-screen"]').waitFor();
    await settle(page, 900);
    const help = await page.evaluate(() => ({ top: document.querySelector(".push-layer").scrollTop, h1: document.querySelector('[data-testid="help-screen"] h1').getBoundingClientRect().top }));
    k("(б) справка из низа Settings открыта с начала (scrollTop 0, заголовок виден)", before > 0 && help.top === 0 && help.h1 >= 0, { settingsTop: before, ...help });
    await shot("b-help-from-settings");
    await layer.evaluate((e) => e.scrollTo(0, 120));
    await settle(page, 200);
    if (o.mobile) await q(page, "help-back").tap();
    else await page.keyboard.press("Escape");
    await page.locator('[data-testid="settings-screen"]').waitFor();
    await settle(page, 900);
    const back = await layer.evaluate((e) => e.scrollTop);
    k(`(б) ${o.mobile ? "«‹ Settings»" : "Esc"} — Settings на прежней позиции`, Math.abs(back - before) <= 2, { before, back });
    await shot("b-settings-restored");
    if (!o.mobile) {
      await page.keyboard.press("Escape");
      await settle(page, 700);
      k("(г) Esc из Settings — на вкладку", !(await page.locator('[data-testid="settings-screen"]').count()), await st());
    }
    k("нет JS-ошибок", rec.errs.length === 0, rec.errs);
    await ctx.close();
  } finally {
    await b.close();
  }
}

for (const name of Object.keys(SETS)) if (want.length === 0 || want.includes(name)) await runSet(name);
writeFileSync(join(OUT, "results.json"), JSON.stringify(results, null, 2));
const fails = results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.set}: ${c.label}`));
console.log(`\n${results.reduce((n, r) => n + r.checks.length, 0) - fails.length}/${results.reduce((n, r) => n + r.checks.length, 0)} ok`);
if (fails.length) {
  console.log("FAIL:\n" + fails.join("\n"));
  process.exitCode = 1;
}
