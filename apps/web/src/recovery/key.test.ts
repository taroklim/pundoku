import { describe, expect, it } from "vitest";
import { compactKey, isCompleteKey, keyGroups, normalizeKeyInput, spellGroup } from "./key";

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
