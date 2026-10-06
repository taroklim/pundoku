/**
 * PD-208 — основа режима «Фонарь» на РЕАЛЬНОЙ сборке (vite preview), chromium + webkit, настоящая генерация.
 *
 *   cd apps/web && pnpm build && npx vite preview --port 5208 --strictPort
 *   PD_PW_HOME=/tmp/pundoku-qa/pw BASE=http://localhost:5208 node design/pd208-check.mjs
 *
 * Сценарий: хаб (порядок строк, Фонарь между Мелодией и Глифами) → шит (правило) → партия в темноте (выбора нет, все свои
 * клетки в тени) → свои цифры и заметки → тап по клетке: свет = строка/столбец/блок (21 клетка), своя цифра вне света
 * приглушена (opacity токена), подсказка вне света — нет; подпись VoiceOver «в тени» → короткий тап не осматривает →
 * удержание ≥350 мс: свет везде, отпустил — обратно, фонарь не прыгнул на клетку под пальцем → ⋯ «Осмотреть доску»
 * вкл/выкл → Reduce Motion:
 * переход света 0 с. Консоль чистая. Кадры (основа без финального визуала): design/pd208-shots/. Браузеры — в finally.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
const { solve, litCells } = await import(pathToFileURL(join(HERE, "../packages/engine/dist/index.js")).href);

const BASE = process.env.BASE ?? "http://localhost:5208";
const OUT = join(HERE, "pd208-shots");
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (/^(cr|wk)-.*\.png$/.test(f)) rmSync(join(OUT, f), { force: true });

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, cond: !!cond });
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const CONFIGS = [
  { w: 390, h: 844, scheme: "light", lang: "en", shots: true },
  { w: 390, h: 844, scheme: "dark", lang: "ru", shots: true },
  { w: 390, h: 844, scheme: "light", lang: "uk", rm: true },
];
const WK = [CONFIGS[0], { ...CONFIGS[1], shots: false }];
const SHADOW_LABEL = { en: "in the dark", ru: "в тени", uk: "у темряві" };

async function open(browser, c) {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: 2,
    colorScheme: c.scheme,
    reducedMotion: c.rm ? "reduce" : "no-preference",
    locale: { uk: "uk-UA", ru: "ru-RU", en: "en-US" }[c.lang],
    serviceWorkers: "block",
  });
  await ctx.addInitScript(
    ({ lang }) => {
      try {
        localStorage.setItem("pundoku.locale", lang);
      } catch {
        /* приватный режим */
      }
    },
    { lang: c.lang },
  );
  const page = await ctx.newPage();
  const errs = [];
  const STAND_NOISE = /access control checks/;
  page.on("pageerror", (e) => {
    if (!(STAND_NOISE.test(e.message) && /\/api\//.test(e.message))) errs.push(e.message);
  });
  page.on("console", (m) => {
    if (m.type() === "error" && !/Failed to load resource|\/api\/|ERR_CONNECTION|404|net::/.test(m.text()) && !STAND_NOISE.test(m.text())) errs.push(m.text());
  });
  return { ctx, page, errs };
}

const BOARD = ".play:not(.today) .board";
const cellSel = (i) => `${BOARD} .cell[data-i="${i}"]`;
async function toHub(page) {
  await page.goto(`${BASE}/#/play`);
  for (let k = 0; k < 3; k++) {
    if (await page.locator('[data-testid="mode-lantern"]').isVisible().catch(() => false)) break;
    await page.waitForTimeout(500);
    if (!(await page.locator('[data-testid="mode-lantern"]').isVisible().catch(() => false))) await page.locator("#tab-play").click();
  }
  await page.locator('[data-testid="mode-lantern"]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(350);
}
/** Сетка по DOM: подсказки и свои цифры (свои — в DOM, даже в тени). */
async function grid(page) {
  return page.evaluate((sel) => {
    const out = new Array(81).fill("0");
    for (const c of document.querySelectorAll(`${sel} .cell`)) {
      const d = c.querySelector(".d");
      out[Number(c.getAttribute("data-i"))] = d?.textContent?.trim() || "0";
    }
    return out.join("");
  }, BOARD);
}
const state = (page) =>
  page.evaluate((sel) => {
    const b = document.querySelector(sel);
    const cls = (k) => [...b.querySelectorAll(`.cell.${k}`)].map((c) => Number(c.getAttribute("data-i")));
    return { lantern: b.getAttribute("data-lantern"), lit: cls("is-lit"), shadow: cls("is-shadow"), sel: Number(b.querySelector('.cell[aria-current="true"]')?.getAttribute("data-i") ?? -1) };
  }, BOARD);
const opacityOf = (page, i, part) => page.evaluate(([s, p]) => Number(getComputedStyle(document.querySelector(s).querySelector(p)).opacity), [cellSel(i), part]);
/** Своя цифра гаснет фильтром (`filter: opacity()`, lantern.css) — итоговая видимость = opacity × фильтр. */
const filterOpacityOf = (page, i) =>
  page.evaluate((s) => {
    const cs = getComputedStyle(document.querySelector(s).querySelector(".d.player"));
    const m = /opacity\(([\d.]+)\)/.exec(cs.filter);
    return Number(cs.opacity) * (m ? Number(m[1]) : 1);
  }, cellSel(i));
const tapCell = (page, i) => page.locator(cellSel(i)).click();
async function place(page, i, d) {
  await tapCell(page, i);
  await page.locator(".play:not(.today) .pad .key").nth(d - 1).click();
}

async function flow(name, type, c) {
  const browser = await type.launch();
  const tag = `${name}-${c.w}-${c.scheme}-${c.lang}${c.rm ? "-rm" : ""}`;
  const shot = (s) => join(OUT, `${tag}-${s}.png`);
  try {
    const { page, errs } = await open(browser, c);
    await toHub(page);
    const rows = await page.locator(".hub-row.mode").evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")));
    ok(`${tag} хаб: Классика, Чернила, Лжец, Мелодия, Фонарь, Глифы`, JSON.stringify(rows) === JSON.stringify(["mode-classic", "mode-ink", "mode-liar", "mode-melody", "mode-lantern", "mode-glyphs"]), rows.join(","));

    await page.locator('[data-testid="mode-lantern"]').click();
    await page.locator('[data-testid="sheet-start"]').waitFor();
    await page.waitForTimeout(350);
    const desc = await page.locator('[data-testid="mode-desc"]').textContent();
    ok(`${tag} шит: правило режима на входе`, (desc ?? "").length > 60, desc);
    await page.locator('[data-testid="difficulty-easy"]').click();
    const t0 = Date.now();
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    ok(`${tag} партия: настоящая генерация`, true, `${Date.now() - t0} мс`);
    ok(`${tag} чип режима «Фонарь»`, (await page.locator('[data-testid="mode-chip"]').getAttribute("data-mode")) === "lantern");

    let st = await state(page);
    ok(`${tag} старт в темноте: выбора нет, свет пуст, все 81 клетки в тени`, st.lantern === "dark" && st.lit.length === 0 && st.shadow.length === 81 && st.sel === -1, JSON.stringify({ l: st.lantern, lit: st.lit.length, sh: st.shadow.length, sel: st.sel }));

    const g = await grid(page);
    const sol = solve(g).join("");
    const empty = [...g].flatMap((ch, i) => (ch === "0" ? [i] : []));
    // Своя цифра A, своя цифра B далеко от A (не в свете A), заметки в C.
    const A = empty[0];
    const B = empty.find((i) => !litCells(A).includes(i));
    const C = empty.find((i) => i !== B && !litCells(A).includes(i) && !litCells(B).includes(i));
    await place(page, A, Number(sol[A]));
    await place(page, B, Number(sol[B]));
    await tapCell(page, C);
    await page.locator('.play:not(.today) .actions .act').nth(0).click().catch(() => {}); // «Заметки»
    await page.locator(".play:not(.today) .pad .key").nth(0).click();
    await page.locator(".play:not(.today) .pad .key").nth(1).click();
    await page.locator('.play:not(.today) .actions .act').nth(0).click().catch(() => {});
    if (c.shots) {
      // «нет выбора» после ходов — через перезагрузку нельзя (выбор восстанавливается); кадр темноты берём до ходов — ниже.
    }
    await tapCell(page, A);
    await page.waitForTimeout(400);
    st = await state(page);
    const expectLit = [...litCells(A)];
    ok(`${tag} свет = строка/столбец/блок выбранной (21 клетка), остальные 60 в тени`, st.lantern === "lit" && JSON.stringify([...st.lit].sort((a, b) => a - b)) === JSON.stringify(expectLit) && st.shadow.length === 60);
    const oB = await filterOpacityOf(page, B);
    const oA = await filterOpacityOf(page, A);
    const notesC = await page.locator(`${cellSel(C)} .marks`).count();
    const oC = notesC ? await opacityOf(page, C, ".marks") : -1;
    ok(`${tag} своя цифра в тени приглушена (токен ≈0.1), в свете — 1`, oB > 0 && oB < 0.2 && oA === 1, `B=${oB} A=${oA}`);
    ok(`${tag} заметки в тени приглушены`, oC > 0 && oC < 0.2, `C=${oC} (marks ${notesC})`);
    const givenShadow = await page.evaluate((s) => {
      const c = [...document.querySelectorAll(`${s} .cell.is-shadow`)].find((x) => x.querySelector(".d.given"));
      return c ? Number(getComputedStyle(c.querySelector(".d.given")).opacity) : -1;
    }, BOARD);
    ok(`${tag} подсказка в тени видна (opacity 1)`, givenShadow === 1, String(givenShadow));
    const lblB = await page.locator(cellSel(B)).getAttribute("aria-label");
    const lblA = await page.locator(cellSel(A)).getAttribute("aria-label");
    // Подпись тени — ровно «строка, столбец, в тени» (три части): ни цифры, ни «ваша». Координаты сами цифры — сравниваем форму.
    ok(`${tag} VoiceOver: в тени «${SHADOW_LABEL[c.lang]}» без цифры, в свете — цифра`, lblB.endsWith(`, ${SHADOW_LABEL[c.lang]}`) && lblB.split(", ").length === 3 && lblA.endsWith(sol[A]), `${lblB} | ${lblA}`);
    ok(`${tag} одинаковые цифры вне света не подсвечены`, (await page.locator(`${BOARD} .cell.same.is-shadow`).count()) === 0);
    const trans = await page.evaluate((s) => getComputedStyle(document.querySelector(s).querySelector(".d.player")).transitionDuration, cellSel(B));
    if (c.rm) ok(`${tag} Reduce Motion: переход света без анимации (0 с)`, /^0s$/.test(trans), trans);
    else ok(`${tag} переход света ~180 мс`, /0\.18s|180ms/.test(trans), trans);
    if (c.shots) await page.screenshot({ path: shot("2-lit") });

    // Короткий тап — не осмотр.
    const box = await page.locator(cellSel(B)).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(120);
    const shortHold = (await state(page)).lantern;
    await page.mouse.up();
    await page.waitForTimeout(250);
    ok(`${tag} короткий тап не включает осмотр (и выбирает клетку)`, shortHold !== "inspect" && (await state(page)).sel === B, shortHold);
    // Удержание на клетке A's тени (клетка в тени от B).
    await tapCell(page, A);
    await page.waitForTimeout(250);
    const target = st.shadow.find((i) => i !== B && i !== C);
    const tb = await page.locator(cellSel(target)).boundingBox();
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    const held = await state(page);
    const oBheld = await filterOpacityOf(page, B);
    ok(`${tag} удержание ≥350 мс: осмотр — теней нет, своя цифра видна`, held.lantern === "inspect" && held.shadow.length === 0 && oBheld > 0.9, `${held.lantern} sh=${held.shadow.length} B=${oBheld}`);
    if (c.shots) await page.screenshot({ path: shot("3-inspect-hold") });
    await page.mouse.up();
    await page.waitForTimeout(350);
    const after = await state(page);
    ok(`${tag} отпустил — тень вернулась`, after.lantern === "lit" && after.shadow.length === 60, after.lantern);
    ok(`${tag} осмотр не переносит фонарь на клетку под пальцем`, after.sel === A, `sel=${after.sel}`);

    // Меню ⋯ «Осмотреть доску».
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-inspect"]').waitFor();
    await page.waitForTimeout(300);
    const item = await page.locator('[data-testid="menu-inspect"]').evaluate((e) => ({ role: e.getAttribute("role"), checked: e.getAttribute("aria-checked"), label: e.getAttribute("aria-label") }));
    ok(`${tag} ⋯: «Осмотреть доску» — menuitemcheckbox, не отмечен`, item.role === "menuitemcheckbox" && item.checked === "false" && !!item.label, JSON.stringify(item));
    if (c.shots) await page.screenshot({ path: shot("4-menu") });
    await page.locator('[data-testid="menu-inspect"]').click();
    await page.waitForTimeout(350);
    st = await state(page);
    const boardLabel = await page.locator(BOARD).getAttribute("aria-label");
    ok(`${tag} ⋯ вкл → свет везде, подпись поля сообщает об осмотре`, st.lantern === "inspect" && st.shadow.length === 0 && boardLabel.includes(","), boardLabel);
    await page.locator('[data-testid="more-button"]').click();
    await page.waitForTimeout(300);
    ok(`${tag} галочка отмечена`, (await page.locator('[data-testid="menu-inspect"]').getAttribute("aria-checked")) === "true");
    await page.locator('[data-testid="menu-inspect"]').click();
    await page.waitForTimeout(350);
    ok(`${tag} ⋯ выкл → тень вернулась`, (await state(page)).lantern === "lit");

    // Новая партия режима — снова в темноте (кадр «нет выбора» с подсказками).
    await page.locator('[data-testid="more-button"]').click();
    await page.locator('[data-testid="menu-new"]').click();
    await page.locator('[data-testid="sheet-start"]').waitFor();
    await page.waitForTimeout(350);
    await page.locator('[data-testid="sheet-start"]').click();
    await page.locator(`${BOARD} .cell .d.given`).first().waitFor({ timeout: 60000 });
    await page.waitForTimeout(600);
    st = await state(page);
    ok(`${tag} новая партия Фонаря — снова темно`, st.lantern === "dark" && st.sel === -1);
    if (c.shots) await page.screenshot({ path: shot("1-dark") });
    ok(`${tag} консоль чистая`, errs.length === 0, errs.join(" | "));
  } finally {
    await browser.close();
  }
}

try {
  if (!process.env.WK_ONLY) for (const c of CONFIGS) await flow("cr", chromium, c);
  if (!process.env.CR_ONLY) for (const c of WK) await flow("wk", webkit, c);
} finally {
  const failed = results.filter((r) => !r.cond);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) {
    console.log("FAILED:\n" + failed.map((f) => "  " + f.name).join("\n"));
    process.exitCode = 1;
  }
}
