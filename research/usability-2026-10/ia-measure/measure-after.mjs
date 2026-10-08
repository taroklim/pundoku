// PD-140 ПЕРЕМЕР: путь от запуска до первого хода на main 96bbd4a (пакеты A–E, C, PD-139, PD-142, PD-144 смержены), Playwright webkit (+chromium для сверки).
// Запуск: ENGINES=webkit COLD=3 WARM=3 [VIEW=320x568] node measure-after.mjs   (стенд: docs/ios-selfcheck/stack.sh, БД pundoku_iarem, web :3992, api :5992)
// Профиль «ветерана» сеется один раз (play 25.09 частично, 28.09–01.10 решено) в /tmp/pundoku-iarem/state-vet.json; IndexedDB — вручную, с ожиданием tx.oncomplete.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BASE, H, STATE_DIR, Run, THUMB_Y, armMark, fixturePage, instrument, launch, newProfileCtx, placeFirstDigit, seedVeteran, selectedCell, snapshotProfile, solveFromDom, waitMark } from "./lib-after.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINES = (process.env.ENGINES ?? "webkit").split(",");
const COLD = Number(process.env.COLD ?? 3);
const WARM = Number(process.env.WARM ?? 3);
const ONLY = process.env.ONLY ? process.env.ONLY.split(",") : null;
const VET = join(STATE_DIR, "state-vet.json");
const OUT = process.env.OUT ?? join(HERE, "results-after.json");

const med = (a) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const stat = (a) => (a.length ? { median: Math.round(med(a)), min: Math.round(Math.min(...a)), max: Math.round(Math.max(...a)), n: a.length } : null);

const q = {
  tab: (page, i) => page.locator(".tab").nth(i), // 0 Today, 1 Play, 2 Year
  key: (page, d) => page.locator(".pad .key").nth(d - 1),
  playBoard: ".play:not(.today) .board:not(.idle) .cell .d.given",
  todayBoard: ".play.today .board:not(.idle) .cell .d.given",
  archiveBoard: '[data-testid="archive-screen"] .board:not(.idle) .cell .d.given',
};

async function ready(page, run, sel = ".board:not(.idle) .cell .d.given") {
  await waitMark(page, "board");
  await run.step("board_ready");
}
async function playerDigits(page) {
  return page.locator(".board .cell .d.player").count();
}
/** Поставить n верных значений подряд (не считается в замер — подготовка состояния). */
async function placeN(page, n) {
  const { puzzle, solution } = await solveFromDom(page);
  const empties = [...puzzle].map((c, i) => (c === "0" ? i : -1)).filter((i) => i >= 0).slice(0, n);
  for (const i of empties) {
    await page.locator(`.board .cell[data-i="${i}"]`).tap();
    await q.key(page, Number(solution[i])).tap();
  }
  await page.waitForTimeout(1200);
}
const selectedHasDigit = (page) => page.evaluate(() => !!document.querySelector('.board .cell[aria-current="true"]')?.querySelector(".d"));
/** Проверка «умещается ли экран»: прокручиваемость, нижняя кромка ключевых элементов относительно окна и таб-бара. */
export const fit = (page) =>
  page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), w: Math.round(b.width) };
    };
    const tabbar = r(".tabbar") ?? r("nav");
    const root = document.querySelector(".play");
    const scr = document.querySelector(".scroll");
    const hub = document.querySelector('[data-testid="hub-scroll"]');
    return {
      vw: innerWidth, vh: innerHeight,
      docScrolls: document.documentElement.scrollHeight > innerHeight + 1,
      scrollEl: scr ? { scrollHeight: scr.scrollHeight, clientHeight: scr.clientHeight } : null,
      playRoot: root ? { cls: root.className, scrollHeight: root.scrollHeight, clientHeight: root.clientHeight } : null,
      hubScroll: hub ? { scrollHeight: hub.scrollHeight, clientHeight: hub.clientHeight, scrolls: hub.scrollHeight > hub.clientHeight + 1 } : null,
      tabbarTop: tabbar?.top ?? null,
      board: r(".board"), pad: r(".pad"), gap: r(".gap"), start: r('[data-testid="setup-start"]'), hubBar: r(".hub-bar"), diffList: r('[data-testid="difficulty-list"]'), modeRow: r('[data-testid="mode-row"]'),
      hintDock: r('[data-testid="hint-dock"]'), subline: r(".subline"), toolbar: r("header, .tab-header"),
    };
  });
const mk = (page, name) => page.evaluate((n) => window.__ia.marks[n] ?? null, name);

