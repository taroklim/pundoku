// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_CLEAR_NOTES_KEY,
  getAutoClearNotes,
  getHighlightPeers,
  getHighlightWrong,
  HIGHLIGHT_PEERS_KEY,
  HIGHLIGHT_WRONG_KEY,
  PET_KEY,
  getPetEnabled,
  setAutoClearNotes,
  setPetEnabled,
  setHighlightPeers,
  setHighlightWrong,
} from "./prefs";

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

describe.each([
  ["autoClearNotes (PD-119)", AUTO_CLEAR_NOTES_KEY, getAutoClearNotes, setAutoClearNotes],
  ["highlightPeers (PD-124)", HIGHLIGHT_PEERS_KEY, getHighlightPeers, setHighlightPeers],
])("prefs: %s — по умолчанию ВКЛ", (_name, key, get, set) => {
  beforeEach(() => set(true));

  it("чистый профиль и профиль со старым состоянием — вкл (ключа нет)", () => {
    localStorage.clear();
    expect(get()).toBe(true);
    localStorage.setItem("pundoku.locale", "uk");
    expect(get()).toBe(true);
  });

  it("выкл — значение «0» (ключ нужен, раз умолчание вкл); вкл снова удаляет ключ; чужое значение — вкл", () => {
    set(false);
    expect(localStorage.getItem(key)).toBe("0");
    expect(get()).toBe(false);
    set(true);
    expect(localStorage.getItem(key)).toBeNull();
    expect(get()).toBe(true);
    localStorage.setItem(key, "garbage");
    expect(get()).toBe(true);
  });

  it("независима от соседних настроек", () => {
    set(false);
    expect(getHighlightWrong()).toBe(false);
    setHighlightWrong(true);
    expect(get()).toBe(false);
    setHighlightWrong(false);
  });

  it("localStorage недоступен: значение живёт в памяти, ошибок нет", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(get()).toBe(true);
    set(false);
    expect(get()).toBe(false);
    set(true);
    expect(get()).toBe(true);
  });
});

describe("prefs: питомец-клякса (PD-180, PD-297 — по умолчанию ВКЛ)", () => {
  beforeEach(() => setPetEnabled(true));

  it("чистый профиль и профиль со старым состоянием без ключа — вкл", () => {
    localStorage.clear();
    expect(getPetEnabled()).toBe(true);
    localStorage.setItem("pundoku.locale", "uk"); // «старое» состояние: язык есть, питомца никто не трогал
    expect(getPetEnabled()).toBe(true);
  });

  it("прежний формат «1» (включал до PD-297) — вкл без миграции", () => {
    localStorage.setItem(PET_KEY, "1");
    expect(getPetEnabled()).toBe(true);
  });

  it("явный выкл — «0» и уважается; вкл снова удаляет ключ", () => {
    setPetEnabled(false);
    expect(localStorage.getItem(PET_KEY)).toBe("0");
    expect(getPetEnabled()).toBe(false);
    setPetEnabled(true);
    expect(localStorage.getItem(PET_KEY)).toBeNull();
    expect(getPetEnabled()).toBe(true);
  });

  it("localStorage недоступен: значение живёт в памяти", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    setPetEnabled(false);
    expect(getPetEnabled()).toBe(false);
    setPetEnabled(true);
    expect(getPetEnabled()).toBe(true);
  });
});
