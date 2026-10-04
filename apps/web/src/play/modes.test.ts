/**
 * PD-167: реестр режимов — единственный источник списка хаба, шита режима, чипа и слотов. Здесь: только готовые режимы в
 * списке, порядок фиксирован, id уникальны и годны для ключа слота, тексты есть во всех локалях, правило архива для Чернил
 * то же, что применяет архив (`INK_RULES.allowInArchive`), подсказки/чип/подготовка партии по режиму.
 */
import { DIFFICULTIES, INK_RULES } from "@pundoku/engine";
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en.json";
import ru from "../i18n/locales/ru.json";
import uk from "../i18n/locales/uk.json";
import { createPlay } from "./logic";
import type { ModeDef } from "./modes";
import { DEFAULT_MODE, MODES, availableModes, isModeId, legacyModeOf, modeDef, slotKey } from "./modes";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

type Tree = { [k: string]: string | Tree };
const get = (t: Tree, path: string): unknown => path.split(".").reduce<unknown>((n, k) => (n as Tree | undefined)?.[k], t);

describe("реестр режимов", () => {
  it("сейчас готовы ровно Классика и Чернила, в этом порядке; Классика — режим по умолчанию", () => {
    expect(availableModes().map((m) => m.id)).toEqual(["classic", "ink"]);
    expect(DEFAULT_MODE).toBe("classic");
    expect(MODES[0]!.id).toBe(DEFAULT_MODE);
  });

  it("неготовый режим в списке не появляется (без «скоро» и мёртвых кнопок); порядок остальных сохраняется", () => {
    const draft: ModeDef = { ...modeDef("ink"), ready: false };
    expect(availableModes([modeDef("classic"), draft]).map((m) => m.id)).toEqual(["classic"]);
    expect(availableModes([draft, modeDef("classic")]).map((m) => m.id)).toEqual(["classic"]);
  });

  it("id уникальны, ключ слота — `playGame:<id>`; неизвестный id не принимается; modeDef неизвестного — Классика", () => {
    const ids = MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(slotKey("ink")).toBe("playGame:ink");
    expect(isModeId("ink")).toBe(true);
    expect(isModeId("liar")).toBe(false);
    expect(isModeId(undefined)).toBe(false);
    expect(modeDef("nope" as never).id).toBe("classic");
  });

  it("у каждого режима имя и описание во всех трёх локалях, непустые", () => {
    for (const loc of [en, uk, ru] as unknown as Tree[]) {
      for (const m of MODES) {
        expect(get(loc, `modes.${m.textKey}.name`), `${m.id}.name`).toEqual(expect.any(String));
        expect((get(loc, `modes.${m.textKey}.desc`) as string).length).toBeGreaterThan(10);
      }
    }
  });

  it("общие строки режимов есть во всех локалях; плейсхолдер {{meta}} одинаков", () => {
    const keys = ["head", "foot", "status", "difficulty", "start", "startNew", "cancel", "discard", "continue", "newPuzzle"];
    for (const loc of [en, uk, ru] as unknown as Tree[]) {
      for (const k of keys) expect(get(loc, `modes.${k}`), k).toEqual(expect.any(String));
      expect(get(loc, "modes.status")).toContain("{{meta}}");
      expect(get(loc, "modes.discard")).toContain("{{meta}}");
    }
  });

  it("Чернила: в архиве — ровно по правилу движка (сейчас запрещены), без подсказок, с чипом и с правилом PD-74 перед стартом", () => {
    const ink = modeDef("ink");
    expect(ink.allowInArchive).toBe(INK_RULES.allowInArchive);
    expect(ink.allowInArchive).toBe(false);
    expect(ink.hints).toBe(false);
    expect(ink.chip).toBe(true);
    expect(ink.Rule).toBeDefined();
    const prepared = ink.prepare!(createPlay({ mission: MISSION, solution: SOLUTION }));
    expect(prepared.ink).toBe(true);
  });

  it("Классика: подсказки есть, чипа нет, партия как сгенерирована, все сложности", () => {
    const c = modeDef("classic");
    expect(c.hints).toBe(true);
    expect(c.chip).toBe(false);
    expect(c.prepare).toBeUndefined();
    expect(c.Rule).toBeUndefined();
    expect(c.difficulties).toEqual(DIFFICULTIES);
  });

  it("режим записи до PD-167 выводится из самой партии", () => {
    expect(legacyModeOf({ ink: true })).toBe("ink");
    expect(legacyModeOf({})).toBe("classic");
    expect(legacyModeOf({ ink: false })).toBe("classic");
  });
});
