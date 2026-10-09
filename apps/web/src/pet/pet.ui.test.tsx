// @vitest-environment jsdom
/**
 * PD-180: где живёт клякса. Карточка результата и лист дня Year — да (только при включённом тумблере); страница месяца,
 * полотно Year и игровое поле — никогда. «Личный рекорд» на карточке Today — хук `usePersonalBest`.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { ResultCard } from "../play/ResultCard";
import type { LiarInfo } from "../play/savedPlay";
import { setPetEnabled } from "../settings/prefs";
import { TabActiveContext } from "../shell/tabSlide";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import { YearScreen } from "../year/YearScreen";
import { usePersonalBest, usePersonalBestState } from "./usePersonalBest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  setPetEnabled(false);
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setPetEnabled(false);
});

const pet = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"] .pet`);
const moodOf = (id: string) => pet(id)?.getAttribute("data-mood") ?? null;
const LIAR_FIRST: LiarInfo = { caught: true, firstTry: true, wrongAccusations: 0, catchT: 4000, catchPlacement: 12 };

describe("карточка результата", () => {
  const card = (play: DayProgress["play"], extra: Partial<Parameters<typeof ResultCard>[0]> = {}) =>
    act(() => root.render(<ResultCard play={play} cardRef={{ current: null }} title="Solved" {...extra} />));

  it("по умолчанию (тумблер выкл) кляксы нет и место под неё не резервируется", () => {
    card(progressOf("2026-09-10").play);
    expect(pet("pet-card")).toBeNull();
    expect(host.querySelector('[data-testid="result-card"]')!.classList.contains("has-pet")).toBe(false);
  });

  it("включена: чисто → доволен, правка → устал, подсказка → устал; клякса после заголовка в DOM", () => {
    setPetEnabled(true);
    card(progressOf("2026-09-10").play);
    expect(moodOf("pet-card")).toBe("happy");
    const section = host.querySelector('[data-testid="result-card"]')!;
    expect(section.classList.contains("has-pet")).toBe(true);
    expect(section.firstElementChild!.tagName).toBe("H2");
    expect(pet("pet-card")!.getAttribute("aria-label")).toBe("Blot, pleased");
    card(progressOf("2026-09-10", { withFix: true }).play);
    expect(moodOf("pet-card")).toBe("tired");
    card(progressOf("2026-09-10").play, { hints: 2 });
    expect(moodOf("pet-card")).toBe("tired");
  });

  it("особый день: Лжец с первого обвинения или личный рекорд → удивлён", () => {
    setPetEnabled(true);
    card(progressOf("2026-09-10", { withFix: true }).play, { liar: { info: LIAR_FIRST, average: null } });
    expect(moodOf("pet-card")).toBe("surprised");
    card(progressOf("2026-09-10").play, { personalBest: true });
    expect(moodOf("pet-card")).toBe("surprised");
  });

  it("PD-260: решили только что — клякса один раз «приземляется» после входа карточки; повторное открытие — только покой", () => {
    setPetEnabled(true);
    card(progressOf("2026-09-10", { withFix: true }).play, { solvedNow: true });
    expect(pet("pet-card")!.getAttribute("data-act")).toBe("arrive");
    expect(pet("pet-card")!.getAttribute("data-mood")).toBe("tired");
    expect(pet("pet-card")!.style.getPropertyValue("--act-delay")).toBe("300ms");
    act(() => root.unmount());
    root = createRoot(host);
    card(progressOf("2026-09-10", { withFix: true }).play);
    expect(pet("pet-card")!.hasAttribute("data-act")).toBe(false);
    expect(pet("pet-card")!.hasAttribute("data-idle")).toBe(true);
  });

  it("тумблер действует на открытой карточке сразу (подписка на настройку)", () => {
    card(progressOf("2026-09-10").play);
    expect(pet("pet-card")).toBeNull();
    act(() => setPetEnabled(true));
    expect(moodOf("pet-card")).toBe("happy");
    act(() => setPetEnabled(false));
    expect(pet("pet-card")).toBeNull();
  });
});

describe("Year: только лист дня", () => {
  const render = (days: DayProgress[], liar?: ReadonlyMap<string, LiarInfo>) =>
    act(() => root.render(<YearScreen days={days} firstUse="2026-09-01" today={TODAY} liar={liar} onOpenToday={vi.fn()} onPlayDay={vi.fn()} />));
  const click = (el: Element | null) => act(() => (el as HTMLElement).click());
  const openMonth = () => click(host.querySelector('.year-month[data-month="8"]'));
  const openDay = (date: string) => click(document.querySelector(`.ycell[data-date="${date}"]`));

  it("полотно и страница месяца — без клякс; лист дня — клякса рядом с датой (40 pt)", () => {
    setPetEnabled(true);
    render([progressOf("2026-09-10"), progressOf("2026-09-11", { withFix: true })]);
    expect(document.querySelector(".pet")).toBeNull();
    openMonth();
    expect(document.querySelector('[data-testid="month-page"]')).not.toBeNull();
    expect(document.querySelector(".pet")).toBeNull();
    openDay("2026-09-11");
    expect(moodOf("pet-year")).toBe("tired");
    expect(pet("pet-year")!.style.width).toBe("40px");
    expect(document.querySelectorAll(".pet")).toHaveLength(1);
    expect(document.querySelector(".dc-head h3")).not.toBeNull();
  });

  it("не играл → спит; не закончил → спит; будущий день — без кляксы", () => {
    setPetEnabled(true);
    render([progressOf("2026-09-10"), progressOf("2026-09-12", { solved: false, moves: 4 })]);
    openMonth();
    openDay("2026-09-11");
    expect(moodOf("pet-year")).toBe("asleep");
    click(document.querySelector(".ysheet .back"));
    openDay("2026-09-12");
    expect(moodOf("pet-year")).toBe("asleep");
    click(document.querySelector(".ysheet .back"));
    openDay("2026-09-30");
    expect(pet("pet-year")).toBeNull();
  });

  it("PD-260: день показывался «спит», потом закончен → при следующем показе «проснуться» один раз; дальше только покой", () => {
    setPetEnabled(true);
    render([progressOf("2026-09-12", { solved: false, moves: 4 })]);
    openMonth();
    openDay("2026-09-12");
    expect(moodOf("pet-year")).toBe("asleep");
    expect(pet("pet-year")!.hasAttribute("data-act")).toBe(false);
    click(document.querySelector(".ysheet .back"));
    // День закончили (архив) — Year получает решённую запись.
    render([progressOf("2026-09-12")]);
    openDay("2026-09-12");
    expect(moodOf("pet-year")).toBe("happy");
    expect(pet("pet-year")!.getAttribute("data-act")).toBe("wake");
    expect(pet("pet-year")!.querySelector(".pose.from")!.getAttribute("data-mood")).toBe("asleep");
    click(document.querySelector(".ysheet .back"));
    openDay("2026-09-12");
    expect(pet("pet-year")!.hasAttribute("data-act")).toBe(false);
    // Решённый день, который «спящим» не показывался, — без перехода.
    click(document.querySelector(".ysheet .back"));
    render([progressOf("2026-09-12"), progressOf("2026-09-10")]);
    openDay("2026-09-10");
    expect(pet("pet-year")!.hasAttribute("data-act")).toBe(false);
  }, 20000); // под нагрузкой полного прогона Year-сценарий с тремя рендерами дольше 5 с (прецедент PD-181, 14af416)

  it("PD-287: лист открыт на прежних данных («спит»), данные обновились под ним → «проснуться» на открытом листе; скрытая вкладка ждёт", () => {
    setPetEnabled(true);
    const screen = (days: DayProgress[], active = true) =>
      act(() =>
        root.render(
          <TabActiveContext.Provider value={active}>
            <YearScreen days={days} firstUse="2026-09-01" today={TODAY} onOpenToday={vi.fn()} onPlayDay={vi.fn()} />
          </TabActiveContext.Provider>,
        ),
      );
    // Возврат из архива: лист дня открыт по initialDate раньше, чем Year перечитал хранилище.
    screen([progressOf("2026-09-12", { solved: false, moves: 4 })]);
    openMonth();
    openDay("2026-09-12");
    expect(moodOf("pet-year")).toBe("asleep");
    screen([progressOf("2026-09-12")]);
    expect(moodOf("pet-year")).toBe("happy");
    expect(pet("pet-year")!.getAttribute("data-act")).toBe("wake");
    expect(pet("pet-year")!.querySelector(".pose.from")!.getAttribute("data-mood")).toBe("asleep");
    // Вкладку скрыли, на открытом листе другого дня данные обновились; вернулись — «проснуться» играет сейчас, не потеряно.
    click(document.querySelector(".ysheet .back"));
    screen([progressOf("2026-09-12"), progressOf("2026-09-13", { solved: false, moves: 4 })]);
    openDay("2026-09-13");
    expect(moodOf("pet-year")).toBe("asleep");
    screen([progressOf("2026-09-12"), progressOf("2026-09-13", { solved: false, moves: 4 })], false);
    screen([progressOf("2026-09-12"), progressOf("2026-09-13")], false);
    expect(pet("pet-year")!.hasAttribute("data-act")).toBe(false);
    screen([progressOf("2026-09-12"), progressOf("2026-09-13")], true);
    expect(pet("pet-year")!.getAttribute("data-act")).toBe("wake");
    // Ещё раз ушли и вернулись — покой, без повтора.
    screen([progressOf("2026-09-12"), progressOf("2026-09-13")], false);
    screen([progressOf("2026-09-12"), progressOf("2026-09-13")], true);
    expect(pet("pet-year")!.hasAttribute("data-act")).toBe(false);
  }, 20000);

  it("Лжец даты с первого обвинения → удивлён; выключенный тумблер — кляксы нет", () => {
    setPetEnabled(true);
    render([progressOf("2026-09-10")], new Map([["2026-09-10", LIAR_FIRST]]));
    openMonth();
    openDay("2026-09-10");
    expect(moodOf("pet-year")).toBe("surprised");
    act(() => setPetEnabled(false));
    expect(pet("pet-year")).toBeNull();
  });
});

describe("игровое поле — никогда", () => {
  const fs = { read: (p: string) => import(/* @vite-ignore */ `${p}?raw`).then((m: { default: string }) => m.default) };
  it.each(["../play/Board.tsx", "../play/controls.tsx", "../today/MiniBoard.tsx", "../play/ReplayField.tsx"])("%s не импортирует питомца", async (file) => {
    const src = await fs.read(file);
    expect(src).not.toMatch(/PetBlot|from "\.\.\/pet\//);
  });
});

