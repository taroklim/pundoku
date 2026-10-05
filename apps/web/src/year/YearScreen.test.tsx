// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { enterDigit } from "../play/logic";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";
import { YearScreen } from "./YearScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-29";
const FIRST_USE = "2026-09-01";

// Синтетические записи: все формы, которые умеет рисовать полотно (assisted в релизе 1 всегда false — проверяем на синтетике).
const DAYS: DayProgress[] = [
  progressOf("2026-09-10"), // решён чисто
  progressOf("2026-09-11", { withFix: true }), // решён с исправлением
  { ...progressOf("2026-09-12"), assisted: true }, // с подсказкой
  { ...progressOf("2026-09-16", { withFix: true }), assisted: true }, // с подсказкой и исправлением
  progressOf("2026-09-13", { solved: false, moves: 12 }), // начат и брошен
  progressOf("2026-09-14", { late: true }), // решён позже своей даты (PD-125: своё состояние, не пропуск)
  progressOf("2026-09-17", { late: true, withFix: true }), // решён позже, с исправлением: усилие не стирается
];

let host: HTMLDivElement;
let root: Root;
let openToday: Mock<() => void>;
let playDay: Mock<(date: string) => void>;

beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
  openToday = vi.fn<() => void>();
  playDay = vi.fn<(date: string) => void>();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const render = (days: DayProgress[] | null = DAYS, today = TODAY, firstUse: string | null = FIRST_USE) =>
  act(() => root.render(<YearScreen days={days} firstUse={firstUse} today={today} onOpenToday={openToday} onPlayDay={playDay} />));

const mark = (date: string) => host.querySelector(`.year-month .ymark[data-date="${date}"]`) as HTMLElement;
const month = (i: number) => host.querySelector(`.year-month[data-month="${i}"]`) as HTMLButtonElement;
const sheet = () => document.querySelector('[data-testid="year-sheet"]') as HTMLElement | null;
const click = (el: Element | null) => act(() => (el as HTMLElement).click());
const openDay = (m: number, date: string) => {
  click(month(m));
  click(document.querySelector(`.ycell[data-date="${date}"]`));
};

describe("полотно года: формы и цвет меток", () => {
  beforeEach(() => render());

  it("12 месяцев по 3 в ряд, каждый — кнопка; клетки дней не кнопки и скрыты от VoiceOver", () => {
    expect(host.querySelectorAll("button.year-month")).toHaveLength(12);
    expect(host.querySelectorAll(".year-month .ymark[data-date]")).toHaveLength(365);
    expect(host.querySelectorAll(".year-month .mgrid button, .year-month [role=button]")).toHaveLength(0);
    for (const g of host.querySelectorAll(".mgrid")) expect(g.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelectorAll(".year-month .mgrid > .ymark")).toHaveLength(12 * 35);
  });

  it("решён чисто — is-solved без has-corr/has-help", () => {
    expect(mark("2026-09-10").className).toBe("ymark is-solved");
  });

  it("исправления — has-corr (сургуч + скол), помощь — has-help (мягкий тон), оба вместе", () => {
    expect(mark("2026-09-11").className).toBe("ymark is-solved has-corr");
    expect(mark("2026-09-12").className).toBe("ymark is-solved has-help");
    expect(mark("2026-09-16").className).toBe("ymark is-solved has-corr has-help");
  });

  it("начат и брошен — is-unfinished (нижняя половина)", () => {
    expect(mark("2026-09-13").className).toBe("ymark is-unfinished");
  });

  it("PD-125: доигранный позже — рамка с ядром is-late, НЕ контур пропуска; исправления сохраняются (has-corr)", () => {
    expect(mark("2026-09-14").className).toBe("ymark is-late");
    expect(mark("2026-09-17").className).toBe("ymark is-late has-corr");
    expect(host.querySelectorAll(".year-month .ymark.is-late")).toHaveLength(2);
  });

  it("пропуск после самой ранней записи (09-10) — контур; до неё (даже после firstUse 09-01) и будущее — пусто", () => {
    expect(mark("2026-09-15").className).toBe("ymark is-missed");
    expect(mark("2026-09-28").className).toBe("ymark is-missed");
    expect(mark("2026-09-02").className).toBe("ymark is-void");
    expect(mark("2026-09-09").className).toBe("ymark is-void");
    expect(mark("2026-08-31").className).toBe("ymark is-void");
    expect(mark("2026-03-15").className).toBe("ymark is-void");
    expect(mark("2026-10-01").className).toBe("ymark is-void");
  });

  it("сегодня без записи — кольцо на пустой клетке, не контур пропуска", () => {
    expect(mark(TODAY).className).toBe("ymark is-void is-today");
    expect(host.querySelectorAll(".is-today")).toHaveLength(1);
  });

  it("месяц назван словами: имя, решено из скольких, с исправлениями, брошенные", () => {
    expect(month(8).getAttribute("aria-label")).toBe("September, 4 of 30 days solved, 2 with fixes, 2 with help, 2 solved late, 1 unfinished");
    expect(month(2).getAttribute("aria-label")).toBe("March, nothing yet");
  });

  it("итоги — нейтральный текст, без серий и процентов", () => {
    const totals = host.querySelector('[data-testid="year-totals"]')!.textContent!;
    expect(totals).toBe("4 days · 1 clean · 2 with fixes · 2 with help · 2 solved late");
    expect(totals).not.toMatch(/%|streak/i);
  });

  it("легенда всегда на экране: решено / с помощью / исправления / решено позже / брошено / пропуск", () => {
    const items = [...host.querySelectorAll(".year-legend li")].map((li) => li.textContent);
    expect(items).toEqual(["Solved", "With help", "Fixes", "Solved late", "Unfinished", "Missed"]);
    // знак «решено позже» в легенде — тот же класс, что в клетке дня
    expect(host.querySelector(".year-legend .ymark.is-late")).not.toBeNull();
  });

  it("один год — без выбора года; заголовок — h1 с годом", () => {
    expect(host.querySelector("h1")!.textContent).toContain("2026");
    expect(host.querySelector(".year-picker")).toBeNull();
  });
});

