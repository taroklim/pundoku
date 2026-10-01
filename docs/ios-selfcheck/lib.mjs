// Общие помощники самопроверки iPhone-чек-листа: запуск webkit с эмуляцией iPhone 16,
// подмена env(safe-area-*) и prefers-reduced-transparency через перехват CSS, Dynamic Type через размер корневого шрифта,
// решение сетки движком из сборки и ввод цифр касаниями.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BASE = process.env.BASE ?? "http://127.0.0.1:3600";
export const API = process.env.API ?? "http://127.0.0.1:5600";
export const WT = process.env.WT ?? "/tmp/pundoku-ios/wt";
export const ART = process.env.ART ?? "/tmp/pundoku-ios/art";
const PW_DIR = process.env.PW_DIR ?? "/tmp/pundoku-ios/pw/";
mkdirSync(ART, { recursive: true });

const require = createRequire(PW_DIR.endsWith("/") ? PW_DIR : PW_DIR + "/");
export const { webkit } = require("playwright");

// iPhone 16: 393x852 pt, DPR 3. Standalone-PWA занимает весь экран (в Safari-вкладке окно ниже; здесь — как установленная).
export const IPHONE16 = {
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  viewport: { width: 393, height: 852 },
  screen: { width: 393, height: 852 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
};

// Типичные значения safe-area iPhone 16 (портрет: Dynamic Island сверху 59, индикатор Home снизу 34; ландшафт: по бокам 59, снизу 21).
export const SAFE_PORTRAIT = { top: 59, bot: 34, l: 0, r: 0 };
export const SAFE_LANDSCAPE = { top: 0, bot: 21, l: 59, r: 59 };

// Размеры текста iOS (Dynamic Type) для стиля body, pt: xS..AX5.
export const DYNAMIC_TYPE = { xS: 14, S: 15, M: 16, L: 17, xL: 19, xxL: 21, xxxL: 23, AX1: 28, AX2: 33, AX3: 40, AX4: 47, AX5: 53 };

export async function newContext(browser, o = {}) {
  const {
    locale = "en-US",
    colorScheme = "light",
    reducedMotion = "no-preference",
    forcedColors = "none",
    contrast = "no-preference",
    viewport,
    safeArea = null, // {top,bot,l,r} — подставить в --sa-* вместо env()
    reducedTransparency = false, // принудительно включить @media (prefers-reduced-transparency: reduce)
    dynamicType = "L", // ключ из DYNAMIC_TYPE (null — не трогать). Без этого webkit на macOS даёт 13px у `-apple-system-body`, а на iPhone это 17pt
    storageState,
    extra = {},
  } = o;
  const ctx = await browser.newContext({
    ...IPHONE16,
    ...(viewport ? { viewport, screen: viewport } : {}),
    locale,
    colorScheme,
    reducedMotion,
    forcedColors,
    contrast,
    storageState,
    ...extra,
  });
  if (safeArea || reducedTransparency) {
    await ctx.route("**/assets/*.css", async (route) => {
      const resp = await route.fetch();
      let css = await resp.text();
      if (safeArea) {
        const s = safeArea;
        css = css
          .replace(/env\(safe-area-inset-top,\s*0px\)/g, `${s.top}px`)
          .replace(/env\(safe-area-inset-bottom,\s*0px\)/g, `${s.bot}px`)
          .replace(/env\(safe-area-inset-left,\s*0px\)/g, `${s.l}px`)
          .replace(/env\(safe-area-inset-right,\s*0px\)/g, `${s.r}px`);
      }
      if (reducedTransparency) css = css.replace(/prefers-reduced-transparency:\s*reduce/g, "min-width:0px");
      await route.fulfill({ response: resp, body: css, headers: { ...resp.headers(), "content-length": undefined } });
    });
  }
  if (dynamicType) {
    const px = DYNAMIC_TYPE[dynamicType];
    await ctx.addInitScript((px) => {
      const add = () => {
        const st = document.createElement("style");
        st.setAttribute("data-ios-selfcheck", "dynamic-type");
        st.textContent = `html{font-size:${px}px !important}`;
        document.documentElement.appendChild(st);
      };
      if (document.documentElement) add();
      else document.addEventListener("DOMContentLoaded", add);
    }, px);
  }
  return ctx;
}

export async function gotoApp(page, hash = "") {
  await page.goto(BASE + "/" + hash);
  await page.waitForSelector(".board:not(.idle), .year, .settings, [data-testid=archive-screen], .status", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(400);
}

// ---------- сетка и ввод ----------
let engine;
export async function getEngine() {
  engine ??= await import(pathToFileURL(`${WT}/packages/engine/dist/index.js`).href);
  return engine;
}

/** Строка сетки (0 — пусто) из DOM: заданные клетки + уже поставленные игроком. */
export async function readGrid(page) {
  return page.evaluate(() => {
    const out = Array(81).fill(0);
    for (const c of document.querySelectorAll(".board .cell")) {
      const i = Number(c.getAttribute("data-i"));
      const d = c.querySelector(".d");
      if (d && /^[1-9]$/.test(d.textContent ?? "")) out[i] = Number(d.textContent);
    }
    return out.join("");
  });
}
export async function givensOnly(page) {
  return page.evaluate(() => {
    const out = Array(81).fill(0);
    for (const c of document.querySelectorAll(".board .cell")) {
      const d = c.querySelector(".d.given");
      if (d) out[Number(c.getAttribute("data-i"))] = Number(d.textContent);
    }
    return out.join("");
  });
}
export async function solutionOf(page) {
  const e = await getEngine();
  const puzzle = await givensOnly(page);
  const sol = e.solve(puzzle);
  const s = typeof sol === "string" ? sol : (sol?.solution ?? sol?.grid ?? sol);
  const str = Array.isArray(s) ? s.join("") : String(s);
  if (!/^[1-9]{81}$/.test(str)) throw new Error("solve() вернул неожиданное: " + JSON.stringify(sol)?.slice(0, 120));
  return { puzzle, solution: str };
}

export async function tapCell(page, i) {
  await page.locator(`.board .cell[data-i="${i}"]`).tap();
}
export async function tapKey(page, d) {
  await page.locator(`.pad .key`).nth(d - 1).tap();
}
export async function place(page, i, d) {
  await tapCell(page, i);
  await tapKey(page, d);
}
/** Заполнить пустые клетки верными цифрами; keepLast — оставить последние N клеток незаполненными. */
export async function fillCorrect(page, { keepLast = 0, order = "asc" } = {}) {
  const { puzzle, solution } = await solutionOf(page);
  const empties = [];
  for (let i = 0; i < 81; i++) if (puzzle[i] === "0") empties.push(i);
  const todo = keepLast > 0 ? empties.slice(0, empties.length - keepLast) : empties;
  for (const i of todo) await place(page, i, Number(solution[i]));
  return { puzzle, solution, empties, left: empties.slice(todo.length) };
}

// ---------- результаты ----------
export class Results {
  constructor(file) {
    this.file = file;
    this.items = {};
  }
  add(id, ok, note) {
    (this.items[id] ??= []).push({ ok, note });
    console.log(`  [${id}] ${ok ? "ok  " : "FAIL"} ${note}`);
  }
  save() {
    writeFileSync(this.file, JSON.stringify(this.items, null, 2));
  }
}

export async function shot(page, name, opts = {}) {
  await page.screenshot({ path: `${ART}/${name}.png`, ...opts });
}

export async function api(path, init) {
  const r = await fetch(API + path, init);
  const text = await r.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* не JSON */
  }
  return { status: r.status, json, text };
}

export const todayLocal = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

import { execFileSync } from "node:child_process";
const STACK = new URL("./stack.sh", import.meta.url).pathname;
export const stack = (cmd) => execFileSync(STACK, [cmd], { stdio: "pipe", env: process.env }).toString();

/** Отчёт о горизонтальном переполнении и обрезанном тексте на текущем экране. */
export async function overflowReport(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const bad = [];
    const doc = document.documentElement;
    const label = (el) => `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (el.closest("[aria-hidden=true] svg, svg") && el.tagName !== "svg") continue;
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        // внутри горизонтально прокручиваемых контейнеров это нормально
        let p = el.parentElement, scrolled = false;
        while (p) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") { scrolled = true; break; } p = p.parentElement; }
        if (!scrolled) bad.push({ kind: "out-of-viewport", el: label(el), left: Math.round(r.left), right: Math.round(r.right) });
      }
      const clipped = (cs.overflowX === "hidden" || cs.overflowX === "clip" || cs.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1 && el.children.length === 0 && (el.textContent ?? "").trim() !== "";
      if (clipped) bad.push({ kind: "text-clipped", el: label(el), text: (el.textContent ?? "").slice(0, 40), sw: el.scrollWidth, cw: el.clientWidth });
    }
    const hscroll = doc.scrollWidth > vw + 0.5 || document.body.scrollWidth > vw + 0.5;
    return { vw, hscroll, bad };
  });
}