/** Инвентарь первого экрана: интерактивные элементы и ориентиры с y (pt) и зоной. */
export async function inventory(page) {
  return page.evaluate((thumb) => {
    const zone = (y) => (y >= thumb ? "thumb" : y >= window.innerHeight / 3 ? "mid" : "top");
    const items = [];
    const seen = new Set();
    const sel = 'button, select, a[href], input, h1, h2, .subline, .board, .gap, .pad, .today-status, .sect-head, .ink-foot, .year-totals, .year-legend, .status, .source, .year-empty, .tabbar, nav, .hub-head, .hub-foot, .hub-bar';
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest(".cell") && !el.classList.contains("board")) continue;
      if (el.closest(".pad") && el.tagName === "BUTTON" && el.classList.contains("key")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || r.bottom < 0 || r.top > window.innerHeight) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.opacity === "0") continue;
      if (el.closest(".sr-only") || el.classList.contains("sr-only")) continue;
      const label = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 44);
      const kind = el.tagName === "BUTTON" || el.tagName === "SELECT" || el.tagName === "A" || el.tagName === "INPUT" ? "interactive" : "landmark";
      const key = `${el.tagName}.${el.className}.${Math.round(r.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ kind, el: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/)[0] : ""}`, label, y: Math.round(r.y), cy: Math.round(r.y + r.height / 2), h: Math.round(r.height), zone: zone(r.y + r.height / 2) });
    }
    // 81 клеток и 9 цифр сворачиваем в одну строку на группу
    const cell0 = document.querySelector(".board .cell");
    const board = document.querySelector(".board")?.getBoundingClientRect();
    const keys = [...document.querySelectorAll(".pad .key")].map((k) => k.getBoundingClientRect());
    if (board) items.push({ kind: "interactive", el: "board .cell x81", label: "cells (tap target 39pt)", y: Math.round(board.y), cy: Math.round(board.y + board.height / 2), h: Math.round(board.height), zone: zone(board.y + board.height / 2), note: `y ${Math.round(board.y)}..${Math.round(board.bottom)}; cell ${Math.round(cell0?.getBoundingClientRect().height ?? 0)}pt` });
    if (keys.length) items.push({ kind: "interactive", el: ".pad .key x9", label: "digits 1-9 (tap target 37x56pt)", y: Math.round(keys[0].y), cy: Math.round(keys[0].y + keys[0].height / 2), h: Math.round(keys[0].height), zone: zone(keys[0].y + keys[0].height / 2) });
    items.sort((a, b) => a.y - b.y);
    return { count: items.filter((i) => i.kind === "interactive").length, items };
  }, THUMB_Y);
}

