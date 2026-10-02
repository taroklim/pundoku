#!/usr/bin/env node
// PD-122 (AX-05): контраст пар §2.3 (research/usability-2026-10/a11y-i18n-responsive.md) по РЕАЛЬНЫМ computed-цветам
// четырёх тем — light/dark × normal/more — в Chromium (эмуляция prefers-color-scheme и prefers-contrast).
// Не расчёт «по hex из CSS»: цифры и заливки читаются из живых клеток Play (`.cell.sel`, `.fl`, `.d.player`, `.d.err`),
// остальное — из computed-значений токенов на :root. Выход ≠ 0, если пара ниже порога (текст 4.5, графика 3).
//
//   pnpm build && pnpm exec vite preview --port 3986 &      # api не нужен: Play (свободная игра) оффлайн
//   BASE=http://127.0.0.1:3986 node scripts/contrast-check.mjs
//   PW_DIR=/путь/к/node_modules-родителю-playwright  (если playwright не установлен в пакете)
import { createRequire } from "node:module";

const BASE = process.env.BASE ?? "http://127.0.0.1:3986";
const require = createRequire(process.env.PW_DIR ? `${process.env.PW_DIR.replace(/\/?$/, "/")}` : import.meta.url);
const { chromium } = require("playwright");

const THEMES = [
  { id: "light", colorScheme: "light", contrast: "no-preference" },
  { id: "dark", colorScheme: "dark", contrast: "no-preference" },
  { id: "light-more", colorScheme: "light", contrast: "more" },
  { id: "dark-more", colorScheme: "dark", contrast: "more" },
];
// Замеры до PD-122 (таблица §2.3) — для столбца «было».
const BEFORE = { "dark-more|digit ink / sel fill": 4.38, "dark-more|digit wax / sel fill": 4.16 };

// ЕДИНСТВЕННОЕ известное исключение (AX-16, замер §2.3 тот же): soft-метки легенды Year в светлой теме (обычной и с «Increase contrast» —
// soft-токены в more не усиливаются) на #F2F2F7 дают 2.91/2.84 при пороге 3. Soft-токены — значения утверждённого макета Year (тон 62 %), CLAUDE.md запрещает понижать контраст токенов, а
// подъём меняет утверждённые тона, поэтому они не тронуты; вопрос про AX-16 открыт у PM/владельца. Пары печатаются с «!», не валят скрипт — чтобы он
// ловил регрессии, — и итоговая строка называет их явно: формулировки «все пары ≥ порогов» скрипт не печатает.
const KNOWN_BELOW = new Set(
  ["light", "light-more"].flatMap((theme) => ["mark-ink-soft", "mark-wax-soft"].map((m) => `${theme}|${m} / bg (Year legend)`)),
);

// ── математика WCAG ─────────────────────────────────────────────────────────────────────────────────────
const lin = (c) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Слой c (rgba) поверх непрозрачного b → непрозрачный. */
const over = (c, b, alpha = c[3] ?? 1) => [0, 1, 2].map((i) => c[i] * alpha + b[i] * (1 - alpha));

// Любую запись цвета браузер сам приводит к rgb()/rgba() через computed style.
const parse = (s) => {
  const m = s.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`не rgb(): ${s}`);
  const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  return [r, g, b, a];
};