describe("пустой год", () => {
  it("нет записей: приглашение и кнопка «Open today's puzzle», ни одного пропуска, легенды нет", () => {
    render([], TODAY, TODAY);
    expect(host.querySelector('[data-testid="year-empty"]')).not.toBeNull();
    expect(host.querySelector(".year-legend")).toBeNull();
    expect(host.querySelectorAll(".ymark.is-missed")).toHaveLength(0);
    click(host.querySelector(".year-empty .cta"));
    expect(openToday).toHaveBeenCalledTimes(1);
  });

  it("знак P4 над строкой (PD-102, PD-155): 56 px, клеточная оптика (9 клеток), декоративный, перед текстом; в непустом году знака нет", () => {
    render([], TODAY, TODAY);
    const empty = host.querySelector('[data-testid="year-empty"]')!;
    const mark = empty.querySelector<SVGSVGElement>("svg.year-empty-mark")!;
    expect(mark.getAttribute("width")).toBe("56");
    expect(mark.dataset.optics).toBe("small");
    expect(mark.querySelectorAll("rect")).toHaveLength(9);
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(empty.firstElementChild).toBe(mark);
    expect(mark.nextElementSibling!.tagName).toBe("P");
    render();
    expect(host.querySelector(".year-empty-mark")).toBeNull();
  });

  it("firstUse в прошлом и ни одной записи: приглашение есть, пропусков нет (одно правило), кольцо сегодня остаётся", () => {
    render([], "2026-09-29", "2026-09-20");
    expect(host.querySelector('[data-testid="year-empty"]')!.textContent).toContain("Your year starts today");
    expect(host.querySelectorAll(".ymark.is-missed")).toHaveLength(0);
    expect(mark("2026-09-25").className).toBe("ymark is-void");
    expect(mark("2026-09-29").className).toBe("ymark is-void is-today");
    // тот же признак в шите: «до начала» / «сегодня», не «not played»
    click(month(8));
    const label = (d: string) => document.querySelector<HTMLElement>(`.ycell[data-date="${d}"]`)!.getAttribute("aria-label")!;
    expect(label("2026-09-25")).not.toContain("not played");
    expect(label("2026-09-29")).toContain("today");
  });

  it("firstUse в прошлом, записей нет: дни с firstUse — «nothing recorded», раньше firstUse — «before your first entry»", () => {
    render([], "2026-09-29", "2026-09-20");
    click(month(8));
    const label = (d: string) => document.querySelector<HTMLElement>(`.ycell[data-date="${d}"]`)!.getAttribute("aria-label")!;
    expect(label("2026-09-25")).toMatch(/, nothing recorded$/);
    expect(label("2026-09-20")).toMatch(/, nothing recorded$/); // сам день первого запуска: до начала он не был
    expect(label("2026-09-19")).toMatch(/, before your first entry$/);
    expect(label("2026-09-30")).toMatch(/, not yet$/);
    // карточка: то же различие словами
    click(document.querySelector('.ycell[data-date="2026-09-25"]'));
    expect(document.querySelector('[data-testid="day-card"] .emptyday')!.textContent).toBe("Nothing recorded for this day.");
    click(document.querySelector(".ysheet-head .back"));
    click(document.querySelector('.ycell[data-date="2026-09-19"]'));
    expect(document.querySelector('[data-testid="day-card"] .emptyday')!.textContent).toBe("Before your first entry.");
  });

  it("PD-51: как только появилась запись, пропуски начинаются с неё, а не с firstUse", () => {
    render([progressOf("2026-09-27")], "2026-09-29", "2026-09-20");
    expect(host.querySelector('[data-testid="year-empty"]')).toBeNull();
    expect(mark("2026-09-25").className).toBe("ymark is-void"); // между firstUse и записью — пусто
    expect(mark("2026-09-26").className).toBe("ymark is-void");
    expect(mark("2026-09-27").className).toBe("ymark is-solved");
    expect(mark("2026-09-28").className).toBe("ymark is-missed");
    expect(mark("2026-09-29").className).toBe("ymark is-void is-today");
  });

  it("PD-51: первая запись задним числом (архивная, late) сдвигает старт года на её дату", () => {
    // firstUse 09-20, первая партия — архивный день 09-22 (late): пропуски 09-23..09-28, раньше — пусто
    render([progressOf("2026-09-22", { late: true })], "2026-09-29", "2026-09-20");
    expect(mark("2026-09-21").className).toBe("ymark is-void");
    expect(mark("2026-09-22").className).toBe("ymark is-late"); // late = своё состояние (PD-125), год стартует с него
    expect(mark("2026-09-23").className).toBe("ymark is-missed");
    expect(mark("2026-09-28").className).toBe("ymark is-missed");
  });

  it("PD-51: запись позже старта (firstUse раньше неё) — дни до записи void, но играбельны и подписаны «before your first entry»", () => {
    render([progressOf("2026-09-27")], "2026-09-29", "2026-09-20");
    click(month(8));
    const label = (d: string) => document.querySelector<HTMLElement>(`.ycell[data-date="${d}"]`)!.getAttribute("aria-label")!;
    expect(label("2026-09-25")).toMatch(/, before your first entry$/);
    expect(label("2026-09-19")).toMatch(/, before your first entry$/);
    expect(label("2026-09-28")).toMatch(/, not played$/);
    // граница архива не сдвинулась: 09-25 (>= firstUse) можно сыграть, 09-19 — нет
    click(document.querySelector('.ycell[data-date="2026-09-25"]'));
    expect(document.querySelector('[data-testid="day-card"] .emptyday')!.textContent).toBe("Before your first entry.");
    expect(document.querySelector('[data-testid="play-day"]')).not.toBeNull();
    click(document.querySelector(".ysheet-head .back"));
    click(document.querySelector('.ycell[data-date="2026-09-19"]'));
    expect(document.querySelector('[data-testid="play-day"]')).toBeNull();
  });

  it("PD-54: ход на «пустом» дне (unfinished) до первой решённой партии год не стартует и пропусков не плодит", () => {
    // firstUse 09-01, единственная запись — брошенный день 09-10: старт года не сдвинут, пропусков нет, день рисуется как есть
    render([progressOf("2026-09-10", { solved: false, moves: 5 })], "2026-09-29", "2026-09-01");
    expect(mark("2026-09-10").className).toBe("ymark is-unfinished");
    expect(mark("2026-09-11").className).toBe("ymark is-void");
    expect(mark("2026-09-28").className).toBe("ymark is-void");
    expect(host.querySelector(".year-month .ymark.is-missed")).toBeNull();
    // граница архива не двигается: с 09-01 по-прежнему можно играть
    click(month(8));
    click(document.querySelector('.ycell[data-date="2026-09-05"]'));
    expect(document.querySelector('[data-testid="play-day"]')).not.toBeNull();
  });

  it("PD-54: решённый день позже брошенного стартует год; брошенный до него остаётся unfinished, пропуски — от решённого", () => {
    render([progressOf("2026-09-10", { solved: false, moves: 5 }), progressOf("2026-09-25")], "2026-09-29", "2026-09-01");
    expect(mark("2026-09-10").className).toBe("ymark is-unfinished");
    expect(mark("2026-09-20").className).toBe("ymark is-void");
    expect(mark("2026-09-25").className).toBe("ymark is-solved");
    expect(mark("2026-09-26").className).toBe("ymark is-missed");
  });

  it("PD-51: запись раньше firstUse (восстановленная) — старт года на ней, архив тоже с неё", () => {
    render([progressOf("2026-09-03")], "2026-09-29", "2026-09-20");
    expect(mark("2026-09-02").className).toBe("ymark is-void");
    expect(mark("2026-09-04").className).toBe("ymark is-missed");
  });

  it("итоги в пустом состоянии скрыты от VoiceOver (aria-hidden), с записями — читаются", () => {
    render([], TODAY, TODAY);
    expect(host.querySelector('[data-testid="year-totals"]')!.getAttribute("aria-hidden")).toBe("true");
    render();
    expect(host.querySelector('[data-testid="year-totals"]')!.hasAttribute("aria-hidden")).toBe(false);
  });

  it("пока данные грузятся (null) — пустого состояния нет", () => {
    render(null);
    expect(host.querySelector('[data-testid="year-empty"]')).toBeNull();
  });

  it("дни без ходов не считаются записью", () => {
    render([progressOf("2026-09-20", { solved: false, moves: 0 })], TODAY, TODAY);
    expect(host.querySelector('[data-testid="year-empty"]')).not.toBeNull();
  });
});