// ===================== сценарии =====================
// Каждый возвращает { times: {имя: мс}, info: {...} }; run накапливает тапы.
const SC = {
  // (а) ветеран: ежедневка — запуск → первая цифра
  async a_vet_daily(page, run, o) {
    await page.goto(BASE + "/");
    const b = await waitMark(page, "board");
    await run.step("board_ready");
    const inv = o.inv ? await inventory(page) : undefined;
    if (o.shots) await run.shot("a-today-launch");
    const first = await placeFirstDigit(run);
    const d = await waitMark(page, "digit");
    await run.step("first_digit");
    if (o.shots) await run.shot("a-today-first-digit");
    return { times: { nav_to_board: b.t, nav_to_board_painted: b.paint ?? b.t, nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown, app_time_no_script_gaps: (b.paint ?? b.t) + d.sinceDown }, info: { ...first, inventory: inv } };
  },

  // (б) ветеран: Play на hard — запуск → Play → hard → Start → цифра
  async b_vet_play_hard(page, run, o) {
    await page.goto(BASE + "/");
    const tb = await waitMark(page, "board");
    await run.step("today_ready");
    await armMark(page, "setup", '[data-testid="hub-scroll"]');
    await run.tap("tab Play", q.tab(page, 1));
    const su = await waitMark(page, "setup");
    await run.step("setup_visible");
    const invSetup = o.inv ? await inventory(page) : undefined;
    const fitHub = await fit(page);
    if (o.shots) await run.shot("b-play-hub");
    await run.tap("row Hard (radio)", page.locator('[data-testid="difficulty-hard"]'));
    if (o.shots) await run.shot("b-play-hub-hard-picked");
    await armMark(page, "playBoard", q.playBoard);
    await run.tap("Start", page.locator('[data-testid="setup-start"]'));
    const pb = await waitMark(page, "playBoard", 90000);
    await run.step("play_board_ready");
    const invBoard = o.inv ? await inventory(page) : undefined;
    const fitBoard = await fit(page);
    if (o.shots) await run.shot("b-play-board-hard");
    await armMark(page, "digit2", ".play:not(.today) .board .cell .d.player");
    const first = await placeFirstDigit(run);
    const d = await waitMark(page, "digit2");
    await run.step("first_digit");
    const subline = await page.locator(".subline").first().innerText();
    return { times: { nav_to_play_board: pb.t, tap_play_to_setup: su.sinceDown, start_tap_to_board: pb.sinceDown, nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown, app_time_no_script_gaps: (tb.paint ?? tb.t) + su.sinceDown + pb.sinceDown + d.sinceDown }, info: { ...first, subline, inventory_setup: invSetup, inventory_board: invBoard, fitHub, fitBoard } };
  },

  // (б0) ветеран: свободная партия на сложности по умолчанию (Medium): Play → Start → цифра
  async b0_vet_play_default(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await armMark(page, "setup", '[data-testid="hub-scroll"]');
    await run.tap("tab Play", q.tab(page, 1));
    await waitMark(page, "setup");
    await armMark(page, "playBoard", q.playBoard);
    await run.tap("Start", page.locator('[data-testid="setup-start"]'));
    const pb = await waitMark(page, "playBoard", 90000);
    await run.step("play_board_ready");
    await armMark(page, "digit2", ".play:not(.today) .board .cell .d.player");
    const first = await placeFirstDigit(run);
    const d = await waitMark(page, "digit2");
    await run.step("first_digit");
    return { times: { start_tap_to_board: pb.sinceDown, nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown }, info: { ...first, subline: await page.locator(".subline").first().innerText() } };
  },

  // (в) новичок: чистый профиль, первый запуск
  async c_newbie(page, run, o) {
    const t0 = Date.now();
    await page.goto(BASE + "/");
    const early = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | ").slice(0, 200));
    const b = await waitMark(page, "board");
    await run.step("board_ready");
    const text = await page.evaluate(() => document.body.innerText.replace(/\n+/g, " | "));
    const dialogs = await page.locator('[role="dialog"], [role="alertdialog"], .ink-scrim, .tour, .onboarding').count();
    const ls = await page.evaluate(() => Object.keys(localStorage));
    const inv = o.inv ? await inventory(page) : undefined;
    if (o.shots) await run.shot("c-newbie-first-launch");
    const first = await placeFirstDigit(run);
    const d = await waitMark(page, "digit");
    await run.step("first_digit");
    if (o.shots) await run.shot("c-newbie-first-digit");
    let probes;
    if (o.inv) {
      // где можно застрять: (1) тап по заданной клетке + цифра; (2) неверная цифра; (3) цифра без выбранной клетки
      const { puzzle, solution } = await solveFromDom(page);
      const given = puzzle.split("").findIndex((c) => c !== "0");
      const before = await page.locator(".board .cell .d.player").count();
      await page.locator(`.board .cell[data-i="${given}"]`).tap();
      await q.key(page, 5).tap();
      const afterGiven = await page.locator(".board .cell .d.player").count();
      const statusGiven = await page.locator(".today-status, .gap").first().innerText();
      const empty = puzzle.split("").findIndex((c, i) => c === "0" && i !== first.cell);
      const wrong = (Number(solution[empty]) % 9) + 1;
      await page.locator(`.board .cell[data-i="${empty}"]`).tap();
      await q.key(page, wrong).tap();
      const errCount = await page.locator(".board .cell .d.err").count();
      const statusWrong = await page.locator(".today-status, .gap").first().innerText();
      probes = { tapGivenThenDigit_changed: afterGiven !== before, statusAfterGivenTap: statusGiven.replace(/\n+/g, " | "), wrongDigitMarkedRed: errCount > 0, statusAfterWrong: statusWrong.replace(/\n+/g, " | "), hasCheckButton: (await page.getByText(/check|hint/i).count()) > 0 };
      if (o.shots) await run.shot("c-newbie-wrong-digit");
    }
    return { times: { nav_to_board: b.t, nav_to_board_painted: b.paint ?? b.t, nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown, app_time_no_script_gaps: (b.paint ?? b.t) + d.sinceDown }, info: { ...first, textEarly: early, textAtReady: text, dialogsOrTours: dialogs, localStorageKeys: ls, probes, inventory: inv } };
  },

  // (г1) Ink на Today (до первого хода)
  async g1_ink_today(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await run.step("board_ready");
    if (o.shots) await run.shot("g-ink-today-before");
    await run.tap("Ink mode row", page.locator('[data-testid="ink-row"]'));
    await page.waitForSelector('[data-testid="ink-sheet"]');
    await run.step("sheet_open");
    if (o.shots) await run.shot("g-ink-today-sheet");
    const sheetText = await page.locator('[data-testid="ink-sheet"]').innerText();
    await run.tap("Play in ink", page.locator('[data-testid="ink-rule-start"]'));
    await page.waitForSelector('[data-testid="ink-sheet"]', { state: "detached" });
    await run.step("sheet_closed");
    const subline = await page.locator(".subline").first().innerText();
    if (o.shots) await run.shot("g-ink-today-on");
    const gapText = (await page.locator(".gap").first().innerText()).replace(/\n+/g, " | ");
    const first = await placeFirstDigit(run);
    const d = await waitMark(page, "digit");
    await run.step("first_digit");
    const afterDigit = (await page.locator(".gap").first().innerText()).replace(/\n+/g, " | ");
    return { times: { nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown }, info: { ...first, sheetText: sheetText.replace(/\n+/g, " | "), sublineAfter: subline, gapAfterChoose: gapText, gapAfterFirstDigit: afterDigit, ink_row_visible_after_first_move: await page.locator('[data-testid="ink-row"]').count() } };
  },
  // (г2) Ink на Play: Play → «Режим» → шит → «Чернила» → правило «Play in ink» → «Готово» → Start → цифра
  async g2_ink_play(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await armMark(page, "setup", '[data-testid="hub-scroll"]');
    await run.tap("tab Play", q.tab(page, 1));
    await waitMark(page, "setup");
    await run.step("hub_visible");
    await run.tap("Mode row", page.locator('[data-testid="mode-row"]'));
    await page.waitForSelector('[data-testid="mode-sheet"]');
    await run.step("mode_sheet_open");
    if (o.shots) await run.shot("g-ink-play-mode-sheet");
    await run.tap("option Ink", page.locator('[data-testid="mode-ink"]'));
    await page.waitForSelector('[data-testid="ink-sheet"]');
    if (o.shots) await run.shot("g-ink-play-rule-sheet");
    await run.tap("Play in ink", page.locator('[data-testid="ink-rule-start"]'));
    await page.waitForSelector('[data-testid="ink-sheet"]', { state: "detached" });
    await run.tap("Done (mode sheet)", page.locator('[data-testid="mode-done"]'));
    await page.waitForSelector('[data-testid="mode-sheet"]', { state: "detached" });
    const rowValue = await page.locator('[data-testid="mode-value"]').innerText();
    if (o.shots) await run.shot("g-ink-play-hub-on");
    await armMark(page, "playBoard", q.playBoard);
    await run.tap("Start", page.locator('[data-testid="setup-start"]'));
    const pb = await waitMark(page, "playBoard", 90000);
    await run.step("play_board_ready");
    await armMark(page, "digit2", ".play:not(.today) .board .cell .d.player");
    const first = await placeFirstDigit(run);
    const d = await waitMark(page, "digit2");
    await run.step("first_digit");
    const subline = await page.locator(".subline").first().innerText();
    return { times: { start_tap_to_board: pb.sinceDown, nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown }, info: { ...first, rowValueAfterChoose: rowValue, subline, fit: await fit(page) } };
  },

  // (д1) Today: незаконченная партия, «закрыли и открыли снова»
  async d1_resume_today(page, run, o) {
    // подготовка (не в замер): 3 значения + переключение вкладок
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await placeN(page, 3);
    const prep = new Run(page, "prep");
    await prep.tap("Year", q.tab(page, 2));
    await prep.tap("Today", q.tab(page, 0));
    await page.waitForSelector(".board .cell");
    await page.waitForTimeout(300);
    const retainedAfterTabSwitch = await playerDigits(page);
    const tabSwitchTaps = prep.taps.length;
    await page.waitForTimeout(800);
    const state = await snapshotProfile(page.context());
    return { prepared: true, state, tabSwitch: { taps: tabSwitchTaps, retained: retainedAfterTabSwitch }, async measure(page2, run2, o2) {
      await page2.goto(BASE + "/");
      const b = await waitMark(page2, "board");
      await run2.step("board_ready");
      const digitsVisible = await playerDigits(page2);
      const sel = await selectedCell(page2);
      const sub = await page2.locator(".subline").first().innerText();
      if (o2.shots) await run2.shot("d-today-resumed");
      const selFilled = await selectedHasDigit(page2);
      const first = await placeFirstDigit(run2);
      await run2.step("next_digit");
      const digitsAfter = await playerDigits(page2);
      return { times: { nav_to_board: b.t, nav_to_board_painted: b.paint ?? b.t }, info: { selectedCellAlreadyFilled: selFilled, digitsBefore: digitsVisible, digitsAfterNextTap: digitsAfter, digitsRestored: digitsVisible, selectedAfterResume: sel, subline: sub.replace(/\n+/g, " | "), ...first } };
    } };
  },
  // (д2) Play: незаконченная партия → закрыли и открыли (PD-116: партия переживает перезагрузку, слот «Продолжить» на хабе)
  async d2_resume_play(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    const prep = new Run(page, "prep");
    await prep.tap("Play", q.tab(page, 1));
    await prep.tap("Start", page.locator('[data-testid="setup-start"]'));
    await page.waitForSelector(q.playBoard, { timeout: 60000 });
    await placeN(page, 3);
    const nBefore = await playerDigits(page);
    await prep.tap("Today", q.tab(page, 0));
    await page.waitForSelector(".board .cell");
    await prep.tap("Play", q.tab(page, 1));
    await page.waitForSelector(".board .cell, [data-testid=hub-scroll]");
    await page.waitForTimeout(300);
    const retained = await playerDigits(page);
    const hubAfterTabSwitch = (await page.locator('[data-testid="hub-scroll"]').count()) > 0;
    await page.waitForTimeout(800);
    const state = await snapshotProfile(page.context());
    return { prepared: true, state, tabSwitch: { taps: 2, before: nBefore, retained, hubShownAfterInSessionReturn: hubAfterTabSwitch }, async measure(page2, run2, o2) {
      let times = {};
      await page2.goto(BASE + "/");
      const tb = await waitMark(page2, "board");
      await run2.step("today_ready");
      await armMark(page2, "pv", '[data-testid="hub-scroll"], .play:not(.today) .board .cell');
      await run2.tap("tab Play", q.tab(page2, 1));
      const pv = await waitMark(page2, "pv");
      times = { nav_to_today_board: tb.t, tap_play_to_visible: pv.sinceDown };
      await run2.step("play_visible");
      const hub = (await page2.locator('[data-testid="hub-scroll"]').count()) > 0;
      const contOwn = (await page2.locator('[data-testid="continue-own"]').count()) > 0;
      const contText = contOwn ? (await page2.locator('[data-testid="continue-own"]').innerText()).replace(/\n+/g, " | ") : null;
      if (o2.shots) await run2.shot("d-play-after-reopen-hub");
      let first = null;
      if (contOwn) {
        await armMark(page2, "playBoard", q.playBoard);
        await run2.tap("Continue (own grid)", page2.locator('[data-testid="continue-own"]'));
        const nb = await waitMark(page2, "playBoard", 90000);
        times.continue_tap_to_board = nb.sinceDown;
        await page2.waitForTimeout(300);
        const digitsVisible = await playerDigits(page2);
        const sel = await selectedCell(page2);
        const selFilled = await selectedHasDigit(page2);
        if (o2.shots) await run2.shot("d-play-continued-board");
        await run2.step("continued_board");
        first = { digitsRestored: digitsVisible, selectedAfterContinue: sel, selectedCellAlreadyFilled: selFilled, ...(await placeFirstDigit(run2)) };
        await run2.step("next_digit");
      }
      return { times, info: { hubShownAfterReopen: hub, continueOwnSlot: contOwn, continueText: contText, ...first } };
    } };
  },

  // (з) «Продолжить игру дня» с хаба Play: Play → строка «Today’s puzzle» → доска дня → следующий ход
  async i_continue_day_from_hub(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await placeN(page, 3);
    await page.waitForTimeout(800);
    const state = await snapshotProfile(page.context());
    return { prepared: true, state, tabSwitch: { taps: 0 }, async measure(page2, run2, o2) {
      await page2.goto(BASE + "/");
      await waitMark(page2, "board");
      await armMark(page2, "setup", '[data-testid="hub-scroll"]');
      await run2.tap("tab Play", q.tab(page2, 1));
      await waitMark(page2, "setup");
      const contDay = (await page2.locator('[data-testid="continue-day"]').count()) > 0;
      const contText = contDay ? (await page2.locator('[data-testid="continue-day"]').innerText()).replace(/\n+/g, " | ") : null;
      if (o2.shots) await run2.shot("i-hub-with-day-slot");
      await armMark(page2, "tb", ".play.today .board .cell");
      await run2.tap("Continue (day)", page2.locator('[data-testid="continue-day"]'));
      const tb = await waitMark(page2, "tb");
      await run2.step("today_board");
      await page2.waitForTimeout(300);
      const first = await placeFirstDigit(run2);
      await run2.step("next_digit");
      return { times: { continue_tap_to_today_board: tb.sinceDown }, info: { continueDaySlot: contDay, continueText: contText, tabAfter: await page2.locator('.tab[aria-selected="true"]').innerText().catch(() => null), ...first } };
    } };
  },

  // (и) сменить сложность посреди свободной партии: ⋯ → «Новая сетка» → строка сложности → Start → «Отбросить» → цифра
  async j_change_difficulty_midgame(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    const prep = new Run(page, "prep");
    await prep.tap("Play", q.tab(page, 1));
    await prep.tap("Start", page.locator('[data-testid="setup-start"]'));
    await page.waitForSelector(q.playBoard, { timeout: 60000 });
    await placeN(page, 3);
    await run.step("midgame");
    if (o.shots) await run.shot("j-midgame-board");
    await run.tap("⋯ menu", page.locator('[data-testid="more-button"]'));
    await page.waitForSelector('[data-testid="more-menu"]');
    if (o.shots) await run.shot("j-more-menu");
    await armMark(page, "hub", '[data-testid="hub-scroll"]');
    await run.tap("New grid (menu)", page.locator('[data-testid="menu-new"]'));
    const h = await waitMark(page, "hub");
    await run.step("hub");
    if (o.shots) await run.shot("j-hub-with-own-slot");
    await run.tap("row Hard", page.locator('[data-testid="difficulty-hard"]'));
    await run.tap("Start", page.locator('[data-testid="setup-start"]'));
    await page.waitForSelector('[data-testid="action-sheet"]');
    if (o.shots) await run.shot("j-discard-sheet");
    await armMark(page, "playBoard", q.playBoard);
    await run.tap("Discard (sheet)", page.locator('[data-testid="action-sheet-go"]'));
    const pb = await waitMark(page, "playBoard", 90000);
    await run.step("new_board");
    const first = await placeFirstDigit(run);
    await run.step("first_digit");
    return { times: { menu_tap_to_hub: h.sinceDown, discard_tap_to_board: pb.sinceDown }, info: { ...first, subline: await page.locator(".subline").first().innerText() } };
  },

  // (к) вернуться на хаб из партии Play: два пути — «⋯ → Новая сетка» и повторный тап по вкладке Play
  async l_back_to_hub(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    const prep = new Run(page, "prep");
    await prep.tap("Play", q.tab(page, 1));
    await prep.tap("Start", page.locator('[data-testid="setup-start"]'));
    await page.waitForSelector(q.playBoard, { timeout: 60000 });
    await placeN(page, 3);
    await armMark(page, "hub", '[data-testid="hub-scroll"]');
    await run.tap("⋯ menu", page.locator('[data-testid="more-button"]'));
    await run.tap("New grid (menu)", page.locator('[data-testid="menu-new"]'));
    const h = await waitMark(page, "hub");
    await run.step("hub_via_menu");
    const cont = await page.locator('[data-testid="continue-own"]').innerText().catch(() => null);
    await armMark(page, "board2", ".play:not(.today) .board .cell");
    await run.tap("Continue (own grid)", page.locator('[data-testid="continue-own"]'));
    await waitMark(page, "board2");
    await run.step("back_on_board");
    // второй путь: повторный тап по вкладке Play, когда партия на экране
    const run2 = new Run(page, "retap");
    await armMark(page, "hub3", '[data-testid="hub-scroll"]');
    await run2.tap("tab Play (re-tap)", q.tab(page, 1));
    await waitMark(page, "hub3");
    const hubViaRetap = (await page.locator('[data-testid="hub-scroll"]').count()) > 0;
    // и третий: уйти на Today и вернуться на Play — партия или хаб?
    await run2.tap("Today", q.tab(page, 0));
    await page.waitForSelector(".play.today .board .cell");
    await run2.tap("tab Play", q.tab(page, 1));
    await page.waitForTimeout(500);
    const afterRoundTrip = (await page.locator('[data-testid="hub-scroll"]').count()) > 0 ? "hub" : "board";
    return { times: { menu_tap_to_hub: h.sinceDown }, info: { continueRowText: cont, hubViaRetap, retapTaps: 1, afterTodayAndBackShows: afterRoundTrip } };
  },

  // (л) взять подсказку: Today — лампочка → шит правила (1-й раз) → ступень 1 → «Ещё шаг» ×3
  async k_hint_today(page, run, o) { return hintScenario(page, run, o, "today"); },
  async k_hint_play(page, run, o) { return hintScenario(page, run, o, "play"); },

  // (инвентарь) Today после решения: карточка дня + Grid ∞ (профиль ветерана, часы на 01.10)
  async h_today_solved_grid(page, run, o) {
    await page.clock.install({ time: new Date("2026-10-01T12:00:00") });
    await page.goto(BASE + "/");
    await page.waitForSelector('[data-testid="grid-inf-section"], .result, .card', { timeout: 40000 });
    await page.waitForTimeout(2500);
    const inv = await inventory(page);
    const grid = await page.evaluate(() => { const g = document.querySelector('[data-testid="grid-inf-section"]'); if (!g) return null; const r = g.getBoundingClientRect(); return { y: Math.round(r.y), h: Math.round(r.height), pageScrollHeight: document.querySelector(".scroll")?.scrollHeight ?? null }; });
    await run.shot("h-today-solved-card");
    await page.evaluate(() => document.querySelector(".scroll")?.scrollTo(0, 99999));
    await page.waitForTimeout(400);
    await run.shot("h-today-solved-grid");
    return { times: {}, info: { gridSection: grid, inventory: inv } };
  },

  // (е) архив прошлой даты: Year → месяц → день → решение
  async e_archive_missed(page, run, o) { return archive(page, run, o, "2026-09-27", "play-day"); },
  async e_archive_unfinished(page, run, o) { return archive(page, run, o, "2026-09-25", "finish-day"); },
  async e_archive_solved(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await run.tap("tab Year", q.tab(page, 2));
    await page.waitForSelector(".year-month");
    await run.tap("month Sep", page.locator(".year-month").nth(8));
    await page.waitForSelector('[data-testid="month-page"] .ycell');
    await armMark(page, "card", '[data-testid="day-card"]');
    await run.tap("day 29 Sep (solved)", page.locator('button[data-date="2026-09-29"]'));
    const c = await waitMark(page, "card");
    await run.step("day_card");
    if (o.shots) await run.shot("e-archive-solved-card");
    return { times: { tap_to_card: c.sinceDown }, info: { cardText: (await page.locator('[data-testid="day-card"]').innerText()).replace(/\n+/g, " | ").slice(0, 200) } };
  },

  // (ж) Year / статистика: запуск → Year → шит дня
  async f_year_sheet(page, run, o) {
    await page.goto(BASE + "/");
    await waitMark(page, "board");
    await run.step("today_ready");
    await armMark(page, "year", ".year-month");
    await run.tap("tab Year", q.tab(page, 2));
    const y = await waitMark(page, "year");
    await run.step("year_visible");
    const inv = o.inv ? await inventory(page) : undefined;
    if (o.shots) await run.shot("f-year");
    const totals = await page.locator('[data-testid="year-totals"]').innerText();
    await armMark(page, "sheet", '[data-testid="month-page"] .ycell');
    await run.tap("month Sep", page.locator(".year-month").nth(8));
    const s = await waitMark(page, "sheet");
    await run.step("month_sheet");
    if (o.shots) await run.shot("f-year-month-sheet");
    await armMark(page, "card", '[data-testid="day-card"]');
    await run.tap("day 29 Sep", page.locator('button[data-date="2026-09-29"]'));
    const c = await waitMark(page, "card");
    await run.step("day_card");
    if (o.shots) await run.shot("f-year-day-card");
    return { times: { tap_year_to_visible: y.sinceDown, tap_month_to_sheet: s.sinceDown, tap_day_to_card: c.sinceDown, nav_to_day_card: c.t }, info: { totals, inventory: inv } };
  },
};