describe("usePersonalBestState (PD-260)", () => {
  function Probe({ list, day }: { list: () => Promise<DayProgress[]>; day: DayProgress }) {
    const s = usePersonalBestState(true, list, { date: day.date, difficulty: day.difficulty, play: day.play, assisted: day.assisted });
    return <span data-testid="st">{`${s.best}/${s.ready}`}</span>;
  }
  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  it("ready — когда рекорд для даты посчитан; новая партия той же даты не сбрасывает; сбой чтения — готово без рекорда", async () => {
    const a = progressOf("2026-09-10");
    const b = { ...progressOf("2026-09-11"), play: { ...progressOf("2026-09-11").play, log: progressOf("2026-09-11").play.log.map((m) => ({ ...m, t: Math.round(m.t / 2) })) } };
    let release: (v: DayProgress[]) => void = () => undefined;
    const slow = () => new Promise<DayProgress[]>((r) => (release = r));
    act(() => root.render(<Probe list={slow} day={b} />));
    expect(host.textContent).toBe("false/false");
    await act(async () => release([a, b]));
    await flush();
    expect(host.textContent).toBe("true/true");
    act(() => root.render(<Probe list={slow} day={{ ...b, play: { ...b.play } }} />));
    expect(host.textContent).toBe("true/true");
    act(() => root.render(<Probe list={() => Promise.reject(new Error("idb"))} day={a} />));
    await flush();
    expect(host.textContent).toBe("false/true");
  });
  it("ResultCard: пока настроение уточняется — место под кляксу есть, кляксы нет", () => {
    setPetEnabled(true);
    act(() => root.render(<ResultCard play={progressOf("2026-09-10").play} cardRef={{ current: null }} title="Solved" solvedNow petPending />));
    expect(host.querySelector('[data-testid="result-card"]')!.classList.contains("has-pet")).toBe(true);
    expect(pet("pet-card")).toBeNull();
    act(() => root.render(<ResultCard play={progressOf("2026-09-10").play} cardRef={{ current: null }} title="Solved" solvedNow personalBest />));
    expect(pet("pet-card")!.getAttribute("data-mood")).toBe("surprised");
    expect(pet("pet-card")!.getAttribute("data-act")).toBe("arrive");
  });
});

