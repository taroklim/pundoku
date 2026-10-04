// PD-156 QA: обновление SW. Фаза 1 (сервер D5) — установить SW, прогреть precache. Фаза 2 (сервер P4, тот же origin и профиль) — новый SW берёт иконки.
// PHASE=old|new  BASE=http://localhost:5997  PROFILE=/tmp/iconqa/prof
import { createRequire } from "node:module";
const { chromium } = createRequire("/tmp/pundoku-ios/pw/")("playwright");
import { createHash } from "node:crypto";
const BASE = process.env.BASE ?? "http://localhost:5997";
const PROFILE = process.env.PROFILE ?? "/tmp/iconqa/prof";
const PHASE = process.env.PHASE;
const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chromium" });
const p = ctx.pages()[0] ?? (await ctx.newPage());
await p.goto(BASE + "/");
await p.evaluate(() => navigator.serviceWorker.ready.then(() => 0));
await p.waitForTimeout(PHASE === "new" ? 6000 : 3000);
if (PHASE === "new") { await p.reload(); await p.waitForTimeout(3000); }
const info = await p.evaluate(async () => {
  const sha = async (b) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", b))].map((x) => x.toString(16).padStart(2, "0")).join("").slice(0, 12);
  const out = {};
  for (const u of ["/icons/icon-192.png?v=p4", "/icons/icon-512.png?v=p4", "/icons/icon-192.png?v=d5", "/icons/apple-touch-icon-180.png?v=p4", "/icons/favicon-32.png", "/icons/favicon-16.png", "/icons/icon.svg"]) {
    try { const r = await fetch(u); out[u] = r.status + " " + r.headers.get("content-type") + " " + (await sha(await r.arrayBuffer())); } catch (e) { out[u] = "ERR " + e.message; }
  }
  const keys = await caches.keys();
  const pre = [];
  for (const k of keys) { const c = await caches.open(k); pre.push([k, (await c.keys()).map((r) => r.url.replace(location.origin, "")).filter((u) => /icons\//.test(u))]); }
  const regs = await navigator.serviceWorker.getRegistrations();
  return { out, caches: pre, sw: regs.map((r) => ({ active: !!r.active, waiting: !!r.waiting, url: r.active?.scriptURL })), controller: !!navigator.serviceWorker.controller };
});
console.log(PHASE, JSON.stringify(info, null, 1));
// офлайн: иконки из precache
await ctx.setOffline(true);
const off = await p.evaluate(async () => { const r = await fetch("/icons/icon-192.png?v=p4").catch((e) => ({ status: "ERR " + e.message })); return r.status; });
console.log(PHASE, "offline icon-192?v=p4 status", off);
await ctx.setOffline(false);
await ctx.close();