async function archive(page, run, o, date, btn) {
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  await run.step("today_ready");
  await run.tap("tab Year", q.tab(page, 2));
  await page.waitForSelector(".year-month");
  await run.tap("month Sep", page.locator(".year-month").nth(8));
  await page.waitForSelector('[data-testid="month-page"] .ycell');
  await armMark(page, "card", '[data-testid="day-card"]');
  await run.tap(`day ${date}`, page.locator(`button[data-date="${date}"]`));
  await waitMark(page, "card");
  await run.step("day_card");
  const cardText = (await page.locator('[data-testid="day-card"]').innerText()).replace(/\n+/g, " | ").slice(0, 220);
  if (o.shots) await run.shot(`e-archive-${btn}-card`);
  await armMark(page, "aboard", q.archiveBoard);
  await run.tap(btn === "play-day" ? "Play this day's puzzle" : "Finish this puzzle", page.locator(`[data-testid="${btn}"]`));
  const ab = await waitMark(page, "aboard", 90000);
  await run.step("archive_board");
  if (o.shots) await run.shot(`e-archive-${btn}-board`);
  const sel = await selectedCell(page);
  const had = await playerDigits(page);
  const selFilled = await selectedHasDigit(page);
  await armMark(page, "digit2", '[data-testid="archive-screen"] .board .cell .d.player');
  const first = await placeFirstDigit(run);
  await page.waitForTimeout(300);
  const d = (await mk(page, "digit2")) ?? { t: NaN, sinceDown: NaN };
  const hadAfter = await playerDigits(page);
  await run.step("first_digit");
  return { times: { tap_play_to_board: ab.sinceDown, nav_to_first_digit: d.t, tap_to_digit_dom: d.sinceDown }, info: { cardText, selectedOnOpen: sel, selectedCellAlreadyFilled: selFilled, digitsAlreadyThere: had, digitsAfterFirstTap: hadAfter, ...first } };
}

