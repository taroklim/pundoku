// Пункты 13-22: Today / Play (озвучка, кнопки, кольца ошибки, ввод, Grid ∞, сервер, полночь, фон).
import { API, BASE, newContext, gotoApp, shot, api, fillCorrect, solutionOf, place, tapCell, tapKey, readGrid } from "./lib.mjs";

const SOLVED = /"status":\s*"solved"/;

/** Токен устройства из IndexedDB (kv: meta:deviceToken). */
export async function deviceToken(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const rq = indexedDB.open("pundoku");
        rq.onsuccess = () => {
          const db = rq.result;
          const g = db.transaction("kv").objectStore("kv").get("meta:deviceToken");
          g.onsuccess = () => resolve(g.result ?? null);
          g.onerror = () => resolve(null);
        };
        rq.onerror = () => resolve(null);
      }),
  );
}

/** Ждать, пока снапшот на сервере (по токену) начнёт содержать подстроку. */
export async function waitServer(token, needle, ms = 20000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    const r = await api("/api/snapshot", { headers: { authorization: `Bearer ${token}` } });
    last = r.status;
    if (r.status === 200 && (needle instanceof RegExp ? needle.test(r.text) : r.text.includes(needle))) return { ok: true, ms: Date.now() - t0, status: 200 };
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, ms: Date.now() - t0, status: last };
}

export async function setVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => s });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => s === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

const clockText = (page) => page.locator(".subline .clock").first().textContent();
const clockSec = async (page) => {
  const m = /(?:(\d+):)?(\d+):(\d+)/.exec((await clockText(page)) ?? "");
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN;
};

async function fresh(browser, o = {}) {
  const ctx = await newContext(browser, o);
  const page = await ctx.newPage();
  await gotoApp(page);
  await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
  return { ctx, page };
}

