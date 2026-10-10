/**
 * PD-292 + PD-288 — живая проверка.
 *
 *   cd apps/web && npx vite build --outDir /tmp/pdlow4-dist
 *   PD_PW_HOME=… [PLAYWRIGHT_BROWSERS_PATH=/tmp/pw-firefox] DIST=/tmp/pdlow4-dist node design/pdlow4/ring-pet-check.mjs <firefox|chromium|webkit>
 *
 * PD-292: Tab по Year и Settings — у каждого элемента в фокусе нижняя линия кольца (outline + offset) не ниже видимого низа
 * прокручиваемой панели (низ панели или верх таб-бара на телефоне). Компакт C 1024×640 DPR 1,25 и 960×600 DPR 1,5 (там QA PD-270
 * видел срез в Firefox), десктоп C 1280×800, телефон 393×852. Отдельно — месяцы Oct–Dec и key-status-retry / highlight-wrong.
 * PD-288 → PD-297: превью Питомца в Settings дышит, как на карточке (Питомец по умолчанию вкл): у каждого data-idle и одна
 *   анимация покоя (идёт или на паузе за краем панели). Подробно (бесконечность, пауза, RM) — design/pd297-check.mjs.
 * Известный остаток (не PD-292, есть и до него): Firefox не докручивает к элементу в фокусе, если тот уже ЧАСТИЧНО виден —
 * месяцы Year Apr–Sep на десктопе C и Oct–Dec на 960×600@1,5 остаются подрезанными; проверка «Year — кольца … (все)» в
 * Firefox поэтому FAIL. Тикетные случаи (1024×640@1,25: Oct–Dec, key-status-retry; 960×600@1,5: highlight-wrong) — PASS.
 * Браузер и сервер закрываются в finally.
 */
import { pw, open, serve, settle, side } from "./lib.mjs";

const BRN = process.argv[2] ?? "chromium";
const DIST = process.env.DIST ?? "/tmp/pdlow4-dist";
const PORT = +(process.env.PORT ?? 5351);
const KEY = BRN === "webkit" ? "Alt+Tab" : "Tab";
let total = 0;
const fails = [];
const check = (name, ok, detail = "") => {
  total++;
  if (!ok) fails.push(name);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, typeof detail === "string" ? detail : JSON.stringify(detail));
};

/** Геометрия кольца фокуса у активного элемента относительно видимого низа его прокручиваемой панели. */
const RING = () => {
  const e = document.activeElement;
  if (!e || e === document.body) return null;
  if (e.classList.contains("scroll")) return null; // Firefox: прокручиваемая панель сама получает фокус — кольцо у неё внутрь окна
  const sc = e.closest(".scroll");
  if (!sc) return null;
  const cs = getComputedStyle(e);
  const ext = cs.outlineStyle === "none" ? 0 : Math.max(0, parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset));
  const r = e.getBoundingClientRect();
  const sr = sc.getBoundingClientRect();
  const tb = document.querySelector(".tabbar");
  const tbr = tb && getComputedStyle(tb).display !== "none" ? tb.getBoundingClientRect() : null;
  const visBottom = Math.min(sr.bottom, tbr && tbr.height > 0 ? tbr.top : Infinity);
  const id = e.getAttribute("data-testid") ?? (e.classList.contains("year-month") ? `month:${(e.getAttribute("aria-label") ?? "").slice(0, 3)}` : e.tagName + "." + e.className.split(" ")[0]);
  return { id, ringBottom: +(r.bottom + ext).toFixed(2), visBottom: +visBottom.toFixed(2), gap: +(visBottom - r.bottom - ext).toFixed(2), ext, h: +r.height.toFixed(1), inPane: r.top < visBottom && r.bottom > sr.top };
};

async function tabAll(p, n) {
  const seen = [];
  for (let i = 0; i < n; i++) {
    await p.keyboard.press(KEY);
    await p.waitForTimeout(+(process.env.TAB_WAIT ?? 90));
    const r = await p.evaluate(RING);
    if (r) seen.push(r);
  }
  return seen;
}

const s = await serve(DIST, PORT);
const b = await pw[BRN].launch();
try {
  for (const [w, h, dpr, desk, compact] of [
    [1024, 640, 1.25, true, true],
    [960, 600, 1.5, true, true],
    [1280, 800, 1, true, false],
    [393, 852, 3, false, false],
  ]) {
    const tag = `${BRN} ${w}x${h}@${dpr}`;
    const { ctx, p, errs } = await open(b, { w, h, dpr, base: `http://127.0.0.1:${PORT}`, extra: { reducedMotion: "no-preference" } });
    try {
      // Year
      if (desk) await side(p, "side-year", compact);
      else await p.locator("#tab-year").click();
      await settle(p, 900);
      await p.evaluate(() => document.activeElement?.blur());
      const y = (await tabAll(p, 40)).filter((r) => r.inPane);
      const ybad = y.filter((r) => r.gap < 0);
      const months = y.filter((r) => /^month:(Oct|Nov|Dec)/.test(r.id));
      check(`${tag}: Year — кольца фокуса снизу не срезаны (${y.length} элементов)`, y.length > 0 && ybad.length === 0, ybad.slice(0, 4));
      check(`${tag}: Year — Oct–Dec в фокусе, зазор ≥ 0`, months.length >= 3 && months.every((m) => m.gap >= 0), months.map((m) => [m.id, m.gap]));
      if (w === 1024) await p.screenshot({ path: `/tmp/pdlow4-shots/${BRN}-year-${w}x${h}.png` });

      // Settings
      await p.locator('[data-testid="open-settings"]:visible, .gear-btn:visible').first().click();
      await p.locator('[data-testid="settings-screen"]').waitFor();
      await settle(p, 900);
      // PD-297: превью дышит (по умолчанию Питомец вкл)
      const prev = await p.evaluate(() => [...document.querySelectorAll('[data-testid="pet-moods"] .pet')].map((x) => ({ idle: x.hasAttribute("data-idle"), n: x.getAnimations({ subtree: true }).length })));
      check(`${tag}: PD-297 — превью Питомца: 4 настроения, у каждого покой (data-idle, 1 анимация)`, prev.length === 4 && prev.every((x) => x.idle && x.n === 1), prev);
      // Старт последовательного фокуса — с «‹» экрана (Firefox после клика мышью продолжил бы с таб-бара и ушёл из документа).
      await p.locator('[data-testid="settings-back"]').focus();
      const stAll = await tabAll(p, 70);
      const st = stAll.filter((r) => r.inPane);
      if (st.length === 0) console.log(`debug ${tag}:`, JSON.stringify(stAll.slice(0, 5)), await p.evaluate(() => `${document.activeElement?.tagName}.${document.activeElement?.className}`));
      const sbad = st.filter((r) => r.gap < 0);
      check(`${tag}: Settings — кольца фокуса снизу не срезаны (${st.length} элементов)`, st.length > 0 && sbad.length === 0, sbad.slice(0, 4));
      const named = st.filter((r) => ["key-status-retry", "highlight-wrong"].includes(r.id));
      console.log(`info ${tag}: Settings key-status-retry/highlight-wrong`, JSON.stringify(named.map((r) => [r.id, r.gap])));
      check(`${tag}: без ошибок страницы`, errs.filter((e) => !/\/api\//.test(e)).length === 0, errs.slice(0, 2).join(" | "));
    } finally {
      await ctx.close();
    }
  }
} finally {
  await b.close();
  s.close();
}
console.log(`\n${BRN}: ${total - fails.length}/${total} PASS`);
process.exit(fails.length ? 1 : 0);