async function hintScenario(page, run, o, where) {
  await page.goto(BASE + "/");
  await waitMark(page, "board");
  if (where === "play") {
    const prep = new Run(page, "prep");
    await prep.tap("Play", q.tab(page, 1));
    await prep.tap("Start", page.locator('[data-testid="setup-start"]'));
    await page.waitForSelector(q.playBoard, { timeout: 60000 });
  }
  await run.step("board_ready");
  if (o.shots) await run.shot(`k-hint-${where}-before`);
  const lamp = await page.locator('[data-testid="hint-button"]').count();
  await armMark(page, "rule", '[data-testid="hint-rule-sheet"]');
  await run.tap("lamp", page.locator('[data-testid="hint-button"]'));
  const ru = await waitMark(page, "rule");
  await run.step("rule_sheet");
  if (o.shots) await run.shot(`k-hint-${where}-rule`);
  await armMark(page, "dock", '[data-testid="hint-dock"]');
  await run.tap("Show hint (rule sheet)", page.locator('[data-testid="hint-rule-go"]'));
  const dk = await waitMark(page, "dock");
  await run.step("hint_step1");
  const tapsToStep1 = run.taps.length;
  const step1 = (await page.locator('[data-testid="hint-live"]').innerText()).replace(/\n+/g, " | ");
  const fitDock = await fit(page);
  if (o.shots) await run.shot(`k-hint-${where}-step1`);
  for (let k = 2; k <= 4; k++) {
    await run.tap(`More (step ${k})`, page.locator('[data-testid="hint-more"]'));
    await page.waitForFunction((n) => document.querySelector('[data-testid="hint-dock"]')?.getAttribute("data-step") === String(n), k);
  }
  await run.step("hint_step4");
  const step4 = (await page.locator('[data-testid="hint-live"]').innerText()).replace(/\n+/g, " | ");
  if (o.shots) await run.shot(`k-hint-${where}-step4`);
  const kind = await page.locator('[data-testid="hint-dock"]').getAttribute("data-kind");
  await run.tap("Got it (close)", page.locator('[data-testid="hint-more"]'));
  await page.waitForSelector('[data-testid="hint-dock"]', { state: "detached" });
  await run.step("dock_closed");
  const first = await placeFirstDigit(run);
  await run.step("digit_after_hint");
  return { times: { lamp_tap_to_rule: ru.sinceDown, rule_go_to_dock: dk.sinceDown }, info: { tapsToStep1, tapsToStep4: tapsToStep1 + 3, lampPresent: lamp, hintKind: kind, step1: step1.slice(0, 160), step4: step4.slice(0, 200), fitDock, ...first } };
}