describe("usePersonalBest", () => {
  function Probe({ enabled, list, day }: { enabled: boolean; list: () => Promise<DayProgress[]>; day: DayProgress | null }) {
    const best = usePersonalBest(enabled, list, day && { date: day.date, difficulty: day.difficulty, play: day.play, assisted: day.assisted });
    return <span data-testid="best">{String(best)}</span>;
  }
  const flush = () => act(async () => void (await new Promise((r) => setTimeout(r, 0))));
  const fast = (d: DayProgress): DayProgress => ({ ...d, play: { ...d.play, log: d.play.log.map((m) => ({ ...m, t: Math.round(m.t / 2) })) } });

  it("выкл — историю не читает; вкл — рекорд по истории (своя запись — из хранилища, иначе из экрана)", async () => {
    const a = progressOf("2026-09-10");
    const b = fast(progressOf("2026-09-11"));
    const list = vi.fn(async () => [a, b]);
    act(() => root.render(<Probe enabled={false} list={list} day={b} />));
    await flush();
    expect(list).not.toHaveBeenCalled();
    expect(host.textContent).toBe("false");
    act(() => root.render(<Probe enabled list={list} day={b} />));
    await flush();
    expect(host.textContent).toBe("true");
    // Записи самого дня в хранилище ещё нет — берётся снапшот экрана.
    const onlyOld = vi.fn(async () => [a]);
    act(() => root.render(<Probe enabled list={onlyOld} day={b} />));
    await flush();
    expect(host.textContent).toBe("true");
    act(() => root.render(<Probe enabled list={list} day={a} />));
    await flush();
    expect(host.textContent).toBe("false");
  });
});
