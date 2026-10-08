/**
 * PD-224 — кадры и живые проверки макета design/pd224-swipe.html (свайп-удаление незаконченной партии в строке режима).
 *
 * Запуск (из products/pundoku):
 *   PD_PW_HOME=/Users/taroklim/Documents/KlymWork/gr487-w2/frontend node design/pd224-shots.mjs
 *
 * Playwright ищется так: $PD_PW_HOME → cwd → /tmp/pd16-pw. PLAYWRIGHT_BROWSERS_PATH подставляется ТОЛЬКО если Playwright
 * взят из /tmp/pd16-pw и там есть browsers/ (иначе — кэш браузеров по умолчанию той установки, версии не смешиваются).
 * Страница открывается по file:// с ?shot=1 (панель скрыта, рамка = вьюпорт). Порт не занимается.
 *
 * Пишет в design/pd224-shots/:
 *   cr-*.png (chromium), wk-*.png (webkit), @3x:  <state>-<w>-<theme>-<lang>[-ax3][-rm][-confirm].png
 *     state: closed · partial (палец ведёт строку) · open (кнопка «Удалить») · armed (за порогом полного свайпа) ·
 *            undo (строка вернулась к описанию + undo-тост) · confirm (вариант с подтверждением) · menu (долгое нажатие,
 *            пункт «Удалить сетку») · kbd (клавиатурный путь: строка открыта фокусом на кнопке)
 *   overview-<theme>.png — макет с панелью (1280×1000 @1x, chromium)
 *
 * Автопроверки: красный баннер #pd224-err, ошибки консоли, PD224.check() (переполнение, тост на таб-баре/обрезан,
 * цели < 44, подпись «Удалить» шире кнопки, порог полного свайпа ≥ ширины строки, шит/меню за краем) и ЖИВЫЕ ЖЕСТЫ мышью
 * (chromium + webkit): короткий свайп открывает, тап вне закрывает без перехода, полный удаляет + тост, «Отменить»
 * возвращает, вертикальный ведёт прокрутку (строка не едет), слева направо на закрытой — ничего, строка без партии не
 * свайпается, вариант «Подтверждение»: полный свайп → шит, «Отмена» сохраняет партию.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const FALLBACK = "/tmp/pd16-pw";
function loadPlaywright() {
  const bases = [process.env.PD_PW_HOME, process.cwd(), FALLBACK].filter(Boolean);
  const tried = [];
  for (const b of bases) {
    try {
      const pw = createRequire(join(b, "/"))("playwright");
      if (b === FALLBACK && !process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(join(FALLBACK, "browsers"))) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = join(FALLBACK, "browsers");
      }
      console.log("playwright из " + b);
      return pw;
    } catch (e) {
      tried.push(b + " (" + (e.code || e.message) + ")");
    }
  }
  console.error("Playwright не найден. Искал: " + tried.join(", ") + "\nЗадай PD_PW_HOME на папку с node_modules/playwright.");
  process.exit(1);
}
const { chromium, webkit } = loadPlaywright();

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT = join(DIR, "pd224-shots");
const PAGE = pathToFileURL(join(DIR, "pd224-swipe.html")).href;
mkdirSync(OUT, { recursive: true });

const VIEW = { 320: { width: 320, height: 568 }, 390: { width: 390, height: 844 }, 430: { width: 430, height: 932 } };

/* ------------------------------------------------------------------ план кадров */
const SHOTS = [];
const add = (state, w, theme, lang, flags = {}) => {
  const name = [state, w, theme, lang, flags.ax3 ? "ax3" : "", flags.rm ? "rm" : "", flags.confirm ? "confirm" : ""].filter(Boolean).join("-");
  SHOTS.push({
    name, w, theme, rm: !!flags.rm,
    apply: { state, theme, lang, w: String(w), type: flags.ax3 ? "ax3" : "17", rm: flags.rm ? "on" : "off", variant: flags.confirm || state === "confirm" ? "confirm" : "undo" },
  });
};