describe("выбор года", () => {
  it("два года — заголовок-кнопка с меню, переключение перерисовывает полотно", () => {
    render([progressOf("2025-12-30"), progressOf("2026-01-02")], "2026-01-03", "2025-12-30");
    const btn = host.querySelector<HTMLButtonElement>(".titlebtn")!;
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    click(btn);
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.map((i) => i.textContent)).toEqual(["2026", "2025"]);
    click(items[1]!);
    expect(host.querySelector(".titlebtn .title")!.textContent).toBe("2025");
    expect(mark("2025-12-30").className).toBe("ymark is-solved");
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });
});

describe("выбор года: записи из будущих лет", () => {
  it("запись из будущего года расширяет список лет и открывает этот год; по умолчанию — текущий", () => {
    render([progressOf("2027-03-05")], TODAY, TODAY);
    expect(host.querySelector(".titlebtn .title")!.textContent).toBe("2026");
    click(host.querySelector(".titlebtn"));
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items.map((i) => i.textContent)).toEqual(["2027", "2026"]);
    click(items[0]!);
    expect(host.querySelector(".titlebtn .title")!.textContent).toBe("2027");
    expect(mark("2027-03-05").className).toBe("ymark is-solved");
    expect(month(2).getAttribute("aria-label")).toContain("1 of 31 days solved");
  });
});

