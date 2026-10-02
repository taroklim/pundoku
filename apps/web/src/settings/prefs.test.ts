// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getHighlightWrong, HIGHLIGHT_WRONG_KEY, setHighlightWrong } from "./prefs";

beforeEach(() => {
  localStorage.clear();
  setHighlightWrong(false);
});
afterEach(() => vi.restoreAllMocks());

describe("prefs: highlightWrong (PD-112)", () => {
  it("чистый профиль и профиль со старым состоянием — выкл (ключа нет)", () => {
    expect(getHighlightWrong()).toBe(false);
    localStorage.setItem("pundoku.locale", "uk"); // «старое» состояние: язык есть, настройки нет
    expect(getHighlightWrong()).toBe(false);
  });

  it("включено только значением «1»; выкл удаляет ключ", () => {
    setHighlightWrong(true);
    expect(localStorage.getItem(HIGHLIGHT_WRONG_KEY)).toBe("1");
    expect(getHighlightWrong()).toBe(true);
    localStorage.setItem(HIGHLIGHT_WRONG_KEY, "true");
    expect(getHighlightWrong()).toBe(false);
    setHighlightWrong(true);
    setHighlightWrong(false);
    expect(localStorage.getItem(HIGHLIGHT_WRONG_KEY)).toBeNull();
  });

  it("localStorage недоступен (приватный режим): значение живёт в памяти до перезагрузки, ошибок нет", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(getHighlightWrong()).toBe(false);
    setHighlightWrong(true);
    expect(getHighlightWrong()).toBe(true);
    setHighlightWrong(false);
    expect(getHighlightWrong()).toBe(false);
  });
});
