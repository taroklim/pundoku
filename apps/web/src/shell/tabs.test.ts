// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import { hashOf, leaveSettings, parseHash, parseRoute } from "./tabs";

describe("маршруты вкладок и архива (PD-33)", () => {
  it("вкладки как раньше; мусор → Today", () => {
    expect(parseHash("#/year")).toBe("year");
    expect(parseHash("#/play")).toBe("play");
    expect(parseHash("")).toBe("today");
    expect(parseHash("#/nope")).toBe("today");
    expect(parseRoute("#/play")).toEqual({ tab: "play", archiveDate: null, yearDate: null });
  });

  it("#/day/YYYY-MM-DD — архив, вкладка Year подсвечена", () => {
    expect(parseRoute("#/day/2026-09-20")).toEqual({ tab: "year", archiveDate: "2026-09-20", yearDate: null });
    expect(parseHash("#/day/2026-09-20")).toBe("year");
  });

  it("#/year/YYYY-MM-DD — Year на карточке дня", () => {
    expect(parseRoute("#/year/2026-09-20")).toEqual({ tab: "year", archiveDate: null, yearDate: "2026-09-20" });
  });

  it("кривые даты не открывают архив", () => {
    expect(parseRoute("#/day/junk")).toEqual({ tab: "today", archiveDate: null, yearDate: null });
    expect(parseRoute("#/day")).toEqual({ tab: "today", archiveDate: null, yearDate: null });
    expect(parseRoute("#/year/2026-9-1")).toEqual({ tab: "year", archiveDate: null, yearDate: null });
  });

  it("hashOf и parseRoute взаимно обратны", () => {
    expect(hashOf({ tab: "play" })).toBe("#/play");
    expect(parseRoute(hashOf({ archive: "2026-09-20" })).archiveDate).toBe("2026-09-20");
    expect(parseRoute(hashOf({ yearDay: "2026-09-20" })).yearDate).toBe("2026-09-20");
  });
});

describe("маршрут #/settings (PD-49)", () => {
  it("push-экран внутри Today: вкладка Today подсвечена, метка settings", () => {
    expect(parseRoute("#/settings")).toEqual({ tab: "today", archiveDate: null, yearDate: null, settings: true });
    expect(parseHash("#/settings")).toBe("today");
    expect(hashOf({ settings: true })).toBe("#/settings");
    expect(parseRoute(hashOf({ settings: true })).settings).toBe(true);
  });

  it("у остальных адресов метки settings нет", () => {
    expect(parseRoute("#/today").settings).toBeUndefined();
    expect(parseRoute("#/day/2026-09-20").settings).toBeUndefined();
  });

  describe("возврат", () => {
    afterEach(() => vi.restoreAllMocks());

    it("запись в истории поставило приложение — history.back()", () => {
      vi.spyOn(window.history, "state", "get").mockReturnValue({ pdSettings: true });
      const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const go = vi.fn();
      leaveSettings(go);
      expect(back).toHaveBeenCalledTimes(1);
      expect(go).not.toHaveBeenCalled();
    });

    it("глубокая ссылка/перезагрузка (предыдущей записи нет) — replace на Today", () => {
      vi.spyOn(window.history, "state", "get").mockReturnValue(null);
      const back = vi.spyOn(window.history, "back").mockImplementation(() => {});
      const go = vi.fn();
      leaveSettings(go);
      expect(back).not.toHaveBeenCalled();
      expect(go).toHaveBeenCalledWith({ tab: "today" });
    });
  });
});