// ===================== прогон =====================
const NEEDS_VET = new Set(["a_vet_daily", "b_vet_play_hard", "b0_vet_play_default", "i_continue_day_from_hub", "j_change_difficulty_midgame", "l_back_to_hub", "k_hint_today", "k_hint_play", "g1_ink_today", "g2_ink_play", "d1_resume_today", "d2_resume_play", "e_archive_missed", "e_archive_unfinished", "e_archive_solved", "f_year_sheet", "h_today_solved_grid"]);
const SECOND = new Set(["d1_resume_today", "d2_resume_play", "i_continue_day_from_hub"]); // двухфазные: подготовка + замер после «закрытия»

/** Прогрев кэша: загрузить приложение, дождаться service worker, закрыть страницу; для чистого профиля затем стереть IDB/localStorage. */
async function prime(ctx, { wipe }) {
  const p = await ctx.newPage();
  await p.goto(BASE + "/");
  await p.waitForFunction(() => window.__ia?.marks?.board, null, { timeout: 60000 });
  const sw = await p.evaluate(() => (navigator.serviceWorker ? Promise.race([navigator.serviceWorker.ready.then(() => "ready"), new Promise((r) => setTimeout(() => r("timeout"), 8000))]) : "unsupported"));
  await p.waitForTimeout(500);
  await p.goto("about:blank");
  await p.close();
  if (wipe) {
    // PD-217: стирать на странице без приложения (`fixturePage`): /health на стенде vite (и через navigateFallback service
    // worker) отдаёт index.html — приложение тут же заново открывало базу, deleteDatabase упирался в blocked.
    const f = await fixturePage(ctx, BASE);
    try {
      await f.page.evaluate(async () => {
        localStorage.clear();
        const dbs = (await indexedDB.databases?.()) ?? [];
        await Promise.all(dbs.map((d) => new Promise((r) => { const q = indexedDB.deleteDatabase(d.name); q.onsuccess = q.onerror = q.onblocked = () => r(); })));
      });
    } finally {
      await f.close();
    }
  }
  return sw;
}