describe("шит месяца и карточка дня", () => {
  beforeEach(() => render());

  it("тап по месяцу открывает шит с днями месяца (кнопки ≥ 44 pt по CSS), фон недоступен", () => {
    click(month(8));
    const s = sheet()!;
    expect(s).not.toBeNull();
    expect(s.getAttribute("role")).toBe("dialog");
    expect(s.getAttribute("aria-modal")).toBe("true");
    expect(s.dataset["page"]).toBe("month");
    expect(s.querySelector("h2")!.textContent).toBe("September 2026");
    expect(s.querySelectorAll(".ycell[data-date]")).toHaveLength(30);
    expect(host.hasAttribute("inert")).toBe(true);
  });

  it("клетка дня в шите: подпись словами, форма — та же метка, что в полотне", () => {
    click(month(8));
    const cell = (d: string) => document.querySelector<HTMLElement>(`.ycell[data-date="${d}"]`)!;
    expect(cell("2026-09-11").getAttribute("aria-label")).toBe("Fri 11 September, solved with fixes");
    expect(cell("2026-09-12").getAttribute("aria-label")).toContain("solved with help");
    expect(cell("2026-09-13").getAttribute("aria-label")).toContain("started, not finished");
    expect(cell("2026-09-14").getAttribute("aria-label")).toContain("solved late");
    expect(cell("2026-09-17").getAttribute("aria-label")).toBe("Thu 17 September, solved late, with fixes");
    expect(cell("2026-09-14").getAttribute("aria-label")).not.toContain("missed");
    expect(cell("2026-09-15").getAttribute("aria-label")).toContain("not played");
    expect(cell("2026-09-05").getAttribute("aria-label")).toContain("before your first entry");
    expect(cell(TODAY).getAttribute("aria-label")).toContain("today, not played yet");
    expect(cell("2026-09-30").getAttribute("aria-label")).toContain("not yet");
    expect(cell("2026-09-11").querySelector(".ymark")!.className).toBe("ymark is-solved has-corr");
    expect(cell(TODAY).classList.contains("today")).toBe(true);
    expect(document.querySelector(".sheet-foot")!.textContent).toBe("4 of 30 days solved, 2 with fixes, 2 with help, 2 solved late, 1 unfinished");
  });

  it("тап по дню — вторая страница ТОГО ЖЕ шита: карточка результата с тепловой картой, временем, «чисто»", () => {
    openDay(8, "2026-09-10");
    expect(document.querySelectorAll('[data-testid="year-sheet"]')).toHaveLength(1);
    expect(sheet()!.dataset["page"]).toBe("day");
    const card = document.querySelector('[data-testid="day-card"]')!;
    expect(card.querySelector("h3")!.textContent).toBe("Thu 10 September");
    expect(card.querySelector(".sub")!.textContent).toContain("daily puzzle");
    expect(card.querySelectorAll(".heat i")).toHaveLength(81);
    const rows = [...card.querySelectorAll(".row")].map((r) => r.textContent);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toBe("Fixesclean");
    expect(card.querySelector('[data-testid="late-note"]')).toBeNull();
    expect(card.querySelector('[data-testid="assisted-row"]')).toBeNull();
  });

  it("карточка дня с исправлением показывает число правок, а не «clean»", () => {
    openDay(8, "2026-09-11");
    const err = document.querySelector('[data-testid="day-card"] .row dd.err')!;
    expect(err.textContent).toMatch(/^\d+$/);
    expect(Number(err.textContent)).toBeGreaterThan(0);
  });

  it("assisted: в карточке строка «Solved — with help»", () => {
    openDay(8, "2026-09-12");
    expect(document.querySelector('[data-testid="assisted-row"]')!.textContent).toBe("Solvedwith help");
  });

  it("PD-125: доигранный позже день: карточка с результатом, помечена «solved late», слова «missed» нет", () => {
    openDay(8, "2026-09-14");
    const card = document.querySelector<HTMLElement>('[data-testid="day-card"]')!;
    expect(card.dataset["kind"]).toBe("late");
    expect(card.dataset["late"]).toBe("true");
    expect(card.querySelectorAll(".heat i")).toHaveLength(81);
    const note = card.querySelector('[data-testid="late-note"]')!;
    expect(note.textContent).toBe("Solved after its day — your year keeps it as “solved late”.");
    expect(note.textContent).not.toMatch(/missed/i);
    expect(note.querySelector(".ymark.is-late")).not.toBeNull();
    expect(card.querySelector('[data-testid="late-warning"]')).toBeNull(); // день решён — предупреждать поздно и не о чем
  });

  it("PD-125: решённый позже с исправлением — карточка показывает число правок (усилие не стёрто)", () => {
    openDay(8, "2026-09-17");
    const err = document.querySelector('[data-testid="day-card"] .row dd.err')!;
    expect(Number(err.textContent)).toBeGreaterThan(0);
  });

  it("брошенный день: сколько клеток стоит, без тепловой карты", () => {
    openDay(8, "2026-09-13");
    const card = document.querySelector('[data-testid="day-card"]')!;
    expect(card.querySelector(".heat")).toBeNull();
    // считаются только клетки, которые ставит игрок: заданные не входят ни в N, ни в M
    const toFill = DAYS[4]!.play.mission.filter((g) => g === 0).length;
    expect(toFill).toBeLessThan(81);
    expect(card.querySelector('[data-testid="unfinished-note"]')!.textContent).toBe(
      `You started this one and left it with 12 of ${toFill} cells filled in correctly.`,
    );
  });

  it("брошенный день с неверной цифрой: она не входит в N («correctly»), M не меняется", () => {
    const base = progressOf("2026-09-13", { solved: false, moves: 12 });
    const cell = base.play.mission.findIndex((g, i) => g === 0 && base.play.values[i] === 0);
    const wrong = (base.play.solution[cell]! % 9) + 1;
    const withWrong = { ...base, play: enterDigit(base.play, cell, wrong, 999_000) };
    expect(withWrong.play.values.filter((v, i) => v !== 0 && base.play.mission[i] === 0)).toHaveLength(13); // поставлено 13, верных 12
    render([...DAYS.filter((d) => d.date !== "2026-09-13"), withWrong]);
    openDay(8, "2026-09-13");
    const toFill = base.play.mission.filter((g) => g === 0).length;
    expect(document.querySelector('[data-testid="unfinished-note"]')!.textContent).toBe(
      `You started this one and left it with 12 of ${toFill} cells filled in correctly.`,
    );
  });

  it("пропущенный день: карточка есть, «Not played.»; будущее и «до начала» — своими словами", () => {
    openDay(8, "2026-09-15");
    expect(document.querySelector('[data-testid="day-card"] .emptyday')!.textContent).toBe("Not played.");
    click(document.querySelector(".ysheet-head .back"));
    click(document.querySelector('.ycell[data-date="2026-09-30"]'));
    expect(document.querySelector('[data-testid="day-card"] .emptyday')!.textContent).toContain("hasn’t happened");
  });

  it("сегодня без записи: «ждёт» и кнопка «Open today's puzzle» закрывает шит и ведёт на Today", () => {
    openDay(8, TODAY);
    expect(document.querySelector('[data-testid="day-card"] .emptyday')!.textContent).toContain("waiting");
    click(document.querySelector(".daycard .ghost"));
    expect(openToday).toHaveBeenCalledTimes(1);
    expect(sheet()).toBeNull();
    expect(host.hasAttribute("inert")).toBe(false);
  });

  describe("архив (PD-33): кнопки карточки прошлого дня по состояниям", () => {
    const btn = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);

    it("нет записи, пропущенный день: «Play this day's puzzle» закрывает шит и передаёт дату", () => {
      openDay(8, "2026-09-05");
      expect(btn("play-day")!.textContent).toBe("Play this day’s puzzle");
      expect(btn("finish-day")).toBeNull();
      click(btn("play-day"));
      expect(playDay).toHaveBeenCalledExactlyOnceWith("2026-09-05");
      expect(sheet()).toBeNull();
      expect(host.hasAttribute("inert")).toBe(false);
    });

    it("начат и брошен: «Finish this puzzle» вместо «Play», передаёт дату", () => {
      openDay(8, "2026-09-13");
      expect(btn("finish-day")!.textContent).toBe("Finish this puzzle");
      expect(btn("play-day")).toBeNull();
      click(btn("finish-day"));
      expect(playDay).toHaveBeenCalledExactlyOnceWith("2026-09-13");
    });

    it("решён (чисто, с правками, late): карточка результата без кнопок", () => {
      for (const date of ["2026-09-10", "2026-09-11", "2026-09-14", "2026-09-17"]) {
        openDay(8, date);
        expect(btn("play-day"), date).toBeNull();
        expect(btn("finish-day"), date).toBeNull();
        expect(document.querySelector(".daycard .ghost"), date).toBeNull();
        act(() => void root.render(null));
        render();
      }
      expect(playDay).not.toHaveBeenCalled();
    }, 20_000); // 4 карточки подряд: ~3,5 с при load ~10, >5 с под нагрузкой (QA PD-181 Low-2)

    // PD-125: предупреждение ДО старта — строка перед кнопкой «Play/Finish», а не после победы
    // PD-125: предупреждение ДО старта — строка перед кнопкой «Play/Finish», а не после победы
    it.each([
      ["2026-09-05", "play-day"],
      ["2026-09-15", "play-day"],
      ["2026-09-13", "finish-day"],
    ] as const)("PD-125: %s — перед кнопкой %s стоит предупреждение про «solved late»", (date, id) => {
      openDay(8, date);
      const warn = document.querySelector('[data-testid="late-warning"]')!;
      expect(warn.textContent).toBe("If you solve it now, your year keeps it as “solved late”.");
      expect(warn.querySelector(".ymark.is-late")).not.toBeNull();
      // порядок в DOM: предупреждение раньше кнопки действия
      expect(warn.compareDocumentPosition(btn(id)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(warn.textContent).not.toMatch(/missed|streak/i);
    });

    it("PD-125: предупреждения нет там, где кнопки архива нет — сегодня, будущее, до границы архива, решённые дни", () => {
      const warn = () => document.querySelector('[data-testid="late-warning"]');
      openDay(8, TODAY);
      expect(warn()).toBeNull();
      click(document.querySelector(".ysheet-head .back"));
      click(document.querySelector('.ycell[data-date="2026-09-30"]'));
      expect(warn()).toBeNull();
      click(document.querySelector(".ysheet-head .back"));
      click(document.querySelector('.ycell[data-date="2026-09-10"]'));
      expect(warn()).toBeNull();
      act(() => void root.render(null));
      render(DAYS, TODAY, "2026-09-05");
      openDay(8, "2026-09-03");
      expect(warn()).toBeNull();
    });

    it("сегодня и будущее — без кнопок архива; до начала пользования — тоже", () => {
      openDay(8, TODAY);
      expect(btn("play-day")).toBeNull();
      expect(btn("finish-day")).toBeNull();
      click(document.querySelector(".ysheet-head .back"));
      click(document.querySelector('.ycell[data-date="2026-09-30"]'));
      expect(btn("play-day")).toBeNull();
      act(() => void root.render(null));
      render(DAYS, TODAY, "2026-09-05");
      openDay(8, "2026-09-03");
      expect(btn("play-day")).toBeNull();
      click(document.querySelector(".ysheet-head .back"));
      click(document.querySelector('.ycell[data-date="2026-09-06"]'));
      expect(btn("play-day")).not.toBeNull();
    });

    it("initialDate открывает шит сразу на карточке дня, один раз, и сообщает о применении", () => {
      const consumed = vi.fn();
      act(() =>
        root.render(
          <YearScreen days={DAYS} firstUse={FIRST_USE} today={TODAY} onOpenToday={openToday} onPlayDay={playDay} initialDate="2026-09-13" onInitialDateConsumed={consumed} />,
        ),
      );
      expect(sheet()!.dataset["page"]).toBe("day");
      expect(document.querySelector('[data-testid="day-card"] h3')!.textContent).toContain("13");
      expect(consumed).toHaveBeenCalledTimes(1);
    });
  });

  it("«Back» возвращает на страницу месяца, «Done» закрывает шит и возвращает фокус на месяц", () => {
    vi.useFakeTimers();
    openDay(8, "2026-09-10");
    click(document.querySelector(".ysheet-head .back"));
    expect(sheet()!.dataset["page"]).toBe("month");
    click(document.querySelector(".ysheet-head .done"));
    expect(document.querySelector(".ysheet-root")!.classList.contains("is-open")).toBe(false);
    act(() => void vi.advanceTimersByTime(400));
    expect(sheet()).toBeNull();
    expect(host.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(month(8));
  });

  it("Escape и тап по фону закрывают шит", () => {
    vi.useFakeTimers();
    click(month(8));
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    act(() => void vi.advanceTimersByTime(400));
    expect(sheet()).toBeNull();
    click(month(8));
    click(document.querySelector(".ysheet-scrim"));
    act(() => void vi.advanceTimersByTime(400));
    expect(sheet()).toBeNull();
  });
});

describe("PD-52 / PD-55: прошлый год без записей", () => {
  const pickYear = (y: string) => {
    click(host.querySelector(".titlebtn"));
    click([...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((i) => i.textContent === y)!);
  };
  const line = () => host.querySelector('[data-testid="year-empty-year"]') as HTMLElement | null;

  it("год границы архива достижим и без записей: играбельные дни доступны из карточки дня (PD-52)", () => {
    // firstUse 2025-11-20, единственная запись — сегодня в 2026: 2025 в списке, дни ноября-декабря играбельны.
    render([progressOf("2026-03-05")], "2026-03-06", "2025-11-20");
    click(host.querySelector(".titlebtn"));
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map((i) => i.textContent)).toEqual(["2026", "2025"]);
    click(host.querySelector('[role="menuitemradio"]:last-child'));
    openDay(10, "2025-11-25");
    click(document.querySelector('[data-testid="play-day"]'));
    expect(playDay).toHaveBeenCalledWith("2025-11-25");
  });

  it("одна пояснялка вместо «0 days · 0 clean», месяцы остаются (PD-55)", () => {
    render([progressOf("2026-03-05")], "2026-03-06", "2025-11-20");
    expect(line()).toBeNull(); // текущий год с записью: обычные итоги
    expect(host.querySelector('[data-testid="year-totals"]')).not.toBeNull();
    pickYear("2025");
    expect(line()?.textContent).toBe("Nothing recorded in 2025.");
    expect(host.querySelector('[data-testid="year-totals"]')).toBeNull();
    expect(line()?.getAttribute("aria-hidden")).toBeNull(); // читается VoiceOver, а не скрыта как итоги пустого состояния
    expect(host.querySelectorAll(".year-month")).toHaveLength(12);
    // Играбельные дни (от 2025-11-20) видны: месяц открывается, дни до границы не «пропуск».
    expect(month(10).getAttribute("aria-label")).toContain("nothing yet");
  });

  it("PD-60: ветка `year < текущий`: пояснялка только у прошлого года — текущий и будущий год без записей получают обычные итоги", () => {
    // Записи в 2025 и 2027 (будущее), сегодня 2026: у 2026 и у будущего «пустого» года нет записи, но они не «прошлый год».
    render([progressOf("2025-06-05"), progressOf("2027-02-03")], "2026-03-06", "2025-06-01");
    expect(line()).toBeNull(); // текущий 2026 — без записей, но не прошлый
    expect(host.querySelector('[data-testid="year-totals"]')).not.toBeNull();
    pickYear("2025");
    expect(line()).toBeNull(); // в 2025 запись есть
    act(() => root.unmount());
    root = createRoot(host);
    render([progressOf("2025-06-05"), progressOf("2028-02-03")], "2026-03-06", "2025-06-01");
    pickYear("2027"); // дыра между текущим годом и будущей записью: список без дыр, записей в 2027 нет
    expect(line()).toBeNull();
    expect(host.querySelector('[data-testid="year-totals"]')).not.toBeNull();
  });

  it("год с записью пояснялки не получает; wholly-empty состояние — прежнее приглашение", () => {
    render([progressOf("2025-12-30"), progressOf("2026-01-02")], "2026-01-03", "2025-12-30");
    pickYear("2025");
    expect(line()).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    render([], "2026-01-03", "2025-12-30");
    pickYear("2025");
    expect(line()).toBeNull();
    expect(host.querySelector('[data-testid="year-empty"]')).not.toBeNull();
  });

  for (const [lng, want] of [["uk", "У 2025 році записів немає."], ["ru", "В 2025 году записей нет."]] as const) {
    it(`${lng}: пояснялка переведена`, async () => {
      await i18n.changeLanguage(lng);
      render([progressOf("2026-03-05")], "2026-03-06", "2025-11-20");
      pickYear("2025");
      expect(line()?.textContent).toBe(want);
    });
  }
});

describe("локали", () => {
  for (const [lng, wantMonth] of [["uk", "Вересень"], ["ru", "Сентябрь"]] as const) {
    it(`${lng}: месяц и итоги переведены, сырых ключей нет`, async () => {
      await i18n.changeLanguage(lng);
      render();
      expect(month(8).getAttribute("aria-label")!.startsWith(wantMonth)).toBe(true);
      openDay(8, "2026-09-12");
      const text = document.body.textContent ?? "";
      expect(text).not.toMatch(/\byear\.[a-zA-Z]+/);
      expect(host.textContent).not.toMatch(/\byear\.[a-zA-Z]+/);
      expect(document.querySelector('[data-testid="assisted-row"]')).not.toBeNull();
    });
  }
});

describe("шапка Year: шестерёнка настроек (PD-123)", () => {
  it("с onOpenSettings в шапке есть шестерёнка и нажатие её вызывает; без пропа — нет", () => {
    const open = vi.fn<() => void>();
    act(() => root.render(<YearScreen days={DAYS} firstUse={FIRST_USE} today={TODAY} onOpenToday={openToday} onPlayDay={playDay} onOpenSettings={open} />));
    const gear = host.querySelector<HTMLButtonElement>('header [data-testid="open-settings"]');
    expect(gear?.getAttribute("aria-label")).toBe("Settings");
    click(gear);
    expect(open).toHaveBeenCalledTimes(1);
    render();
    expect(host.querySelector('[data-testid="open-settings"]')).toBeNull();
  });
});
