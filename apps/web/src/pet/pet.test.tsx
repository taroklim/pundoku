// @vitest-environment jsdom
/**
 * PD-180: Питомец-клякса — компонент (4 позы, VoiceOver en/uk/ru, маска глаз) и сводка дня → настроение.
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
import { PetBlot } from "./PetBlot";
import { dayPetMood, personalBestOf, petDayOfPlay } from "./petDay";

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
  it("4 позы: role=img, имя для VoiceOver, размер, маска глаз по уникальному id", () => {
    act(() =>
      root.render(
        <>
          {PET_MOODS.map((m) => (
            <PetBlot key={m} mood={m} size={24} />
          ))}
        </>,
      ),
    );
    const svgs = [...host.querySelectorAll("svg.pet-svg")];
    expect(svgs.map((s) => s.getAttribute("data-mood"))).toEqual(["happy", "tired", "surprised", "asleep"]);
    expect(svgs.map((s) => s.getAttribute("aria-label"))).toEqual(["Blot, pleased", "Blot, tired", "Blot, surprised", "Blot, asleep"]);
    for (const s of svgs) {
      expect(s.getAttribute("role")).toBe("img");
      expect(s.getAttribute("viewBox")).toBe("0 0 48 48");
      expect(s.getAttribute("width")).toBe("24");
      const id = s.querySelector("mask")!.id;
      expect(id).toMatch(/^pet-m-[a-zA-Z0-9]+$/);
      expect(s.querySelector(".pet-breathe > path")!.getAttribute("mask")).toBe(`url(#${id})`);
    }
    expect(new Set(svgs.map((s) => s.querySelector("mask")!.id)).size).toBe(4);
    expect(host.querySelector('[data-mood="asleep"] .pet-breathe')!.classList.contains("asleep")).toBe(true);
    // Один цвет — currentColor (чернила из CSS); в разметке нет зашитых цветов, кроме чёрно-белой маски.
    expect(host.innerHTML.replace(/<mask[\s\S]*?<\/mask>/g, "")).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
  });

  it("VoiceOver uk / ru", async () => {
    await act(async () => void (await i18n.changeLanguage("uk")));
    act(() => root.render(<PetBlot mood="tired" />));
    expect(host.querySelector("svg")!.getAttribute("aria-label")).toBe("Ляпка, втомилася");
    await act(async () => void (await i18n.changeLanguage("ru")));
    expect(host.querySelector("svg")!.getAttribute("aria-label")).toBe("Клякса, устала");
    for (const m of PET_MOODS) {
      expect(i18n.t(`pet.label.${m}`, { lng: "uk" })).not.toBe(`pet.label.${m}`);
      expect(i18n.t(`pet.label.${m}`, { lng: "ru" })).not.toBe(`pet.label.${m}`);
    }
  });

  it("decorative — скрыт от VoiceOver (превью с подписью)", () => {
    act(() => root.render(<PetBlot mood="happy" decorative />));
    const s = host.querySelector("svg")!;
    expect(s.getAttribute("aria-hidden")).toBe("true");
    expect(s.getAttribute("role")).toBeNull();
    expect(s.getAttribute("aria-label")).toBeNull();
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