async function runOne(browser, engine, name, cond, idx) {
  const vet = NEEDS_VET.has(name);
  const state = vet ? JSON.parse(readFileSync(VET, "utf8")) : undefined;
  const o = { shots: engine === "webkit" && cond === "cold" && idx === 0, inv: engine === "webkit" && cond === "cold" && idx === 0 };
  const load0 = os.loadavg()[0];
  const errs = [];
  const watch = (c) => c.on("page", (pg) => { pg.on("pageerror", (e) => errs.push(`pageerror: ${e.message}`)); pg.on("console", (m) => m.type() === "error" && errs.push(`console.error: ${m.text().slice(0, 200)}`)); });
  const ctx = await newProfileCtx(browser, engine, state);
  watch(ctx);
  await instrument(ctx);
  let swState = null;
  try {
    if (SECOND.has(name)) {
      // фаза 1 (подготовка) — в отдельной странице; фаза 2 — «закрыли и открыли»: cold = новый контекст (кэш пуст), warm = новая страница в том же контексте
      const p1 = await ctx.newPage();
      const run1 = new Run(p1, name);
      const prepared = await SC[name](p1, run1, o);
      await p1.close();
      let ctx2 = ctx, page2;
      if (cond === "cold") {
        // профиль-снимок: localStorage через storageState, IndexedDB — ручной посев с ожиданием tx.oncomplete
        ctx2 = await newProfileCtx(browser, engine, prepared.state);
        watch(ctx2);
        await instrument(ctx2);
      }
      page2 = await ctx2.newPage();
      const run2 = new Run(page2, name);
      const m = await prepared.measure(page2, run2, o);
      if (ctx2 !== ctx) await ctx2.close();
      return { loadavg: load0, times: m.times, info: { ...m.info, tabSwitch: prepared.tabSwitch }, run: run2.summary(), errs };
    }
    if (cond === "warm") swState = await prime(ctx, { wipe: name === "c_newbie" });
    const page = await ctx.newPage();
    const run = new Run(page, name);
    page.on("pageerror", (e) => console.log("  pageerror:", e.message));
    const m = await SC[name](page, run, o);
    return { loadavg: load0, sw: swState, times: m.times, info: m.info, run: run.summary(), errs };
  } finally {
    await ctx.close();
  }
}

