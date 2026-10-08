// @vitest-environment jsdom
/**
 * PD-180: Питомец-клякса — компонент (4 позы, VoiceOver en/uk/ru, маска глаз) и сводка дня → настроение.
 * PD-260: движение B «Капля» — покой «3 вдоха», посадка на решённый день, «проснуться», Reduce Motion, скрытая вкладка/фон.
 * Геометрия против макета и стили — `pet.geometry.test.ts` (node-окружение: читает файлы).
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PET_MOODS } from "@pundoku/engine";
import i18n from "../i18n";
import { progressOf } from "../sync/fixtures";
import { dayRecordFromProgress, progressFromRecord } from "../sync/schema";
import type { DayProgress } from "../today/repository";
import type { PetMood } from "@pundoku/engine";
import { TabActiveContext } from "../shell/tabSlide";
import { PetBlot } from "./PetBlot";
import { dayPetMood, personalBestOf, petDayOfPlay } from "./petDay";
import { petShape } from "./petGeometry";
import { ARRIVE_DELAY_MS, IDLE_BREATHS, idleTotalMs } from "./petMotion";
import { PET_SEEN_KEY, PET_SEEN_MAX, rememberMood, seenMood, useWakeOnce } from "./petSeen";
import { useSolvedNow } from "./useSolvedNow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---- компонент -----------------------------------------------------------------------------------------------------------------
let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("PetBlot", () => {
  const petEl = () => host.querySelector<HTMLElement>(".pet")!;
  it("4 позы: role=img, имя для VoiceOver, размер, маска глаз по уникальному id; слои макета PD-223 B", () => {
    act(() =>
      root.render(
        <>
          {PET_MOODS.map((m) => (
            <PetBlot key={m} mood={m} size={24} />
          ))}
        </>,
      ),
    );
    const pets = [...host.querySelectorAll<HTMLElement>(".pet")];
    expect(pets.map((s) => s.getAttribute("data-mood"))).toEqual(["happy", "tired", "surprised", "asleep"]);
    expect(pets.map((s) => s.getAttribute("aria-label"))).toEqual(["Blot, pleased", "Blot, tired", "Blot, surprised", "Blot, asleep"]);
    for (const [i, s] of pets.entries()) {
      expect(s.tagName).toBe("SPAN");
      expect(s.getAttribute("role")).toBe("img");
      expect(s.getAttribute("data-v")).toBe("B");
      expect(s.style.width).toBe("24px");
      expect(s.style.height).toBe("24px");
      // Покой без действия: одна поза (to) внутри .breath, капельки — HTML вне .breath (лежат на бумаге, не «дышат»).
      expect(s.querySelectorAll(".pose")).toHaveLength(1);
      const svg = s.querySelector(".breath > .pose.to > svg.pet-svg")!;
      expect(svg.getAttribute("viewBox")).toBe("0 0 48 48");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      const id = svg.querySelector("mask")!.id;
      expect(id).toMatch(/^pet-m-[a-zA-Z0-9]+$/);
      expect(svg.querySelector("path.pet-ink")!.getAttribute("mask")).toBe(`url(#${id})`);
      expect(s.querySelectorAll(".breath .drop")).toHaveLength(0);
      expect(s.querySelectorAll(":scope > .drops.to > .drop")).toHaveLength(petShape(PET_MOODS[i]!).drops.length);
      expect(s.hasAttribute("data-act")).toBe(false);
    }
    expect(new Set(pets.map((s) => s.querySelector("mask")!.id)).size).toBe(4);
    // Один цвет — currentColor (чернила из CSS); в разметке нет зашитых цветов, кроме чёрно-белой маски.
    expect(host.innerHTML.replace(/<mask[\s\S]*?<\/mask>/g, "")).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
  });

  it("VoiceOver uk / ru", async () => {
    await act(async () => void (await i18n.changeLanguage("uk")));
    act(() => root.render(<PetBlot mood="tired" />));
    expect(petEl().getAttribute("aria-label")).toBe("Ляпка, втомилася");
    await act(async () => void (await i18n.changeLanguage("ru")));
    expect(petEl().getAttribute("aria-label")).toBe("Клякса, устала");
    for (const m of PET_MOODS) {
      expect(i18n.t(`pet.label.${m}`, { lng: "uk" })).not.toBe(`pet.label.${m}`);
      expect(i18n.t(`pet.label.${m}`, { lng: "ru" })).not.toBe(`pet.label.${m}`);
    }
  });

  it("decorative — скрыт от VoiceOver (превью с подписью)", () => {
    act(() => root.render(<PetBlot mood="happy" decorative />));
    const s = petEl();
    expect(s.getAttribute("aria-hidden")).toBe("true");
    expect(s.getAttribute("role")).toBeNull();
    expect(s.getAttribute("aria-label")).toBeNull();
  });
});

// ---- PD-260: движение (вариант B «Капля» макета PD-223) -------------------------------------------------------------------------
describe("PetBlot: покой, реакция, Reduce Motion, видимость", () => {
  const petEl = () => host.querySelector<HTMLElement>(".pet")!;
  afterEach(() => {
    document.documentElement.style.removeProperty("--mo");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("покой: «3 вдоха и замирает» включён (data-idle), без действия; при Reduce Motion (--mo: 0) — статично, покоя нет", () => {
    act(() => root.render(<PetBlot mood="happy" />));
    expect(petEl().hasAttribute("data-idle")).toBe(true);
    expect(petEl().hasAttribute("data-act")).toBe(false);
    expect(IDLE_BREATHS).toBe(3);
    expect(idleTotalMs("happy")).toBe(12600);
    expect(idleTotalMs("asleep")).toBe(19500);
    act(() => root.unmount());
    document.documentElement.style.setProperty("--mo", "0");
    root = createRoot(host);
    act(() => root.render(<PetBlot mood="happy" />));
    expect(petEl().hasAttribute("data-idle")).toBe(false);
    expect(petEl().hasAttribute("data-still")).toBe(false);
  });

  it("реакция на решённый день: посадка по настроению (доволен 760, устал 900, удивлён 860 мс; RM 220), после задержки", () => {
    const want = { happy: "760ms", tired: "900ms", surprised: "860ms" } as const;
    for (const mood of ["happy", "tired", "surprised"] as const) {
      act(() => root.render(<PetBlot key={mood} mood={mood} act="arrive" actDelay={ARRIVE_DELAY_MS} />));
      const s = petEl();
      expect(s.getAttribute("data-act")).toBe("arrive");
      expect(s.style.getPropertyValue("--d-full")).toBe(want[mood]);
      expect(s.style.getPropertyValue("--d-rm")).toBe("220ms");
      expect(s.style.getPropertyValue("--act-delay")).toBe("300ms");
      // Брызги отлетают из-под капли: векторы к центру тела.
      for (const d of s.querySelectorAll<HTMLElement>(".drops.to > .drop")) {
        expect(d.style.getPropertyValue("--dx")).toMatch(/^-?\d+\.\d\dpx$/);
        expect(d.style.getPropertyValue("--dy")).toMatch(/^-?\d+\.\d\dpx$/);
      }
      // Покой — после действия (та же разметка: data-idle; задержка вдохов = задержка + длительность в CSS).
      expect(s.hasAttribute("data-idle")).toBe(true);
    }
    expect(ARRIVE_DELAY_MS).toBe(300);
  });

  it("«проснуться»: лужица (спит) → настроение с подогнанным масштабом; для «спит» действие не играет", () => {
    act(() => root.render(<PetBlot mood="happy" act="wake" />));
    const s = petEl();
    expect(s.getAttribute("data-act")).toBe("wake");
    expect(s.style.getPropertyValue("--d-full")).toBe("820ms");
    expect(s.style.getPropertyValue("--d-rm")).toBe("260ms");
    const from = s.querySelector<HTMLElement>(".breath > .pose.from")!;
    const to = s.querySelector<HTMLElement>(".breath > .pose.to")!;
    expect(from.getAttribute("data-mood")).toBe("asleep");
    expect(to.getAttribute("data-mood")).toBe("happy");
    const a = petShape("asleep");
    const h = petShape("happy");
    expect(Number(from.style.getPropertyValue("--sx"))).toBeCloseTo(h.w / a.w, 4);
    expect(Number(from.style.getPropertyValue("--sy"))).toBeCloseTo(h.h / a.h, 4);
    expect(Number(to.style.getPropertyValue("--isx"))).toBeCloseTo(a.w / h.w, 4);
    expect(Number(to.style.getPropertyValue("--isy"))).toBeCloseTo(a.h / h.h, 4);
    expect(s.querySelectorAll(":scope > .drops.from > .drop")).toHaveLength(a.drops.length);
    expect(from.querySelector("mask")!.id).not.toBe(to.querySelector("mask")!.id);
    act(() => root.render(<PetBlot mood="asleep" act="wake" />));
    expect(petEl().hasAttribute("data-act")).toBe(false);
    expect(petEl().querySelector(".pose.from")).toBeNull();
  });

  it("вкладка скрыта — клякса стоит (data-still, без действия); вернулась — покой заново (ремаунт), действие не повторяется", () => {
    const view = (on: boolean) => (
      <TabActiveContext.Provider value={on}>
        <PetBlot mood="tired" act="arrive" actDelay={300} />
      </TabActiveContext.Provider>
    );
    act(() => root.render(view(true)));
    const first = petEl();
    expect(first.getAttribute("data-act")).toBe("arrive");
    act(() => root.render(view(false)));
    expect(petEl().hasAttribute("data-still")).toBe(true);
    expect(petEl().hasAttribute("data-idle")).toBe(false);
    expect(petEl().hasAttribute("data-act")).toBe(false);
    act(() => root.render(view(true)));
    const again = petEl();
    expect(again).not.toBe(first);
    expect(again.hasAttribute("data-still")).toBe(false);
    expect(again.hasAttribute("data-idle")).toBe(true);
    expect(again.hasAttribute("data-act")).toBe(false);
  });

  it("приложение в фоне (visibilitychange) — стоит; вернулось — покой заново", () => {
    act(() => root.render(<PetBlot mood="happy" />));
    const first = petEl();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(petEl().hasAttribute("data-still")).toBe(true);
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(petEl()).not.toBe(first);
    expect(petEl().hasAttribute("data-idle")).toBe(true);
  });

  it("скрытая при монтаже (решили в скрытой вкладке) — посадка не играет и после показа", () => {
    const view = (on: boolean) => (
      <TabActiveContext.Provider value={on}>
        <PetBlot mood="happy" act="arrive" />
      </TabActiveContext.Provider>
    );
    act(() => root.render(view(false)));
    expect(petEl().hasAttribute("data-act")).toBe(false);
    act(() => root.render(view(true)));
    expect(petEl().hasAttribute("data-act")).toBe(false);
    expect(petEl().hasAttribute("data-idle")).toBe(true);
  });
});

describe("useSolvedNow", () => {
  function Probe({ phase, enabled }: { phase: string; enabled: boolean }) {
    return <i data-now={String(useSolvedNow(phase, enabled))} />;
  }
  const now = () => host.querySelector("i")!.getAttribute("data-now");
  it("только переход playing → solved при enabled; загрузка решённого, скрытая вкладка/чужая победа — нет; новая партия сбрасывает", () => {
    act(() => root.render(<Probe phase="solved" enabled />));
    expect(now()).toBe("false"); // смонтированы на решённом
    act(() => root.render(<Probe phase="loading" enabled />));
    act(() => root.render(<Probe phase="solved" enabled />));
    expect(now()).toBe("false"); // загрузка → решено
    act(() => root.render(<Probe phase="playing" enabled />));
    act(() => root.render(<Probe phase="solved" enabled />));
    expect(now()).toBe("true");
    act(() => root.render(<Probe phase="solved" enabled={false} />));
    expect(now()).toBe("true"); // держится, пока «решено»
    act(() => root.render(<Probe phase="playing" enabled />));
    expect(now()).toBe("false");
    act(() => root.render(<Probe phase="solved" enabled={false} />));
    expect(now()).toBe("false"); // победа с другого устройства / скрытая вкладка
  });
});

describe("petSeen: «проснуться» один раз", () => {
  beforeEach(() => localStorage.clear());
  it("помнит показанное настроение даты; wake — только «спит» → закончен, один раз; память ограничена", () => {
    expect(seenMood("2026-09-10")).toBeNull();
    rememberMood("2026-09-10", "asleep");
    expect(seenMood("2026-09-10")).toBe("asleep");
    function Probe({ date, mood }: { date: string; mood: PetMood }) {
      return <i data-wake={String(useWakeOnce(date, mood))} />;
    }
    const wake = () => host.querySelector("i")!.getAttribute("data-wake");
    act(() => root.render(<Probe key="a" date="2026-09-10" mood="asleep" />));
    expect(wake()).toBe("false");
    act(() => root.render(<Probe key="b" date="2026-09-10" mood="happy" />));
    expect(wake()).toBe("true");
    expect(seenMood("2026-09-10")).toBe("happy");
    act(() => root.render(<Probe key="c" date="2026-09-10" mood="happy" />));
    expect(wake()).toBe("false");
    for (let i = 0; i < PET_SEEN_MAX + 5; i++) rememberMood(`2027-${String(1 + (i % 12)).padStart(2, "0")}-${String(1 + i).padStart(4, "0")}`, "happy");
    expect(Object.keys(JSON.parse(localStorage.getItem(PET_SEEN_KEY)!) as object)).toHaveLength(PET_SEEN_MAX);
    localStorage.setItem(PET_SEEN_KEY, "{broken");
    expect(seenMood("2026-09-10")).toBeNull();
  });
});

// ---- сводка дня → настроение -----------------------------------------------------------------------------------------------------
const day = (date: string, opts: Parameters<typeof progressOf>[1] & { difficulty?: DayProgress["difficulty"]; assisted?: boolean; hints?: number } = {}): DayProgress => {
  const p = progressOf(date, opts);
  return { ...p, difficulty: opts.difficulty === undefined ? p.difficulty : opts.difficulty, assisted: opts.assisted ?? false, ...(opts.hints ? { hints: opts.hints } : {}) };
};
/** Тот же день, но с другим временем решения (растягиваем/сжимаем тайминги лога). */
const withTime = (d: DayProgress, factor: number): DayProgress => ({ ...d, play: { ...d.play, log: d.play.log.map((m) => ({ ...m, t: Math.round(m.t * factor) })) } });

