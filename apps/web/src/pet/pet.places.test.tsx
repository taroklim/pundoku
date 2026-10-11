// @vitest-environment jsdom
/**
 * PD-298: новые места Питомца (макет PD-296 §2, выбор владельца): 1 — шапка Today до решения; 7 — «не загрузилось» (Today, архив,
 * «день недоступен»); 8 — печать на PNG «Поделиться» + переключатель «Show Blot». Место 3 (ожидание генерации) — в
 * `play/WaitPanel.test.tsx`, место 6 (Настройки) — в `recovery/SettingsScreen.test.tsx`. Везде: тумблер Питомца выкл — кляксы нет.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { ExportSheet } from "../play/ExportSheet";
import { FP_GRID, FP_GRID_TOP, FP_PAD, FP_PET, FP_PET_X, FP_PET_Y, drawFingerprint, drawPetStamp, fingerprintLayout } from "../play/fingerprint";
import { createPlay, enterDigit, type PlayState } from "../play/logic";
import { SHARE_PET_KEY, getSharePet, setPetEnabled, setSharePet } from "../settings/prefs";
import type { DayDeps } from "../today/dayStore";
import { DayStore } from "../today/dayStore";
import { InMemoryProgressRepository } from "../today/repository";
import { DayView } from "../today/TodayScreen";
import { headSlotFits } from "./PetHeadSlot";
import { petShape } from "./petGeometry";
import { resetPokes } from "./petPoke";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;


let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  localStorage.clear();
  resetPokes();
  window.matchMedia = ((q: string) => ({ matches: q.includes("reduce"), media: q, addEventListener() {}, removeEventListener() {} })) as never;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const tid = (id: string) => q(`[data-testid="${id}"]`);

// ------------------------------------------------------------------------------------------------ места 1 и 7: Today / архив
function make({ fail = false, unavailable = false, archive = false } = {}) {
  const deps: DayDeps = {
    repo: new InMemoryProgressRepository(),
    fetchDay: vi.fn(async (d: string) =>
      fail || unavailable
        ? ({ ok: false as const, reason: "http" as const, status: unavailable ? 404 : 503 } as never)
        : { ok: true as const, puzzle: { date: d, mission: dailyPuzzle(d, "easy").mission, difficulty: "easy" as const, source: "sudoku.com" as const, winRate: 58.2 } },
    ),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => {
      if (fail) throw new Error("offline");
      return dailyPuzzle(d, diff);
    }),
    now: () => new Date(2026, 9, 9, 10, 0),
    isOnline: () => true,
    slowFetchMs: 50,
  };
  return new DayStore(deps, archive ? { archive: true } : undefined);
}
async function openDay(store: DayStore, phase: "playing" | "error", archive?: string) {
  await act(async () => root.render(<DayView store={store} archive={archive ? { date: archive, onBack: () => {} } : undefined} />));
  await act(async () => vi.waitFor(() => expect(store.getSnapshot().phase).toBe(phase), { timeout: 40000, interval: 25 }));
}

describe("место 1: шапка Today до решения", { timeout: 60000 }, () => {
  it("партия идёт: спящая клякса 40 pt первой в группе действий шапки (перед лампочкой), в зоне тапа; на поле её нет", async () => {
    await openDay(make(), "playing");
    const zone = tid("pet-today")!;
    expect(zone.classList.contains("pet-hit")).toBe(true);
    expect(zone.classList.contains("pet-head")).toBe(true);
    expect(zone.parentElement!.classList.contains("toolbar-end")).toBe(true);
    expect(zone.parentElement!.firstElementChild).toBe(zone);
    expect(zone.hidden).toBe(false);
    const pet = zone.querySelector<HTMLElement>(".pet")!;
    expect(pet.dataset.mood).toBe("asleep");
    expect(pet.style.width).toBe("40px");
    expect(pet.getAttribute("aria-label")).toBe("Blot, asleep");
    expect(host.querySelectorAll(".pet")).toHaveLength(1); // на экране одна клякса
    expect(host.querySelector(".board .pet")).toBeNull();
  });

  it("тумблер выкл — кляксы в шапке нет", async () => {
    setPetEnabled(false);
    await openDay(make(), "playing");
    expect(tid("pet-today")).toBeNull();
    expect(host.querySelector(".pet")).toBeNull();
  });

  it("день решён — кляксы в шапке нет (она на карточке)", async () => {
    const store = make();
    await openDay(store, "playing");
    await act(async () => {
      const { play } = store.getSnapshot();
      for (let i = 0; i < 81; i++) {
        if (play!.mission[i]) continue;
        store.select(i);
        store.input(play!.solution[i]!);
      }
    });
    await act(async () => vi.waitFor(() => expect(store.getSnapshot().phase).toBe("solved"), { timeout: 40000, interval: 25 }));
    expect(tid("pet-today")).toBeNull();
  });
});

describe("место 7: «не загрузилось»", { timeout: 60000 }, () => {
  it("Today, ошибка: спящая клякса слева от текста в зазоре; в шапке кляксы нет (одна на экране); «Try again» вне зоны тапа", async () => {
    await openDay(make({ fail: true }), "error");
    expect(tid("pet-today")).toBeNull();
    const row = tid("status-pet")!;
    expect(row.parentElement!.classList.contains("gap")).toBe(true);
    const zone = tid("pet-error")!;
    expect(row.firstElementChild).toBe(zone);
    expect(zone.querySelector(".pet")!.getAttribute("data-mood")).toBe("asleep");
    expect(zone.querySelector(".pet")!.getAttribute("aria-label")).toBe("Blot, asleep");
    const alert = row.querySelector('[role="alert"]')!;
    expect(alert.textContent).toBe("Couldn’t load today’s puzzle. Try again");
    expect(zone.contains(alert.querySelector("button"))).toBe(false);
    expect(host.querySelectorAll(".pet")).toHaveLength(1);
  });

  it("Today, ошибка, тумблер выкл — кляксы нет, разметка статуса прежняя", async () => {
    setPetEnabled(false);
    await openDay(make({ fail: true }), "error");
    expect(tid("status-pet")).toBeNull();
    expect(host.querySelector(".gap > .status[role='alert']")).not.toBeNull();
  });

  it("архив: «день недоступен» и «не загрузился» — та же клякса; uk/ru тексты прежние", async () => {
    await openDay(make({ unavailable: true, archive: true }), "error", "2026-09-01");
    expect(tid("pet-error")).not.toBeNull();
    expect(tid("archive-unavailable")!.closest('[data-testid="status-pet"]')).not.toBeNull();
    await act(async () => i18n.changeLanguage("uk"));
    expect(tid("archive-unavailable")!.textContent).toBe(uk.archive.unavailable);
    expect(tid("pet-error")!.querySelector(".pet")!.getAttribute("aria-label")).toBe("Ляпка, спить");
    await act(async () => i18n.changeLanguage("ru"));
    expect(tid("pet-error")!.querySelector(".pet")!.getAttribute("aria-label")).toBe("Клякса, спит");
  });

});

describe("место 1: клякса уходит, когда шапке не хватает места", () => {
  /** Шапка: [заголовок][группа действий: зона, лампочка, шестерёнка] — прямоугольники задаём сами (в jsdom раскладки нет). */
  function bar({ titleRight, endLeft, endOverflow = false, clipped = false }: { titleRight: number; endLeft: number; endOverflow?: boolean; clipped?: boolean }) {
    const b = document.createElement("header");
    const title = document.createElement("h1");
    title.className = "title";
    const end = document.createElement("div");
    end.style.columnGap = "8px";
    const zone = document.createElement("span");
    const gear = document.createElement("button");
    end.append(zone, gear);
    b.append(title, end);
    const rect = (r: Partial<DOMRect>) => () => ({ left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {}, ...r }) as DOMRect;
    b.getBoundingClientRect = rect({ width: 393 });
    title.getBoundingClientRect = rect({ right: titleRight });
    // Группа: зона 44 + шестерёнка 44 + зазор 8 = 96; «сжата» — 80.
    end.getBoundingClientRect = rect({ left: endLeft, width: endOverflow ? 80 : 96 });
    zone.getBoundingClientRect = rect({ width: 44 });
    gear.getBoundingClientRect = rect({ width: 44 });
    Object.defineProperty(title, "offsetParent", { get: () => b });
    Object.defineProperty(title, "scrollWidth", { get: () => (clipped ? 120 : 100) });
    Object.defineProperty(title, "clientWidth", { get: () => 100 });
    return zone;
  }
  it("показана: остаётся, пока до заголовка ≥ 12 и ничто не обрезано/не переполнено", () => {
    expect(headSlotFits(bar({ titleRight: 100, endLeft: 112 }), true)).toBe(true);
    expect(headSlotFits(bar({ titleRight: 100, endLeft: 105 }), true)).toBe(false);
    expect(headSlotFits(bar({ titleRight: 100, endLeft: 200, clipped: true }), true)).toBe(false);
    expect(headSlotFits(bar({ titleRight: 100, endLeft: 200, endOverflow: true }), true)).toBe(false);
  });
  it("скрыта: возвращается, только если свободно ≥ зазор 12 + зона 44 + зазор 8", () => {
    expect(headSlotFits(bar({ titleRight: 100, endLeft: 164 }), false)).toBe(true);
    expect(headSlotFits(bar({ titleRight: 100, endLeft: 150 }), false)).toBe(false);
  });
  it("без раскладки (ширина 0) — считаем, что место есть", () => {
    const z = document.createElement("span");
    expect(headSlotFits(z, true)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------ место 8: PNG «Поделиться»
const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
function solvedPlay(): PlayState {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  let t = 0;
  for (let i = 0; i < 81; i++) {
    if (p.mission[i]) continue;
    t += 1000;
    p = enterDigit(p, i, p.solution[i]!, t);
  }
  return p;
}

/** Холст-самописец: вызовы методов и присваивания (fillStyle/strokeStyle/lineWidth) по порядку. */
function recorder() {
  const log: string[] = [];
  const ctx = new Proxy({ measureText: () => ({ width: 100 }) } as Record<string, unknown>, {
    get: (o, k) => (k in o ? o[k as string] : (...a: unknown[]) => void log.push(`${String(k)}(${a.map((x) => (x instanceof FakePath ? `path:${x.d.slice(0, 12)}` : String(x))).join(",")})`)),
    set: (_o, k, v) => {
      log.push(`${String(k)}=${String(v)}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, log };
}
class FakePath {
  constructor(public d = "") {}
}

describe("место 8: печать Питомца на PNG", () => {
  it("печать 112 px в пустой верхней полосе над сеткой, по правому краю сетки", () => {
    expect(FP_PET).toBe(112);
    expect(FP_PET_X + FP_PET).toBe(FP_PAD + FP_GRID);
    expect(FP_PET_Y).toBeGreaterThanOrEqual(0);
    // Нижний край самой низкой капельки/тела (поле 48) — выше сетки.
    for (const m of ["happy", "tired", "surprised", "asleep"] as const) {
      const g = petShape(m);
      const lowest = Math.max(40, ...g.drops.map(([, y, r]) => y + r));
      const highest = Math.min(g.cy - 16, ...g.drops.map(([, y, r]) => y - r));
      expect(FP_PET_Y + (lowest * FP_PET) / 48, m).toBeLessThan(FP_GRID_TOP);
      expect(FP_PET_Y + (highest * FP_PET) / 48, m).toBeGreaterThan(0);
    }
  });

  it("рисует тело чернилами, капельки чернилами, глаза — цветом бумаги (PNG всегда светлый); без Path2D — печати нет", () => {
    expect(drawPetStamp(recorder().ctx, "happy")).toBe(false); // jsdom: Path2D нет
    vi.stubGlobal("Path2D", FakePath);
    const { ctx, log } = recorder();
    expect(drawPetStamp(ctx, "happy")).toBe(true);
    expect(log[0]).toBe("save()");
    expect(log).toContain(`translate(${FP_PET_X},${FP_PET_Y})`);
    expect(log).toContain(`scale(${FP_PET / 48},${FP_PET / 48})`);
    const ink = log.indexOf("fillStyle=#3b48b0");
    const body = log.findIndex((l) => l.startsWith("fill(path:M"));
    const paper = log.indexOf("strokeStyle=#ffffff");
    const eyes = log.findIndex((l, i) => i > paper && l.startsWith("stroke(path:"));
    expect(ink).toBeGreaterThan(-1);
    expect(body).toBeGreaterThan(ink);
    expect(log.some((l) => l.startsWith("arc("))).toBe(true); // капелька
    expect(eyes).toBeGreaterThan(body);
    expect(log[log.length - 1]).toBe("restore()");
    // «Удивлён» — глаза кругами цвета бумаги.
    const s = recorder();
    drawPetStamp(s.ctx, "surprised");
    const after = s.log.slice(s.log.indexOf("fillStyle=#ffffff"));
    expect(after.filter((l) => l.startsWith("arc("))).toHaveLength(2);
  });

  it("drawFingerprint: печать только если передано настроение", () => {
    vi.stubGlobal("Path2D", FakePath);
    const layout = fingerprintLayout({ cells: [], placed: 0 } as never, MISSION);
    const a = recorder();
    drawFingerprint(a.ctx, layout, { left: "Pundoku", right: "x" });
    expect(a.log).not.toContain(`translate(${FP_PET_X},${FP_PET_Y})`);
    const b = recorder();
    drawFingerprint(b.ctx, layout, { left: "Pundoku", right: "x" }, "tired");
    expect(b.log).toContain(`translate(${FP_PET_X},${FP_PET_Y})`);
  });
});

describe("место 8: лист экспорта — переключатель «Show Blot»", () => {
  function mount(petMood: "happy" | "tired" | null) {
    const stamps: number[] = [];
    vi.stubGlobal("Path2D", FakePath);
    let current = recorder();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      current = recorder();
      return current.ctx as never;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
      stamps.push(current.log.includes(`translate(${FP_PET_X},${FP_PET_Y})`) ? 1 : 0);
      cb(new Blob([new Uint8Array([1])], { type: "image/png" }));
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    return { stamps, render: () => act(async () => root.render(<ExportSheet play={solvedPlay()} date="2026-09-30" petMood={petMood} onClose={() => {}} />)) };
  }

  it("Питомец вкл: переключатель (switch, по умолчанию вкл) + сноска; PNG с печатью; выкл → PNG без печати, выбор запомнен", async () => {
    const m = mount("tired");
    await m.render();
    const sw = tid("fp-pet-toggle") as HTMLInputElement;
    expect(sw.type).toBe("checkbox");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.checked).toBe(true);
    expect(sw.closest("label")!.textContent).toBe("Show Blot");
    expect(document.getElementById(sw.getAttribute("aria-describedby")!)!.textContent).toBe("The blot shows how the day went.");
    expect(m.stamps).toEqual([1]);
    await act(async () => sw.closest("label")!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(getSharePet()).toBe(false);
    expect(localStorage.getItem(SHARE_PET_KEY)).toBe("0");
    expect(m.stamps).toEqual([1, 0]); // PNG перерисован без печати
    expect((tid("fp-pet-toggle") as HTMLInputElement).checked).toBe(false);
  });

  it("выбор «без кляксы» из прошлого раза — PNG сразу без печати", async () => {
    setSharePet(false);
    const m = mount("happy");
    await m.render();
    expect((tid("fp-pet-toggle") as HTMLInputElement).checked).toBe(false);
    expect(m.stamps).toEqual([0]);
  });

  it("Питомец выкл (petMood null) — ни переключателя, ни печати", async () => {
    const m = mount(null);
    await m.render();
    expect(tid("fp-pet-toggle")).toBeNull();
    expect(m.stamps).toEqual([0]);
  });

  it("uk/ru подписи", async () => {
    const m = mount("happy");
    await m.render();
    await act(async () => i18n.changeLanguage("uk"));
    expect(tid("fp-pet-toggle")!.closest("label")!.textContent).toBe("Показувати ляпку");
    await act(async () => i18n.changeLanguage("ru"));
    expect(tid("fp-pet-toggle")!.closest("label")!.textContent).toBe("Показывать кляксу");
  });
});

describe("строки PD-298 en/uk/ru", () => {
  it("тексты", () => {
    const pick = (l: typeof en) => [l.settings.extras.petTapFoot, l.timelapse.fpPet, l.timelapse.fpPetFoot];
    expect(pick(en)).toEqual(["Tap a blot to see how it reacts.", "Show Blot", "The blot shows how the day went."]);
    expect(pick(uk as typeof en)).toEqual(["Торкніться ляпки — побачите, як вона відгукується.", "Показувати ляпку", "Ляпка показує, як минув день."]);
    expect(pick(ru as typeof en)).toEqual(["Коснитесь кляксы — увидите, как она отзывается.", "Показывать кляксу", "Клякса показывает, как прошёл день."]);
    for (const l of [en, uk, ru]) expect(l.settings.extras.petFoot.length).toBeGreaterThan(40);
    expect(en.settings.extras.petFoot).toContain("reacts when you tap it");
  });
});