async function main() {
  if (!existsSync(VET)) {
    console.log("seeding veteran profile…");
    await seedVeteran("webkit", VET);
  }
  const results = existsSync(OUT) && process.env.MERGE ? JSON.parse(readFileSync(OUT, "utf8")) : {};
  results[`meta@${process.env.VIEW ?? "393x852"}`] = {
    date: new Date().toISOString(),
    build: "main 96bbd4a (пакеты A–E, C, PD-139, PD-142, PD-144 смержены)",
    viewport: `${process.env.VIEW ?? "393x852"} pt, touch (iPhone emulation), WebKit`,
    thumbZone: `нижняя треть окна: y >= ${Math.round(THUMB_Y)} pt из ${H}; mid ${Math.round(H / 3)}..${Math.round(THUMB_Y)}; top < ${Math.round(H / 3)}`,
    cpu: `${os.cpus()[0].model} x${os.cpus().length}, без троттлинга; macOS ${os.release()}`,
    loadavgAtStart: os.loadavg(),
    note: "Сервер и стенд на localhost (сеть ~0 мс), CPU машины не iPhone и сильно нагружен чужими процессами (см. loadavg в каждом прогоне): секунды — относительные, для сравнения путей, не абсолют для телефона. Тапы и y-координаты от нагрузки не зависят.",
    cold: "новый browser context (пустой HTTP/SW-кэш), профиль: localStorage из storageState + IndexedDB ручным посевом с ожиданием tx.oncomplete (ветеран) или чистый (новичок)",
    warm: "тот же context после прогрева (SW активирован, ассеты в кэше), профиль тот же; для новичка IDB/localStorage стёрты после прогрева",
  };
  for (const engine of ENGINES) {
    const browser = await launch(engine);
    const KEY = (process.env.VIEW ?? "393x852") === "393x852" ? engine : `${engine}@${process.env.VIEW}`;
    results[KEY] ??= {};
    const names = Object.keys(SC).filter((n) => !ONLY || ONLY.includes(n)).filter((n) => engine === "webkit" || ["a_vet_daily", "b_vet_play_hard", "c_newbie", "f_year_sheet"].includes(n));
    for (const name of names) {
      const entry = { cold: [], warm: [] };
      const once = name.startsWith("h_");
      for (const [cond, n] of [["cold", once ? 1 : engine === "webkit" ? COLD : Math.min(COLD, 2)], ["warm", once ? 0 : engine === "webkit" ? WARM : Math.min(WARM, 2)]]) {
        for (let i = 0; i < n; i++) {
          try {
            const r = await runOne(browser, engine, name, cond, i);
            entry[cond].push(r);
            console.log(`[${engine}] ${name} ${cond}#${i} taps=${r.run.taps} ${JSON.stringify(r.times)} load=${r.loadavg.toFixed(0)}`);
          } catch (e) {
            console.log(`[${engine}] ${name} ${cond}#${i} FAIL ${e.message.split("\n")[0]}`);
            entry[cond].push({ error: e.message.split("\n")[0] });
          }
        }
      }
      const ok = (c) => entry[c].filter((r) => r.times);
      const agg = {};
      for (const c of ["cold", "warm"]) {
        const keys = new Set(ok(c).flatMap((r) => Object.keys(r.times)));
        agg[c] = Object.fromEntries([...keys].map((k) => [k, stat(ok(c).map((r) => r.times[k]).filter((v) => typeof v === "number"))]));
      }
      const ref = ok("cold")[0] ?? ok("warm")[0];
      results[KEY][name] = {
        taps: ref?.run.taps ?? null,
        tapsConsistent: new Set([...ok("cold"), ...ok("warm")].map((r) => r.run.taps)).size <= 1,
        extraGestures: ref?.run.extraGestures ?? [],
        zones: ref?.run.zones ?? null,
        targets: ref?.run.targets ?? null,
        tapList: ref?.run.tapList ?? null,
        steps: ref?.run.steps ?? null,
        times_ms: agg,
        info: ref?.info ?? null,
        loadavgRange: [Math.min(...[...entry.cold, ...entry.warm].filter((r) => r.loadavg).map((r) => r.loadavg)), Math.max(...[...entry.cold, ...entry.warm].filter((r) => r.loadavg).map((r) => r.loadavg))].map((v) => Math.round(v)),
        errors: [...entry.cold, ...entry.warm].filter((r) => r.error).map((r) => r.error),
        pageErrors: [...new Set([...entry.cold, ...entry.warm].flatMap((r) => r.errs ?? []))],
        raw: { cold: entry.cold.map((r) => r.times ?? null), warm: entry.warm.map((r) => r.times ?? null) },
      };
      writeFileSync(OUT, JSON.stringify(results, null, 2));
    }
    await browser.close();
  }
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log("written", OUT);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