const STATES = ["closed", "partial", "open", "armed", "undo", "confirm", "menu", "kbd"];
// Все состояния: 390 en в обеих темах.
for (const theme of ["light", "dark"]) for (const s of STATES) add(s, 390, theme, "en");
// Узкий экран и самые длинные подписи (uk «Видалити», ru «Удалить незаконченную сетку?»).
for (const s of ["open", "armed", "undo", "confirm", "menu"]) {
  add(s, 320, "light", "uk");
  add(s, 320, "dark", "ru");
}
add("partial", 320, "light", "ru");
add("kbd", 320, "light", "uk");
add("open", 430, "light", "en");
add("undo", 430, "dark", "uk");
// Крупный текст AX3: кнопка становится значком, тост — в две строки, шит прокручивать не нужно.
for (const s of ["closed", "open", "armed", "undo", "confirm", "menu"]) {
  add(s, 390, "light", "uk", { ax3: true });
  add(s, 320, "dark", "ru", { ax3: true });
}
add("open", 390, "light", "en", { ax3: true });
// Reduce Motion: те же кадры (движение влияет только на переходы — кадр должен совпасть по виду).
add("undo", 390, "light", "en", { rm: true });
add("armed", 390, "dark", "ru", { rm: true });

/* ------------------------------------------------------------------ съёмка */
const problems = [];