export async function run(R, browser) {
  // ---------- 13. озвучка «N cells left» только на порогах ----------
  {
    const { ctx, page } = await fresh(browser);
    await page.evaluate(() => {
      window.__said = [];
      const el = document.querySelector("p.sr-only[role=status]");
      new MutationObserver(() => {
        const t = (el.textContent ?? "").trim();
        if (t) window.__said.push(t);
      }).observe(el, { childList: true, characterData: true, subtree: true });
    });
    const { puzzle, solution } = await solutionOf(page);
    const empties = [];
    for (let i = 0; i < 81; i++) if (puzzle[i] === "0") empties.push(i);
    const expected = [];
    let left = empties.length;
    for (const i of empties) {
      await place(page, i, Number(solution[i]));
      left--;
      if (left > 0 && (left % 10 === 0 || left <= 5)) expected.push(left);
      await page.waitForTimeout(700); // дольше debounce 600 мс
    }
    await page.waitForTimeout(800);
    const said = await page.evaluate(() => window.__said);
    const nums = said.map((s) => Number(/\d+/.exec(s)?.[0]));
    R.add(13, empties.length > 20 && JSON.stringify(nums) === JSON.stringify(expected), `ход ${empties.length} клеток по одной (пауза 700 мс): live-region озвучил ${JSON.stringify(nums)}, ожидалось ${JSON.stringify(expected)}; всего ${said.length} объявлений на ${empties.length} цифр`);
    const final = (await page.locator("p.sr-only[role=status]").textContent())?.trim();
    R.add(13, final === "", `после решения live-region пуст: "${final}" (раньше оставалось «1 cell left»)`);
    R.add(13, said.every((s) => /cell/i.test(s)), `формулировка объявлений: "${said[0]}" / "${said.at(-1)}"`);
    await ctx.close();
  }

  // ---------- 14. ряд Notes / Undo / Erase на узком экране в uk и ru ----------
  {
    const cases = [
      ["uk-UA", { width: 320, height: 568 }, "L"],
      ["ru-RU", { width: 320, height: 568 }, "L"],
      ["uk-UA", { width: 320, height: 568 }, "xxxL"],
      ["ru-RU", { width: 320, height: 568 }, "xxxL"],
      ["uk-UA", { width: 393, height: 852 }, "AX3"],
      ["ru-RU", { width: 393, height: 852 }, "AX3"],
    ];
    for (const [locale, viewport, dt] of cases) {
      const { ctx, page } = await fresh(browser, { locale, viewport, dynamicType: dt });
      const g = await page.evaluate(() => {
        const acts = [...document.querySelectorAll(".actions .act")];
        const rects = acts.map((a) => a.getBoundingClientRect());
        const spans = acts.map((a) => {
          const s = a.querySelector("span");
          return { text: s.textContent, clipped: s.scrollWidth > s.clientWidth + 1 || a.scrollWidth > a.clientWidth + 1 };
        });
        const row = document.querySelector(".actions").getBoundingClientRect();
        return { heights: rects.map((r) => Math.round(r.height * 10) / 10), widths: rects.map((r) => Math.round(r.width)), spans, rowRight: row.right, vw: innerWidth, lang: document.documentElement.lang };
      });
      const same = g.heights.every((h) => Math.abs(h - g.heights[0]) < 0.6);
      const clipped = g.spans.filter((s) => s.clipped);
      R.add(14, same && clipped.length === 0 && g.rowRight <= g.vw + 0.5, `${locale} ${viewport.width}pt, текст ${dt}: высоты ${g.heights.join("/")}, ширины ${g.widths.join("/")}, подписи ${g.spans.map((s) => s.text).join(" | ")}${clipped.length ? ", ОБРЕЗАНО: " + clipped.map((s) => s.text).join(",") : ", без обрезки"}`);
      if (dt === "xxxL" || dt === "AX3") await shot(page, `i14-${locale}-${viewport.width}-${dt}`);
      await ctx.close();
    }
  }

  // ---------- 15. выбранная неверная клетка: индиго и сургуч, светлая и тёмная ----------
  for (const scheme of ["light", "dark"]) {
    const { ctx, page } = await fresh(browser, { colorScheme: scheme });
    const { puzzle, solution } = await solutionOf(page);
    const cell = [...puzzle].findIndex((c, i) => c === "0" && i > 10);
    const wrong = (Number(solution[cell]) % 9) + 1;
    await place(page, cell, wrong);
    await page.waitForTimeout(400);
    const g = await page.evaluate((cell) => {
      const ring = document.querySelector(".ring");
      const rs = ring ? getComputedStyle(ring) : null;
      const c = document.querySelector(`.board .cell[data-i="${cell}"]`);
      const after = getComputedStyle(c, "::after");
      const root = getComputedStyle(document.documentElement);
      return {
        ringClass: ring?.className,
        border: rs?.borderTopColor,
        borderW: rs?.borderTopWidth,
        shadow: rs?.boxShadow,
        digitColor: getComputedStyle(c.querySelector(".d")).color,
        afterBorder: after.borderTopColor + " " + after.borderTopWidth,
        cellClass: c.className,
        ink: root.getPropertyValue("--ink").trim(),
        wax: root.getPropertyValue("--wax").trim(),
      };
    }, cell);
    const hex = (h) => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };
    const waxOk = g.border === hex(g.wax);
    const inkOk = g.shadow?.startsWith(hex(g.ink)) || g.shadow?.includes(hex(g.ink));
    R.add(15, /err/.test(g.ringClass ?? "") && waxOk && !!inkOk && g.digitColor === hex(g.wax), `${scheme}: кольцо выбора .ring.err, внешняя рамка ${g.border} (сургуч ${g.wax}) ${g.borderW}, внутренняя тень ${g.shadow} (индиго ${g.ink}); цифра ${g.digitColor}; рамка клетки ${g.afterBorder}`);
    await shot(page, `i15-${scheme}-wrong-selected`, { clip: { x: 0, y: 100, width: 393, height: 480 } });
    await ctx.close();
  }

  // ---------- 16. ввод пальцем: размеры целей, заметки, undo, таймер ----------
  {
    const { ctx, page } = await fresh(browser);
    const g = await page.evaluate(() => {
      const c = document.querySelector('.board .cell[data-i="0"]').getBoundingClientRect();
      const k = [...document.querySelectorAll(".pad .key")].map((e) => e.getBoundingClientRect());
      const a = [...document.querySelectorAll(".actions .act")].map((e) => e.getBoundingClientRect());
      return { cellW: c.width, cellH: c.height, keyW: Math.min(...k.map((r) => r.width)), keyH: Math.min(...k.map((r) => r.height)), actH: Math.min(...a.map((r) => r.height)), actW: Math.min(...a.map((r) => r.width)) };
    });
    R.add(16, g.cellW >= 36 && g.keyW >= 36, `цели касания на 393pt: клетка ${g.cellW.toFixed(1)}x${g.cellH.toFixed(1)}, клавиша ${g.keyW.toFixed(1)}x${g.keyH.toFixed(1)}, Notes/Undo/Erase ${g.actW.toFixed(0)}x${g.actH.toFixed(1)} (в чек-листе заявлено 36-41pt; 44pt по HIG — вопрос владельцу (а))`);
    const { puzzle, solution } = await solutionOf(page);
    const empties = [...puzzle].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0);
    const [a, b] = empties;
    await place(page, a, Number(solution[a]));
    const afterDigit = await readGrid(page);
    R.add(16, afterDigit[a] === solution[a], `касание клетки + клавиши ставит цифру (${solution[a]} в клетку ${a})`);
    // заметка
    await page.locator(".actions .act").first().tap();
    const pressed = await page.locator(".actions .act").first().getAttribute("aria-pressed");
    await tapCell(page, b);
    await tapKey(page, 3);
    await tapKey(page, 7);
    const marks = await page.locator(`.board .cell[data-i="${b}"] .marks`).innerText();
    R.add(16, pressed === "true" && /3/.test(marks) && /7/.test(marks), `режим заметок (aria-pressed=${pressed}): заметки 3 и 7 в клетке ${b}`);
    await page.locator(".actions .act").first().tap(); // выкл
    // undo
    await page.locator(".actions .act").nth(1).tap();
    await page.locator(".actions .act").nth(1).tap();
    const marks2 = await page.locator(`.board .cell[data-i="${b}"] .marks`).count();
    R.add(16, marks2 === 0, `Undo дважды снимает обе заметки (меток в клетке: ${marks2})`);
    // таймер идёт и стоит в фоне
    const t1 = await clockSec(page);
    await page.waitForTimeout(2200);
    const t2 = await clockSec(page);
    await setVisibility(page, "hidden");
    await page.waitForTimeout(700); // индикатор перечитывается раз в 500 мс
    const h1 = await clockSec(page);
    await page.waitForTimeout(3000);
    const h2 = await clockSec(page);
    await setVisibility(page, "visible");
    R.add(16, t2 > t1 && h2 === h1, `таймер идёт (${t1}->${t2} с) и стоит, пока страница скрыта (${h1}->${h2} с за 3 с скрытия)`);
    await ctx.close();
  }

  // ---------- 17. стёрт только IndexedDB days: прогресс возвращается с сервера ----------
  // ---------- 18. M5 на Grid ∞: полёт, прерывание касанием, reduced motion ----------
  {
    const { ctx, page } = await fresh(browser);
    await page.evaluate(() => {
      window.__fly = [];
      new MutationObserver((ms) => {
        for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains("flyer")) window.__fly.push({ at: performance.now(), text: n.textContent });
      }).observe(document.body, { childList: true });
    });
    const token0 = await deviceToken(page);
    const dateText = await page.locator(".subline").first().innerText();
    await fillCorrect(page);
    await page.waitForSelector("[data-testid=grid-inf-section]", { timeout: 5000 });
    await page.waitForTimeout(800);
    const fly = await page.evaluate(() => window.__fly);
    const landed = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="grid-inf-target"]');
      return { cls: t?.className, left: document.querySelectorAll(".flyer").length };
    });
    R.add(18, fly.length === 1 && /landed/.test(landed.cls ?? "") && landed.left === 0, `обычное движение: появился ровно один летящий элемент (цифра "${fly[0]?.text}"), после посадки он убран, клетка Grid ∞ "${landed.cls}"`);
    await shot(page, "i18-solved-card");

    const token = await deviceToken(page);
    R.add(17, !!token && token === token0, `токен устройства в IndexedDB создан при первом запуске и не менялся (${token?.slice(0, 6)}…)`);
    const sync = await waitServer(token, SOLVED);
    R.add(17, sync.ok, `решённый день ушёл на сервер сам, без действий игрока: ${sync.ok ? "за " + sync.ms + " мс" : "НЕ дошёл, статус " + sync.status}`);
    // стираем только days (токен остаётся) и перезапускаем
    const wiped = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const rq = indexedDB.open("pundoku");
          rq.onsuccess = () => {
            const db = rq.result;
            const tx = db.transaction("days", "readwrite");
            tx.objectStore("days").clear();
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => resolve(false);
          };
        }),
    );
    await page.reload();
    let restored = false;
    try {
      await page.waitForSelector("[data-testid=grid-inf-section]", { timeout: 15000 });
      restored = true;
    } catch {
      /* не вернулось */
    }
    const tokenAfter = await deviceToken(page);
    R.add(17, wiped && restored, `стёрт только days (токен оставлен), перезапуск: решённый день и карточка ${restored ? "вернулись с сервера" : "НЕ вернулись"}; токен прежний: ${tokenAfter === token}`);
    const persist = await page.evaluate(async () => (navigator.storage?.persist ? await navigator.storage.persist() : "нет API"));
    R.add(17, true, `navigator.storage.persist() в webkit-эмуляции вернул ${persist} (на iPhone значение может отличаться — смотреть на устройстве)`);
    await ctx.close();
  }
  {
    // прерывание касанием
    const { ctx, page } = await fresh(browser);
    await page.evaluate(() => {
      window.__fly = 0;
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains("flyer")) window.__fly++; }).observe(document.body, { childList: true });
    });
    await fillCorrect(page, { keepLast: 1 });
    const { puzzle, solution } = await solutionOf(page);
    const i = [...(await readGrid(page))].findIndex((c) => c === "0");
    await tapCell(page, i);
    await page.locator(".pad .key").nth(Number(solution[i]) - 1).tap();
    await page.waitForTimeout(60); // внутри окна «гаснут данные» (200 мс), полёт ещё не начался
    await page.touchscreen.tap(30, 400);
    await page.waitForTimeout(120);
    const st = await page.evaluate(() => ({ card: !!document.querySelector("[data-testid=grid-inf-section]"), flyers: document.querySelectorAll(".flyer").length, started: window.__fly, cls: document.querySelector('[data-testid="grid-inf-target"]')?.className }));
    R.add(18, st.card && st.flyers === 0 && /landed/.test(st.cls ?? "") && !/pulse/.test(st.cls ?? ""), `касание посреди M5: конечное состояние сразу (карточка=${st.card}, летящих=${st.flyers}, полётов начато=${st.started}, клетка "${st.cls}" без пульса)`);
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, { reducedMotion: "reduce" });
    await page.evaluate(() => {
      window.__fly = 0;
      new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains("flyer")) window.__fly++; }).observe(document.body, { childList: true });
    });
    await fillCorrect(page);
    await page.waitForSelector("[data-testid=grid-inf-section]", { timeout: 5000 });
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => {
      const t = document.querySelector('[data-testid="grid-inf-target"]');
      const a = t ? getComputedStyle(t, "::after") : null;
      return { fly: window.__fly, cls: t?.className, anim: a?.animationName, dur: a?.animationDuration, reduce: matchMedia("(prefers-reduced-motion: reduce)").matches };
    });
    R.add(18, st.reduce && st.fly === 0 && /landed/.test(st.cls ?? ""), `reduced motion: полёта нет (создано летящих: ${st.fly}), клетка "${st.cls}" получает кольцо (анимация ${st.anim} ${st.dur}) вместо полёта`);
    await shot(page, "i18-reduced-card");
    await ctx.close();
  }

  // ---------- 19. смена даты при возврате из фона (часы страницы подменены) ----------
  for (const withMoves of [false, true]) {
    const now = new Date();
    const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 57, 0);
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 3, 0);
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    await page.clock.install({ time: y });
    await page.goto(BASE + "/");
    await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    const day = async () => (await page.locator(".subline").first().innerText()).split(" · ")[0];
    const day1 = await day();
    const given1 = await (await import("./lib.mjs")).givensOnly(page);
    if (withMoves) {
      const { puzzle, solution } = await solutionOf(page);
      const first = [...puzzle].findIndex((c) => c === "0");
      await place(page, first, Number(solution[first]));
    }
    await setVisibility(page, "hidden");
    await page.clock.setSystemTime(t);
    await page.waitForTimeout(500);
    await setVisibility(page, "visible");
    await page.waitForTimeout(3500);
    const day2 = await day();
    const given2 = await (await import("./lib.mjs")).givensOnly(page);
    const jsDate = await page.evaluate(() => new Date().toString().slice(0, 21));
    if (!withMoves) {
      R.add(19, day1 !== day2 && given1 !== given2, `партия вчерашнего дня без ходов, часы ${y.toString().slice(0, 21)} -> ${jsDate}, возврат из фона: день "${day1}" -> "${day2}", сетка сменилась: ${given1 !== given2}`);
      await shot(page, "i19-next-day");
    } else {
      R.add(19, day1 === day2 && given1 === given2, `вчерашняя партия с ходами при возврате после полуночи НЕ отбирается: день "${day1}" -> "${day2}", сетка та же (так задумано: README apps/web, «начатый вчерашний доигрывается»; формулировка пункта 19 «старый не остаётся» относится к непочатому дню)`);
    }
    await ctx.close();
  }

  // ---------- 20. фон и возврат во время игры ----------
  {
    const { ctx, page } = await fresh(browser);
    const { puzzle, solution } = await solutionOf(page);
    const empties = [...puzzle].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0);
    const [a, b, c] = empties;
    await place(page, a, Number(solution[a]));
    await page.locator(".actions .act").first().tap();
    await tapCell(page, b);
    await tapKey(page, 2);
    await tapKey(page, 5);
    await page.locator(".actions .act").first().tap();
    await page.waitForTimeout(2200);
    const before = { sec: await clockSec(page), grid: await readGrid(page), marks: await page.locator(`.board .cell[data-i="${b}"] .marks`).innerText() };
    await setVisibility(page, "hidden");
    await page.waitForTimeout(4000);
    await setVisibility(page, "visible");
    await page.waitForTimeout(600);
    const after = { sec: await clockSec(page), grid: await readGrid(page), marks: await page.locator(`.board .cell[data-i="${b}"] .marks`).innerText() };
    R.add(20, after.grid === before.grid && after.marks === before.marks && after.sec - before.sec <= 2, `свернуть на 4 с и вернуться: цифры и заметки на месте, таймер ${before.sec}->${after.sec} с (в фоне не шёл)`);
    await tapCell(page, c);
    await tapKey(page, Number(solution[c]));
    R.add(20, (await readGrid(page))[c] === solution[c], `ввод после возврата работает`);
    // «iOS выгрузил PWA»: перезапуск страницы
    await page.waitForTimeout(2200);
    const pre = { sec: await clockSec(page), grid: await readGrid(page) };
    await page.reload();
    await page.waitForSelector(".board .cell .d.given", { timeout: 25000 });
    await page.waitForTimeout(500);
    const post = { sec: await clockSec(page), grid: await readGrid(page), marks: await page.locator(`.board .cell[data-i="${b}"] .marks`).innerText() };
    R.add(20, post.grid === pre.grid && /2/.test(post.marks) && /5/.test(post.marks) && Math.abs(post.sec - pre.sec) <= 2, `полный перезапуск страницы (как выгрузка PWA из памяти): цифры и заметки восстановлены, таймер ${pre.sec}->${post.sec} с`);
    await ctx.close();
  }

  // ---------- 22. решить день без сети, вернуть сеть: прогресс уходит сам ----------
  {
    const { ctx, page } = await fresh(browser, { extra: { serviceWorkers: "block" } }); // SW обошёл бы page.route
    await page.waitForTimeout(2500); // регистрация устройства
    const token = await deviceToken(page);
    await page.route("**/api/**", (r) => r.abort("internetdisconnected"));
    await fillCorrect(page);
    await page.waitForSelector("[data-testid=grid-inf-section]", { timeout: 5000 });
    await page.waitForTimeout(3500); // попытки синхронизации должны упасть, а игра — не сломаться
    const sol = await api("/api/snapshot", { headers: { authorization: `Bearer ${token}` } });
    const notYet = !SOLVED.test(sol.text);
    R.add(22, !!token && notYet, `пока сети нет, решённый день на сервере отсутствует (GET snapshot: ${sol.status}); карточка дня показана локально`);
    await page.unroute("**/api/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    const sync = await waitServer(token, SOLVED, 30000);
    R.add(22, sync.ok, `после возврата сети (событие online) день ушёл на сервер сам: ${sync.ok ? "за " + sync.ms + " мс" : "НЕ ушёл, статус " + sync.status}`);
    await ctx.close();
  }
}
