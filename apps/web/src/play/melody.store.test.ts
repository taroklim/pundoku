// @vitest-environment jsdom
/**
 * PD-201: слот хранилища режима Мелодия (`playGame:melody`) и флаг `play.melody: true` — по прецеденту Глифов (PD-194). Строки
 * на хабе нет (`ready: false`, UI — PD-203), но слот уже живёт: партия стартует с флагом, переживает перезагрузку, запись
 * слота разбирается строго (флаг только `true` и только у режима `melody`).
 */
import { describe, expect, it } from "vitest";
import { InMemoryProgressRepository, dayProgressProblem } from "../today/repository";
import { createPlay } from "./logic";
import { parseSavedPlay } from "./savedPlay";
import { PlayStore, slotKey } from "./store";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const PUZZLE = { mission: MISSION, solution: SOLUTION, difficulty: "easy" as const, seed: "t" };

interface Inner {
  requestId: number;
  onGenerated(id: number, r: unknown): void;
}
function begin(s: PlayStore, mode: "classic" | "glyphs" | "melody", difficulty: "easy" | "medium" | "hard" = "medium"): void {
  s.startNew(mode, difficulty);
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: PUZZLE });
}
const move = (s: PlayStore, cell = 2, digit = 4) => {
  s.select(cell);
  s.input(digit);
};

describe("слот режима Мелодия", () => {
  it("партия режима стартует с флагом `melody`, живёт в своём слоте рядом с Классикой и переживает перезагрузку", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "melody", "hard");
    expect(s.getSnapshot().mode).toBe("melody");
    expect(s.getSnapshot().play?.melody).toBe(true);
    move(s);
    s.toHub();
    begin(s, "classic", "easy");
    expect(s.getSnapshot().play?.melody).toBeUndefined();
    move(s);
    s.toHub();
    expect(Object.keys(s.slots()).sort()).toEqual(["classic", "melody"]);
    await s.flushed();
    const rec = (await repo.getMeta(slotKey("melody"))) as { mode: string; play: { melody?: boolean } };
    expect(rec.mode).toBe("melody");
    expect(rec.play.melody).toBe(true);
    const t = new PlayStore({ storage: repo });
    await t.restore();
    expect(t.open("melody")).toBe(true);
    expect(t.getSnapshot().play?.melody).toBe(true);
    expect(t.getSnapshot().play?.values[2]).toBe(4);
  });
});

describe("разбор записи слота (PD-201)", () => {
  const base = (play: object, mode?: string) => ({
    v: 1,
    ...(mode ? { mode } : {}),
    difficulty: "easy",
    startedOn: "2026-10-05T10:00:00.000Z",
    play,
    elapsedMs: 1000,
    selected: null,
    notesMode: false,
  });
  const fresh = () => createPlay({ mission: MISSION, solution: SOLUTION });

  it("флаг сохраняется; режим без флага получает флаг по слоту; запись без `mode` — режим из партии", () => {
    expect(parseSavedPlay(base({ ...fresh(), melody: true }, "melody"), "melody")?.play.melody).toBe(true);
    expect(parseSavedPlay(base(fresh(), "melody"), "melody")?.play.melody).toBe(true);
    expect(parseSavedPlay(base({ ...fresh(), melody: true }))?.mode).toBe("melody");
  });

  it("флаг у партии другого режима или не `true` — запись не восстанавливается", () => {
    expect(parseSavedPlay(base({ ...fresh(), melody: true }, "classic"), "classic")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), melody: true }, "glyphs"), "glyphs")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), melody: "yes" }, "melody"), "melody")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), melody: false }, "melody"), "melody")).toBeNull();
  });

  it("граница хранилища дня: `play.melody` — только `true`", () => {
    const day = (play: object) => ({
      date: "2026-10-05",
      mission: MISSION,
      difficulty: "easy",
      source: "generator",
      winRate: null,
      play,
      elapsedMs: 0,
      solved: false,
      serverVerified: null,
      verification: "local",
      solvedAt: null,
      late: false,
      assisted: false,
    });
    expect(dayProgressProblem(day({ ...fresh(), melody: true }))).toBeNull();
    expect(dayProgressProblem(day({ ...fresh(), melody: 1 }))).toBe("play.melody");
  });
});
