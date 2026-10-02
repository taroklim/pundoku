// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { progressOf } from "../sync/fixtures";
import type { DayProgress } from "../today/repository";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Подмена боевой сборки синхронизации: YearTab берёт из неё только `repository` и `hooks.subscribeRemote`.
const h = vi.hoisted(() => ({
  days: [] as unknown[],
  meta: null as unknown,
  listDays: vi.fn(),
  getMeta: vi.fn(),
  listeners: new Set<() => void>(),
  fail: false,
}));
vi.mock("../sync/runtime", () => ({
  sync: {
    repository: { listDays: h.listDays, getMeta: h.getMeta },
    hooks: {
      subscribeRemote: (fn: () => void) => {
        h.listeners.add(fn);
        return () => h.listeners.delete(fn);
      },
    },
  },
}));

import { YearTab } from "./YearTab";

let host: HTMLDivElement;
let root: Root;
let visibility: DocumentVisibilityState;

const flush = () => act(async () => void (await Promise.resolve()));
const mount = async () => {
  await act(async () => root.render(<YearTab onOpenToday={() => {}} onPlayDay={() => {}} />));
  await flush();
};
const setVisibility = async (v: DocumentVisibilityState) => {
  visibility = v;
  await act(async () => void document.dispatchEvent(new Event("visibilitychange")));
  await flush();
};
const marks = (kind: string) => host.querySelectorAll(`.year-month .ymark.${kind}`).length;
const isEmpty = () => host.querySelector('[data-testid="year-screen"]')!.getAttribute("data-empty") === "true";

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 8, 29, 12, 0));
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  h.days = [];
  h.meta = "2026-09-20";
  h.fail = false;
  h.listeners.clear();
  h.listDays.mockReset().mockImplementation(async () => {
    if (h.fail) throw new Error("idb down");
    return h.days as DayProgress[];
  });
  h.getMeta.mockReset().mockImplementation(async () => h.meta);
  host = document.createElement("div");
  host.id = "root";
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("YearTab: загрузка и перечитывание данных", () => {
  it("при открытии читает дни и дату первого запуска из репозитория", async () => {
    h.days = [progressOf("2026-09-27")];
    await mount();
    expect(h.listDays).toHaveBeenCalledTimes(1);
    expect(h.getMeta).toHaveBeenCalledWith("firstUseDate");
    expect(isEmpty()).toBe(false);
    expect(marks("is-solved")).toBe(1);
    expect(marks("is-missed")).toBe(1); // PD-51: старт года — запись 27-го (firstUse = 20 сентября не в счёт) → пропуск только 28-го
  });

  it("возврат приложения на передний план (visibilitychange → visible) перечитывает данные", async () => {
    await mount();
    expect(isEmpty()).toBe(true);
    h.days = [progressOf("2026-09-28")];
    await setVisibility("visible");
    expect(h.listDays).toHaveBeenCalledTimes(2);
    expect(isEmpty()).toBe(false);
    expect(marks("is-solved")).toBe(1);
  });

  it("уход в фон (hidden) не перечитывает", async () => {
    await mount();
    await setVisibility("hidden");
    expect(h.listDays).toHaveBeenCalledTimes(1);
  });

  it("перечитывание обновляет и «сегодня»: после полуночи кольцо переезжает на новый день", async () => {
    await mount();
    expect(host.querySelector(".ymark.is-today")!.getAttribute("data-date")).toBe("2026-09-29");
    vi.setSystemTime(new Date(2026, 8, 30, 8, 0));
    await setVisibility("visible");
    expect(host.querySelector(".ymark.is-today")!.getAttribute("data-date")).toBe("2026-09-30");
  });

  it("subscribeRemote: данные, пришедшие с сервера, перерисовывают Year", async () => {
    await mount();
    expect(h.listeners.size).toBe(1);
    expect(isEmpty()).toBe(true);
    h.days = [progressOf("2026-09-10"), progressOf("2026-09-11", { withFix: true })];
    await act(async () => h.listeners.forEach((fn) => fn()));
    await flush();
    expect(h.listDays).toHaveBeenCalledTimes(2);
    expect(isEmpty()).toBe(false);
    expect(marks("is-solved")).toBe(2);
    expect(marks("has-corr")).toBe(1);
    expect(host.querySelector('[data-testid="year-totals"]')!.textContent).toBe("2 days · 1 clean · 1 with fixes");
  });

  it("при размонтировании отписывается от subscribeRemote и visibilitychange", async () => {
    await mount();
    act(() => root.unmount());
    expect(h.listeners.size).toBe(0);
    await setVisibility("visible");
    expect(h.listDays).toHaveBeenCalledTimes(1);
    root = createRoot(host); // для afterEach
  });

  it("хранилище недоступно: пустой год, а не вечная загрузка; прежние данные при сбое не затираются", async () => {
    h.fail = true;
    await mount();
    expect(isEmpty()).toBe(true);

    h.fail = false;
    h.days = [progressOf("2026-09-27")];
    await setVisibility("visible");
    expect(isEmpty()).toBe(false);

    h.fail = true;
    await setVisibility("visible");
    expect(isEmpty()).toBe(false);
    expect(marks("is-solved")).toBe(1);
  });
});

describe("YearTab: пустое состояние", () => {
  it("firstUse в прошлом, записей нет: приглашение, итоги aria-hidden, ни одного пропуска", async () => {
    await mount();
    expect(host.querySelector('[data-testid="year-empty"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="year-totals"]')!.getAttribute("aria-hidden")).toBe("true");
    expect(marks("is-missed")).toBe(0);
  });
});

describe("YearTab: записи из будущих лет", () => {
  it("запись 2027 при сегодня 2026: заголовок — 2026, в меню лет есть 2027", async () => {
    h.days = [progressOf("2027-02-03")];
    await mount();
    expect(host.querySelector(".titlebtn .title")!.textContent).toBe("2026");
    act(() => (host.querySelector(".titlebtn") as HTMLElement).click());
    expect([...host.querySelectorAll('[role="menuitemradio"]')].map((i) => i.textContent)).toEqual(["2027", "2026"]);
  });
});
