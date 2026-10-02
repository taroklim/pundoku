import { describe, expect, it } from "vitest";
import { CHECK_GROUPS, compactKey, groupMatches, isCompleteKey, keyGroups, normalizeGroupInput, normalizeKeyInput, pickCheckGroups, spellGroup } from "./key";

const FULL = "K7QP-M2XZ-9D4T-VB6N-H3RW-8YCJ-5FGA-E0S1";

describe("нормализация ввода ключа", () => {
  it("регистр, пробелы и дефисы не важны; группы по 4 через дефис", () => {
    expect(normalizeKeyInput("k7qp m2xz\n9d4t")).toBe("K7QP-M2XZ-9D4T");
    expect(normalizeKeyInput("K7QP-M2XZ")).toBe("K7QP-M2XZ");
    expect(normalizeKeyInput("k7q")).toBe("K7Q");
    expect(normalizeKeyInput("")).toBe("");
  });

  it("не оставляет висящий дефис на границе группы", () => {
    expect(normalizeKeyInput("K7QP")).toBe("K7QP");
    expect(normalizeKeyInput("K7QPM")).toBe("K7QP-M");
  });

  it("путаница Crockford прощается: I/L→1, O→0, U→V", () => {
    expect(normalizeKeyInput("iloU")).toBe("110V");
  });

  it("обрезает до 32 знаков; вставленный ключ с мусором восстанавливается целиком", () => {
    expect(normalizeKeyInput(`  ${FULL.toLowerCase()} !!! extra`).replace(/-/g, "")).toHaveLength(32);
    expect(normalizeKeyInput(FULL.replace(/-/g, " ").toLowerCase())).toBe(FULL);
  });

  it("компактный вид и полнота", () => {
    expect(compactKey(FULL)).toHaveLength(32);
    expect(isCompleteKey(FULL)).toBe(true);
    expect(isCompleteKey(FULL.slice(0, -1))).toBe(false);
  });

  it("группы для плашек и озвучка по знакам", () => {
    expect(keyGroups(FULL)).toHaveLength(8);
    expect(keyGroups(FULL)[0]).toBe("K7QP");
    expect(keyGroups("short")).toEqual([]);
    expect(spellGroup("K7QP")).toBe("K 7 Q P");
  });
});

describe("проверка записи ключа: выбор и сравнение групп (PD-142)", () => {
  it("pickCheckGroups: две разные группы из 0..7 по возрастанию, при любом random, включая границы", () => {
    for (const r of [0, 0.0001, 0.5, 0.9999, 1]) {
      const g = pickCheckGroups(() => r);
      expect(g).toHaveLength(CHECK_GROUPS);
      expect(new Set(g).size).toBe(g.length);
      expect(g).toEqual([...g].sort((a, b) => a - b));
      for (const i of g) {
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(8);
      }
    }
    for (let n = 0; n < 500; n++) {
      const g = pickCheckGroups();
      expect(new Set(g).size).toBe(2);
    }
  });

  it("pickCheckGroups: покрывает все 8 позиций (не залипает на первых)", () => {
    const seen = new Set<number>();
    for (let n = 0; n < 400; n++) pickCheckGroups().forEach((i) => seen.add(i));
    expect(seen.size).toBe(8);
  });

  it("normalizeGroupInput: правила поля ключа, ровно 4 знака; целый ключ → нужная группа", () => {
    expect(normalizeGroupInput(" k7-qp ", 0)).toBe("K7QP");
    expect(normalizeGroupInput("k7qpzz", 0)).toBe("K7QP");
    expect(normalizeGroupInput("o1il", 0)).toBe("0111");
    expect(normalizeGroupInput("", 3)).toBe("");
    expect(normalizeGroupInput(FULL, 0)).toBe("K7QP");
    expect(normalizeGroupInput(FULL.toLowerCase(), 5)).toBe("8YCJ");
    expect(normalizeGroupInput(FULL.replace(/-/g, "\n"), 7)).toBe("E0S1");
    expect(normalizeGroupInput(FULL.slice(0, 30), 7)).toBe("K7QP"); // 30 знаков — это не целый ключ
  });

  it("groupMatches: точное совпадение 4 знаков; пустое, короткое, чужая группа, неполный ключ — нет", () => {
    expect(groupMatches(FULL, 2, "9D4T")).toBe(true);
    expect(groupMatches(FULL.replace(/-/g, ""), 2, "9D4T")).toBe(true);
    expect(groupMatches(FULL, 2, "9D4")).toBe(false);
    expect(groupMatches(FULL, 2, "")).toBe(false);
    expect(groupMatches(FULL, 2, "M2XZ")).toBe(false);
    expect(groupMatches(FULL, 8, "K7QP")).toBe(false);
    expect(groupMatches("K7QP-M2XZ", 0, "K7QP")).toBe(false);
  });
});
