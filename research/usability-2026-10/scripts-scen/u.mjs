// Общий помощник сценарного юзабилити-теста PD-107 (SC): iPhone 16 в WebKit, учёт тапов/времени, скриншоты.
import { createRequire } from "node:module";
import { mkdirSync, appendFileSync } from "node:fs";
export const BASE = process.env.BASE ?? "http://127.0.0.1:3981";
export const API = process.env.API ?? "http://127.0.0.1:5981";
export const SHOTS = "/Users/taroklim/Documents/KlymWork/DevTeam_v1/products/pundoku/research/usability-2026-10/shots/scen";
export const LOG = "/tmp/pundoku-usab/scen/usab/journal.log";
mkdirSync(SHOTS, { recursive: true });
const require = createRequire("/tmp/pundoku-ios/pw/");
export const pw = require("playwright");
export const IPHONE16 = {
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  viewport: { width: 393, height: 852 }, screen: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
};
export async function ctxFor(browser, o = {}) {
  const { engine = "webkit", locale = "en-US", viewport, storageState, extra = {} } = o;
  const base = engine === "webkit" ? IPHONE16 : { ...IPHONE16, userAgent: undefined };
  const ctx = await browser.newContext({ ...base, ...(viewport ? { viewport, screen: viewport } : {}), locale, storageState, colorScheme: o.colorScheme ?? "light", reducedMotion: o.reducedMotion ?? "no-preference", ...extra });
  return ctx;
}
export class Session {
  constructor(page, name) { this.page = page; this.name = name; this.taps = 0; this.t0 = Date.now(); this.notes = []; }
  log(...a) { const s = `[${this.name} +${((Date.now() - this.t0) / 1000).toFixed(1)}s taps=${this.taps}] ${a.join(" ")}`; console.log(s); appendFileSync(LOG, s + "\n"); }
  async tap(loc, label) { this.taps++; await (typeof loc === "string" ? this.page.locator(loc) : loc).tap(); if (label) this.log("tap", label); }
  async cell(i) { await this.tap(`.board .cell[data-i="${i}"]`); }
  async key(d) { await this.tap(this.page.locator(".pad .key").nth(d - 1)); }
  async act(n) { await this.tap(this.page.locator(".actions .act").nth(n)); }
  async shot(name, opts = {}) { await this.page.screenshot({ path: `${SHOTS}/${name}.png`, scale: "css", ...opts }); this.log("shot", name); }
  async text() { return this.page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ")); }
  async grid() { // 81 строк: given/player/notes
    return this.page.evaluate(() => { const o = []; for (const c of document.querySelectorAll(".board .cell")) { const d = c.querySelector(".d"); o[+c.dataset.i] = d ? d.textContent : "0"; } return o.join(""); });
  }
  async givens() { return this.page.evaluate(() => { const o = []; for (const c of document.querySelectorAll(".board .cell")) { const d = c.querySelector(".d.given"); o[+c.dataset.i] = d ? d.textContent : "0"; } return o.join(""); }); }
}
export async function solve(page) {
  const mod = await import("/tmp/pundoku-usab/scen/packages/engine/dist/index.js");
  const s = new Session(page, "x");
  const puzzle = await s.givens();
  const sol = mod.solve(puzzle);
  const str = typeof sol === "string" ? sol : (sol?.solution ?? sol?.grid ?? sol);
  return { puzzle, solution: Array.isArray(str) ? str.join("") : String(str) };
}