async function measure(browser, theme) {
  const ctx = await browser.newContext({
    viewport: { width: 393, height: 852 },
    colorScheme: theme.colorScheme,
    contrast: theme.contrast,
    reducedMotion: "reduce", // заливки без переходов — читаем установившуюся непрозрачность
    locale: "en-US",
  });
  await ctx.addInitScript(() => localStorage.setItem("pundoku.highlightWrong", "1"));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/play`);
  // Свободная игра: экран выбора сложности → Start (как в сценарных тестах PD-107).
  await page.waitForSelector("[data-testid=setup-difficulty]");
  await page.locator("[data-testid=setup-difficulty]").selectOption("easy");
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForSelector(".board:not(.idle) .cell .d.given");

  const cellAt = (i) => page.locator(`.board .cell[data-i="${i}"]`);
  const empties = await page.locator(".board .cell:not(:has(.d))").evaluateAll((els) => els.map((e) => e.dataset.i));
  const [iOk, iErr] = empties;
  const hasErr = async (i) => (await cellAt(i).locator(".d.err").count()) > 0;
  // Клетка с неверной цифрой (подсветка ошибок включена ключом выше) и клетка с верной: перебираем цифры 1–9.
  await cellAt(iErr).click();
  for (let d = 1; d <= 9; d++) {
    await page.locator(".pad .key").nth(d - 1).click();
    if (await hasErr(iErr)) break;
  }
  await cellAt(iOk).click();
  for (let d = 1; d <= 9; d++) {
    await page.locator(".pad .key").nth(d - 1).click();
    if (!(await hasErr(iOk))) break;
  }
  const snap = () =>
    page.evaluate(() => {
      const cs = (el, p) => getComputedStyle(el)[p];
      const root = getComputedStyle(document.documentElement);
      const tok = (n) => {
        const probe = document.createElement("i");
        probe.style.color = root.getPropertyValue(n).trim();
        document.body.appendChild(probe);
        const v = getComputedStyle(probe).color;
        probe.remove();
        return v;
      };
      const out = { tok: {}, num: { fillSel: parseFloat(root.getPropertyValue("--fill-sel")), fillSame: parseFloat(root.getPropertyValue("--fill-same")) } };
      for (const n of ["--ink", "--wax", "--surface", "--bg", "--label", "--label-2", "--label-2-grouped", "--notes", "--notes-fill",
        "--hairline", "--mark-ink-soft", "--mark-wax-soft", "--mark-ink", "--mark-wax", "--dis-label", "--dis-fill"]) out.tok[n] = tok(n);
      const sel = document.querySelector(".board .cell.sel");
      const d = sel?.querySelector(".d");
      out.selDigit = d ? cs(d, "color") : null;
      out.selIsErr = !!d?.classList.contains("err");
      out.selFl = sel ? { bg: cs(sel.querySelector(".fl"), "backgroundColor"), op: +cs(sel.querySelector(".fl"), "opacity") } : null;
      out.corner = sel ? getComputedStyle(sel, "::after").backgroundImage.includes("gradient") : false;
      return out;
    });
  await cellAt(iOk).click();
  await page.waitForTimeout(400);
  const okSnap = await snap();
  await cellAt(iErr).click();
  await page.waitForTimeout(400);
  const errSnap = await snap();
  const read = { ...okSnap, playerDigit: okSnap.selDigit, selFl: okSnap.selFl, errDigit: errSnap.selIsErr ? errSnap.selDigit : null,
    errFl: errSnap.selFl, errHasCorner: errSnap.corner };
  await ctx.close();
  return read;
}

const rows = [];
const browser = await chromium.launch();
let failed = 0;
for (const theme of THEMES) {
  const r = await measure(browser, theme);
  const tk = Object.fromEntries(Object.entries(r.tok).map(([k, v]) => [k, parse(v)]));
  const surface = tk["--surface"].slice(0, 3);
  const bg = tk["--bg"].slice(0, 3);
  // Заливка выбора = слой --ink при непрозрачности --fill-sel поверх поверхности (как в .cell.sel > .fl).
  const selFill = over(tk["--ink"], surface, r.num.fillSel);
  const sameFill = over(tk["--ink"], surface, r.num.fillSame);
  const live = (f) => (f ? over(parse(f.bg), surface, f.op * parse(f.bg)[3]) : null);
  const liveFill = live(r.selFl);
  const liveErrFill = live(r.errFl);
  const add = (name, fg, bgc, min) => {
    const v = ratio(fg.slice(0, 3), bgc);
    const was = BEFORE[`${theme.id}|${name}`];
    const ok = v >= min;
    const known = !ok && KNOWN_BELOW.has(`${theme.id}|${name}`);
    if (!ok && !known) failed++;
    rows.push({ theme: theme.id, pair: name, min, value: +v.toFixed(2), was, ok, known });
  };
  // Живые клетки (не токены): то, что видит игрок.
  if (r.playerDigit && liveFill) add("digit ink (live) / sel fill (live)", parse(r.playerDigit), liveFill, 4.5);
  if (r.errDigit && liveErrFill) add("digit wax (live err) / sel fill (live)", parse(r.errDigit), liveErrFill, 4.5);
  if (r.errDigit) rows.push({ theme: theme.id, pair: "err corner mark rendered", min: "-", value: r.errHasCorner ? "yes" : "NO", ok: r.errHasCorner }), (r.errHasCorner || failed++);
  // §2.3, текст.
  add("digit ink / sel fill", tk["--ink"], selFill, 4.5);
  add("digit ink / same fill", tk["--ink"], sameFill, 4.5);
  add("digit wax / sel fill", tk["--wax"], selFill, 4.5);
  add("digit ink / surface", tk["--ink"], surface, 4.5);
  add("digit wax / surface", tk["--wax"], surface, 4.5);
  add("notes / sel fill", tk["--notes-fill"], selFill, 4.5);
  add("given / sel fill", tk["--label"], selFill, 4.5);
  add("label-2 / bg", tk["--label-2"], bg, 4.5);
  add("label-2-grouped / bg", tk["--label-2-grouped"], bg, 4.5);
  add("dis-label / dis-fill", tk["--dis-label"], tk["--dis-fill"].slice(0, 3), 4.5);
  // §2.3, графика (3:1).
  add("ring ink / sel fill", tk["--ink"], selFill, 3);
  add("ring ink / surface", tk["--ink"], surface, 3);
  add("ring ink / bg", tk["--ink"], bg, 3);
  add("ring wax / surface", tk["--wax"], surface, 3);
  add("mark-ink / surface", tk["--mark-ink"], surface, 3);
  add("mark-wax / surface", tk["--mark-wax"], surface, 3);
  add("mark-ink-soft / bg (Year legend)", tk["--mark-ink-soft"], bg, 3);
  add("mark-wax-soft / bg (Year legend)", tk["--mark-wax-soft"], bg, 3);
}
await browser.close();

// Таблица: пары по строкам, темы по столбцам.
const pairs = [...new Set(rows.map((r) => r.pair))];
const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("pair", 42)} ${pad("min", 4)} ${THEMES.map((t) => pad(t.id, 11)).join(" ")}`);
for (const p of pairs) {
  const cells = THEMES.map((t) => {
    const r = rows.find((x) => x.theme === t.id && x.pair === p);
    if (!r) return pad("-", 11);
    return pad(`${r.value}${r.ok ? "" : r.known ? "!" : "*"}${r.was ? ` (was ${r.was})` : ""}`, 11);
  });
  console.log(`${pad(p, 42)} ${pad(rows.find((x) => x.pair === p).min, 4)} ${cells.join(" ")}`);
}
const knownRows = rows.filter((r) => r.known);
console.log(
  failed
    ? `\nFAIL: ${failed} пар ниже порога (*)`
    : `\nOK: все пары не ниже порогов, кроме известного исключения AX-16 (!): ${knownRows.map((r) => `${r.theme} ${r.pair} ${r.value} < ${r.min}`).join("; ") || "(нет)"}`,
);
process.exit(failed ? 1 : 0);