describe("petDayOfPlay / dayPetMood / personalBestOf", () => {
  it("сводка: правки, подсказки (или пометка «с помощью»), Лжец", () => {
    const fixed = day("2026-09-10", { withFix: true });
    expect(petDayOfPlay(fixed.play, true)).toMatchObject({ solved: true, corrections: 1, hints: 0, ink: false, liarFirstTry: false });
    expect(petDayOfPlay(fixed.play, true, { assisted: true }).hints).toBe(1);
    expect(petDayOfPlay(fixed.play, true, { hints: 3 }).hints).toBe(3);
    const liar = { caught: true, firstTry: true, wrongAccusations: 0, catchT: 1000, catchPlacement: 3 };
    expect(petDayOfPlay(fixed.play, true, { liar }).liarFirstTry).toBe(true);
    expect(petDayOfPlay(fixed.play, true, { liar: { ...liar, firstTry: false, wrongAccusations: 1 } }).liarFirstTry).toBe(false);
  });

  it("лист дня: не играл / не закончил → спит; чисто → доволен; правки или подсказка → устал", () => {
    expect(dayPetMood(undefined, null, [])).toBe("asleep");
    expect(dayPetMood(day("2026-09-10", { solved: false, moves: 5 }), null, [])).toBe("asleep");
    expect(dayPetMood(day("2026-09-10"), null, [])).toBe("happy");
    expect(dayPetMood(day("2026-09-10", { withFix: true }), null, [])).toBe("tired");
    expect(dayPetMood(day("2026-09-10", { assisted: true, hints: 1 }), null, [])).toBe("tired");
  });

  it("Лжец даты с первого обвинения — удивлён, даже без классической сетки", () => {
    const first = { caught: true, firstTry: true, wrongAccusations: 0, catchT: 1000, catchPlacement: 3 };
    expect(dayPetMood(undefined, first, [])).toBe("surprised");
    expect(dayPetMood(day("2026-09-10", { withFix: true }), first, [])).toBe("surprised");
  });

  it("PD-191: Лжец пойман не с первого обвинения, классики нет → день сыгран, доволен; не пойман → спит", () => {
    const later = { caught: true, firstTry: false, wrongAccusations: 2, catchT: 5000, catchPlacement: 7 };
    expect(dayPetMood(undefined, later, [])).toBe("happy");
    const open = { caught: false, firstTry: false, wrongAccusations: 1, catchT: null, catchPlacement: null };
    expect(dayPetMood(undefined, open, [])).toBe("asleep");
    expect(dayPetMood(undefined, { ...open, wrongAccusations: 0 }, [])).toBe("asleep");
    // Классика есть — настроение по ней, как раньше.
    expect(dayPetMood(day("2026-09-10", { withFix: true }), later, [])).toBe("tired");
    expect(dayPetMood(day("2026-09-10"), later, [])).toBe("happy");
    expect(dayPetMood(day("2026-09-10", { solved: false, moves: 5 }), open, [])).toBe("asleep");
  });

  it("PD-197: классика начата и брошена, Лжец пойман не с первого обвинения → доволен (брошенная классика не перебивает Лжеца)", () => {
    const later = { caught: true, firstTry: false, wrongAccusations: 2, catchT: 5000, catchPlacement: 7 };
    const abandoned = day("2026-09-10", { solved: false, moves: 5 });
    expect(dayPetMood(abandoned, later, [])).toBe("happy");
    expect(dayPetMood(day("2026-09-10", { solved: false, moves: 5, withFix: true }), later, [])).toBe("happy");
    // Лжец не пойман — по классике, как раньше: не закончил → спит.
    expect(dayPetMood(abandoned, { ...later, caught: false, catchT: null, catchPlacement: null }, [])).toBe("asleep");
    expect(dayPetMood(abandoned, null, [])).toBe("asleep");
    // Решённая классика по-прежнему главнее: правки → устал.
    expect(dayPetMood(day("2026-09-10", { withFix: true }), later, [])).toBe("tired");
  });

  it("личный рекорд: быстрее всех прежних дней той же сложности без подсказок; первое решение — не рекорд", () => {
    const a = day("2026-09-10");
    const b = withTime(day("2026-09-11"), 0.5);
    const all = [a, b];
    expect(personalBestOf(a, all)).toBe(false); // первое решение сложности
    expect(personalBestOf(b, all)).toBe(true);
    expect(dayPetMood(b, null, all)).toBe("surprised");
    // Рекорд остаётся рекордом и после того, как его побили позже.
    const c = withTime(day("2026-09-12"), 0.25);
    expect(personalBestOf(b, [a, b, c])).toBe(true);
    // Другая сложность — другой класс.
    expect(personalBestOf(b, [{ ...a, difficulty: "hard" }, b])).toBe(false);
    // Прежний день с подсказкой в историю не идёт; сам день с подсказкой рекордом не бывает.
    expect(personalBestOf(b, [{ ...a, assisted: true }, b])).toBe(false);
    expect(personalBestOf({ ...b, hints: 1 }, all)).toBe(false);
    // Не решённые прежние дни не в счёт; день без сложности рекордом не бывает.
    expect(personalBestOf(b, [{ ...a, solved: false }, b])).toBe(false);
    expect(personalBestOf({ ...b, difficulty: null }, all)).toBe(false);
  });

  it("«раньше» — по моменту решения: архивный день, решённый позже, сравнивается с тем, что было до него", () => {
    const old = withTime(day("2026-09-01", { solvedAt: "2026-09-20T10:00:00.000Z" }), 0.5); // сыгран в архиве позже
    const fresh = day("2026-09-10", { solvedAt: "2026-09-10T10:00:00.000Z" });
    expect(personalBestOf(old, [old, fresh])).toBe(true);
    expect(personalBestOf(fresh, [old, fresh])).toBe(false); // первое решение класса на тот момент
  });

  it("PD-197: пустой solvedAt — порядок по началу даты дня, рекорд прошлого дня не пропадает задним числом", () => {
    // Старая запись без solvedAt: рекорд против более раннего дня.
    const a = day("2026-09-05", { solvedAt: "2026-09-05T10:00:00.000Z" });
    const legacy: DayProgress = { ...withTime(day("2026-09-10"), 0.5), solvedAt: null };
    expect(personalBestOf(legacy, [a, legacy])).toBe(true);
    // Позже в архиве решён ещё более ранний день, и быстрее: он решён ПОСЛЕ legacy — рекорд legacy остаётся.
    const archive = withTime(day("2026-09-01", { solvedAt: "2026-09-20T10:00:00.000Z" }), 0.25);
    expect(personalBestOf(legacy, [a, legacy, archive])).toBe(true);
    expect(personalBestOf(archive, [a, legacy, archive])).toBe(true);
    // Две записи без solvedAt — по дате дня; результат не зависит от порядка перебора.
    const legacyA: DayProgress = { ...a, solvedAt: null };
    expect(personalBestOf(legacy, [legacy, legacyA])).toBe(true);
    expect(personalBestOf(legacy, [legacyA, legacy])).toBe(true);
    expect(personalBestOf(legacyA, [legacy, legacyA])).toBe(false);
    // Пустой solvedAt тот же, что начало даты дня в снапшоте (выгрузка синка) — порядок совпадает на другом устройстве.
    const synced: DayProgress = { ...legacy, solvedAt: "2026-09-10T00:00:00.000Z" };
    expect(personalBestOf(synced, [a, synced, archive])).toBe(true);
  });

  it("PD-217 (Low-1 QA PD-181, закрыт PD-197): рекорды одинаковы на устройстве с пустым solvedAt и на другом после синка, в любом порядке, и не зависят от «сейчас»", () => {
    // Устройство A: две старые записи без solvedAt и архивный день, решённый позже, быстрее всех.
    const legacy1: DayProgress = { ...withTime(day("2026-09-05"), 1), solvedAt: null };
    const legacy2: DayProgress = { ...withTime(day("2026-09-10"), 0.5), solvedAt: null };
    const archive = withTime(day("2026-09-01", { solvedAt: "2026-09-20T10:00:00.000Z" }), 0.25);
    const deviceA = [legacy1, legacy2, archive];
    // Устройство B получает те же дни через снапшот: выгрузка в разные «сейчас» (циклы синка) даёт одно и то же.
    const viaSync = (now: string) => deviceA.map((p) => progressFromRecord(p.date, dayRecordFromProgress(p, new Date(now))!)!);
    const deviceB1 = viaSync("2026-09-21T08:00:00.000Z");
    const deviceB2 = viaSync("2027-03-01T23:59:00.000Z");
    expect(deviceB1.map((p) => p.solvedAt)).toEqual(["2026-09-05T00:00:00.000Z", "2026-09-10T00:00:00.000Z", "2026-09-20T10:00:00.000Z"]);
    expect(deviceB2.map((p) => p.solvedAt)).toEqual(deviceB1.map((p) => p.solvedAt));
    const perms = <T,>(xs: T[]): T[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r])));
    const bests = (list: DayProgress[]) => perms(list).map((order) => list.map((d) => personalBestOf(d, order)));
    // Ожидание: 09-05 — первое решение класса (не рекорд); 09-10 быстрее → рекорд и остаётся им; архив решён позже и быстрее → рекорд.
    const want = [false, true, true];
    for (const r of bests(deviceA)) expect(r).toEqual(want);
    for (const r of bests(deviceB1)) expect(r).toEqual(want);
    for (const r of bests(deviceB2)) expect(r).toEqual(want);
  });
});
