// @vitest-environment jsdom
/**
 * PD-262 (решение владельца 2026-10-08): игра дня в «Продолжить» не за сегодня (вчерашний незаконченный Лжец дня, PD-217) —
 * в заголовке строки дата дня головоломки: «Liar of the day · 7 Oct» / «Брехун дня · 7 жовт.» / «Лжец дня · 7 окт.».
 * Сегодняшняя — как раньше, без даты. Дата — день головоломки (не время последнего хода), «сегодня» — `localDate()` (та же
 * граница суток, что у Лжеца дня), переход через полночь на открытом хабе перерисовывает строку. То же для строки дня
 * Today (стор Today держит вчерашнюю партию после полуночи): «Daily puzzle · 7 Oct» вместо «Today’s puzzle».
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import type { SlotSummary } from "./daySlot";
import { formatShortDay } from "./format";
import { availableModes } from "./modes";
import { PlaySetup } from "./PlaySetup";
import type { PlaySetupProps } from "./PlaySetup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let daySlot: SlotSummary | null = null;
vi.mock("./daySlot", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), useDaySlot: () => daySlot }));

const TODAY = "2026-10-08";
const YESTERDAY = "2026-10-07";
const slot = (date?: string): SlotSummary => ({ difficulty: "medium", left: 40, elapsedMs: 65_000, ink: false, ...(date ? { date } : {}) });

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const title = (id: string) => q(id)!.querySelector(".l1 b")!.textContent!.replace(/\u00a0/g, " ");
const props = (over: Partial<PlaySetupProps> = {}): PlaySetupProps => ({
  modes: availableModes(),
  slots: {},
  reselect: 0,
  onOpenMode: vi.fn(),
  onNewInMode: vi.fn(),
  onOpenToday: vi.fn(),
  onOpenLiarDay: vi.fn(),
  ...over,
});
const render = (over: Partial<PlaySetupProps> = {}) => act(() => root.render(<PlaySetup {...props(over)} />));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 12));
  daySlot = null;
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  await i18n.changeLanguage("en");
});

describe("formatShortDay", () => {
  it("день и короткий месяц по локали, без дня недели и года: en/uk/ru (родительный падеж у ru)", () => {
    expect(formatShortDay(YESTERDAY, "en", TODAY)).toBe("7 Oct");
    expect(formatShortDay(YESTERDAY, "uk", TODAY)).toBe("7 жовт.");
    expect(formatShortDay(YESTERDAY, "ru", TODAY)).toBe("7 окт.");
    expect(formatShortDay("2026-05-07", "ru", TODAY)).toBe("7 мая");
  });

  it("другой год — с годом (без «г.»/«р.»), чтобы прошлогодний день не читался как этот", () => {
    expect(formatShortDay("2025-12-31", "en", "2026-01-01")).toBe("31 Dec 2025");
    expect(formatShortDay("2025-12-31", "uk", "2026-01-01")).toBe("31 груд. 2025");
    expect(formatShortDay("2025-12-31", "ru", "2026-01-01")).toBe("31 дек. 2025");
  });
});

describe("Лжец дня в «Продолжить»", () => {
  it("сегодняшний — без даты (как раньше)", () => {
    render({ liarDay: slot(TODAY) });
    expect(title("continue-liar-day")).toBe("Liar of the day");
    expect(q("continue-liar-day")!.textContent).toContain("Medium · 40 cells left · 1:05");
  });

  it("вчерашний — с датой дня головоломки: en/uk/ru", async () => {
    render({ liarDay: slot(YESTERDAY) });
    expect(title("continue-liar-day")).toBe("Liar of the day · 7 Oct");
    await act(() => i18n.changeLanguage("uk"));
    expect(title("continue-liar-day")).toBe("Брехун дня · 7 жовт.");
    await act(() => i18n.changeLanguage("ru"));
    expect(title("continue-liar-day")).toBe("Лжец дня · 7 окт.");
  });

  it("дата не разрывается переносом: внутри даты и перед «·» неразрывные пробелы; имя для VoiceOver содержит дату", () => {
    render({ liarDay: slot(YESTERDAY) });
    const raw = q("continue-liar-day")!.querySelector(".l1 b")!.textContent!;
    expect(raw).toBe("Liar of the day\u00a0· 7\u00a0Oct");
    // Доступное имя кнопки — её текст: заголовок с датой и подпись слота.
    expect(q("continue-liar-day")!.textContent!.replace(/\u00a0/g, " ")).toContain("Liar of the day · 7 Oct");
  });

  it("переход суток на открытом хабе: в 23:59 сегодняшний без даты, после полуночи — тот же день уже с датой", () => {
    vi.setSystemTime(new Date(2026, 9, 7, 23, 59, 30));
    render({ liarDay: slot(YESTERDAY) });
    expect(title("continue-liar-day")).toBe("Liar of the day");
    act(() => void vi.advanceTimersByTime(60_000));
    expect(title("continue-liar-day")).toBe("Liar of the day · 7 Oct");
  });

  it("возврат в приложение на следующий день (таймеры спали в фоне): дата появляется по visibilitychange", () => {
    vi.setSystemTime(new Date(2026, 9, 7, 22));
    render({ liarDay: slot(YESTERDAY) });
    expect(title("continue-liar-day")).toBe("Liar of the day");
    vi.setSystemTime(new Date(2026, 9, 8, 9)); // время ушло вперёд без срабатывания таймеров
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(title("continue-liar-day")).toBe("Liar of the day · 7 Oct");
  });

  it("без даты в сводке (старые данные) — как раньше, без даты", () => {
    render({ liarDay: slot() });
    expect(title("continue-liar-day")).toBe("Liar of the day");
  });
});

describe("головоломка дня Today в «Продолжить»", () => {
  it("сегодняшняя — «Today’s puzzle» без даты", () => {
    daySlot = slot(TODAY);
    render();
    expect(title("continue-day")).toBe("Today’s puzzle");
  });

  it("вчерашняя (стор Today держит её после полуночи) — «Daily puzzle · 7 Oct», uk/ru — «Головоломка дня · …»", async () => {
    daySlot = slot(YESTERDAY);
    render();
    expect(title("continue-day")).toBe("Daily puzzle · 7 Oct");
    await act(() => i18n.changeLanguage("uk"));
    expect(title("continue-day")).toBe("Головоломка дня · 7 жовт.");
    await act(() => i18n.changeLanguage("ru"));
    expect(title("continue-day")).toBe("Головоломка дня · 7 окт.");
  });
});

describe("PD-275: вчерашний день Today после перезапуска", () => {
  it("строка «Daily puzzle · 7 Oct»; тап отдаёт дату дня головоломки (экран откроет именно его)", () => {
    daySlot = slot(YESTERDAY);
    const onOpenToday = vi.fn();
    render({ onOpenToday });
    expect(title("continue-day")).toBe("Daily puzzle · 7 Oct");
    act(() => q("continue-day")!.click());
    expect(onOpenToday).toHaveBeenCalledWith(YESTERDAY);
  });
});