async function shoot(browserType, prefix) {
  const browser = await browserType.launch();
  for (const s of SHOTS) {
    const ctx = await browser.newContext({
      viewport: VIEW[s.w], deviceScaleFactor: 3,
      colorScheme: s.theme === "dark" ? "dark" : "light", reducedMotion: s.rm ? "reduce" : "no-preference",
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD224);
    await page.evaluate((o) => { PD224.reset(); PD224.apply(o); }, s.apply);
    await page.waitForTimeout(450); // переходы 220–260 мс и отложенное снятие красного слоя
    await page.screenshot({ path: join(OUT, `${prefix}-${s.name}.png`) });
    const banner = await page.evaluate(() => { const b = document.getElementById("pd224-err"); return b ? b.textContent : null; });
    if (banner) errors.push("БАННЕР: " + banner);
    const checks = await page.evaluate(() => PD224.check());
    const all = [...errors, ...checks];
    if (all.length) { console.log(`  ! ${prefix}-${s.name}: ${all.slice(0, 4).join(" | ")}`); problems.push(`${prefix}-${s.name}`); }
    else console.log(`  ok ${prefix}-${s.name}`);
    await ctx.close();
  }
  await browser.close();
}

/* ------------------------------------------------------------------ живые жесты (мышь = указатель) */
async function gestures(browserType, prefix) {
  const browser = await browserType.launch();
  const results = [];
  for (const w of [390, 320]) {
    const ctx = await browser.newContext({ viewport: VIEW[w], deviceScaleFactor: 1, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(PAGE + "?shot=1", { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD224);
    const st = () => page.evaluate(() => PD224.state());
    const fresh = async (o = {}) => { await page.evaluate((x) => { PD224.reset(); PD224.apply({ w: String(x.w), ...x.o }); }, { w, o }); await page.waitForTimeout(60); };
    const rowBox = (m) => page.locator(`[data-mode="${m}"] .fg`).boundingBox();
    const dragBy = async (m, dx, dy = 0) => {
      const b = await rowBox(m);
      const x = b.x + b.width - 40, y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + dx, y + dy, { steps: 14 });
      await page.waitForTimeout(140); // отпускаем без броска: скорость за последние 100 мс ≈ 0
      await page.mouse.up();
      await page.waitForTimeout(80);
    };
    const check = (name, ok, info) => { results.push({ name: `${prefix}-${w} ${name}`, ok, info }); };

    await fresh();
    const g = (await st()).geom;

    // 1. Короткий свайп (больше A/2, меньше порога) → строка открыта, партия на месте.
    await dragBy("liar", -Math.round(g.A * 0.8));
    let s = await st();
    check("короткий свайп открывает", s.open === "liar" && s.slots.includes("liar"), s);

    // 2. Тап вне открытой строки (по Классике) закрывает и НЕ открывает Классику.
    const cb = await rowBox("classic");
    await page.mouse.click(cb.x + 80, cb.y + cb.height / 2);
    await page.waitForTimeout(80);
    s = await st();
    check("тап вне закрывает без перехода", s.open === null && s.activated === null, s);

    // 3. Свайп меньше A/2 → закрывается обратно.
    await dragBy("liar", -Math.round(g.A * 0.3));
    s = await st();
    check("свайп < A/2 закрывается", s.open === null && s.slots.includes("liar"), s);

    // 4. Полный свайп за порог → удалено + тост.
    await dragBy("liar", -Math.min(g.W - 50, g.T + 40));
    s = await st();
    check("полный свайп удаляет + тост", !s.slots.includes("liar") && s.toast, s);

    // 5. «Отменить» возвращает партию.
    await page.click("#toastUndo");
    await page.waitForTimeout(60);
    s = await st();
    check("Отменить возвращает", s.slots.includes("liar") && !s.toast, s);

    // 6. Вертикальный жест (угол круче ~34°) строку не двигает.
    await fresh();
    await dragBy("liar", -14, 60);
    s = await st();
    check("вертикальный не свайпает", s.open === null && s.slots.includes("liar") && !s.armed, s);

    // 7. Слева направо на закрытой строке — ничего.
    await fresh();
    const lb = await rowBox("liar");
    await page.mouse.move(lb.x + 60, lb.y + lb.height / 2);
    await page.mouse.down();
    await page.mouse.move(lb.x + 200, lb.y + lb.height / 2, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(60);
    s = await st();
    check("слева направо — ничего", s.open === null && s.slots.includes("liar") && s.activated === null, s);

    // 8. Строка без партии (Классика) не свайпается и после жеста не открывается тапом.
    await dragBy("classic", -Math.round(g.A * 1.2));
    s = await st();
    check("строка без партии не свайпается", s.open === null && s.activated === null, s);

    // 9. Порог с гистерезисом: за порог и обратно на 30 px ниже → не удаляет, остаётся открытой.
    await fresh();
    {
      const b = await rowBox("liar");
      const x = b.x + b.width - 40, y = b.y + b.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x - (g.T + 20), y, { steps: 14 });
      await page.mouse.move(x - (g.T - 30), y, { steps: 6 });
      await page.waitForTimeout(140); await page.mouse.up(); await page.waitForTimeout(80);
      s = await st();
      check("назад за порог — не удаляет", s.slots.includes("liar") && s.open === "liar", s);
    }

    // 10. Вариант «Подтверждение»: полный свайп → шит; «Отмена» → партия на месте, строка закрыта.
    await fresh({ variant: "confirm" });
    await dragBy("liar", -Math.min(g.W - 50, g.T + 40));
    s = await st();
    const sheetShown = s.sheet && s.slots.includes("liar");
    await page.click("#asCancel");
    await page.waitForTimeout(60);
    s = await st();
    check("подтверждение: шит, Отмена сохраняет", sheetShown && !s.sheet && s.slots.includes("liar") && s.open === null, s);

    // 11. Клавиатура: Tab до строки Лжеца, Delete → фокус на кнопке, строка открыта; Enter → удалено, фокус на «Отменить».
    await fresh();
    await page.focus('[data-mode="liar"] .fg');
    await page.keyboard.press("Delete");
    await page.waitForTimeout(60);
    s = await st();
    const opened = s.open === "liar";
    await page.keyboard.press("Enter");
    await page.waitForTimeout(80);
    s = await st();
    const focusUndo = await page.evaluate(() => document.activeElement && document.activeElement.id === "toastUndo");
    check("клавиатура: Delete → Enter → фокус на Отменить", opened && !s.slots.includes("liar") && s.toast && focusUndo, s);

    if (errors.length) check("без ошибок страницы", false, errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  for (const r of results) {
    console.log(`  ${r.ok ? "ok" : "!!"} жест ${r.name}${r.ok ? "" : "  → " + JSON.stringify(r.info)}`);
    if (!r.ok) problems.push("жест " + r.name);
  }
}

async function overview() {
  const browser = await chromium.launch();
  for (const theme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1, colorScheme: theme });
    const page = await ctx.newPage();
    await page.goto(PAGE, { waitUntil: "load" });
    await page.waitForFunction(() => !!window.PD224);
    await page.evaluate((t) => { PD224.reset(); PD224.apply({ theme: t, state: "open" }); }, theme);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `overview-${theme}.png`), fullPage: true });
    console.log(`  ok overview-${theme}`);
    await ctx.close();
  }
  await browser.close();
}

console.log(`кадров на браузер: ${SHOTS.length}`);
console.log("chromium…");
await shoot(chromium, "cr");
console.log("webkit…");
await shoot(webkit, "wk");
console.log("жесты…");
await gestures(chromium, "cr");
await gestures(webkit, "wk");
console.log("обзор…");
await overview();
console.log(problems.length ? `\nПРОБЛЕМЫ (${problems.length}): ${problems.join(", ")}` : "\nпроблем нет");
console.log("готово →", OUT);
