import { describe, expect, it } from "vitest";
import { hashOf, parseHash, parseRoute } from "./tabs";

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
