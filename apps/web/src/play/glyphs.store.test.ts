// @vitest-environment jsdom
/**
 * PD-194: режим Глифы в хранилище Play — свой слот незавершённой игры (`playGame:glyphs`), флаг `play.glyphs: true` едет с
 * партией (слот, перезагрузка, парковка), Классика рядом не получает флага; запись слота разбирается строго (флаг — только
 * `true` и только у режима `glyphs`; партия режима без флага восстанавливается с флагом).
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
function begin(s: PlayStore, mode: "classic" | "glyphs", difficulty: "easy" | "medium" | "hard" = "medium"): void {
  s.startNew(mode, difficulty);
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: PUZZLE });
}
const move = (s: PlayStore, cell = 2, digit = 4) => {
  s.select(cell);
  s.input(digit);
};

describe("слот режима Глифы", () => {
  it("партия режима стартует с флагом `glyphs`; Классика — без; обе живут в своих слотах одновременно", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "glyphs", "hard");
    expect(s.getSnapshot().mode).toBe("glyphs");
    expect(s.getSnapshot().play?.glyphs).toBe(true);
    move(s);
    const glyphPlay = s.getSnapshot().play;
    s.toHub();
    begin(s, "classic", "easy");
    expect(s.getSnapshot().play?.glyphs).toBeUndefined();
    move(s);
    s.toHub();
    expect(Object.keys(s.slots()).sort()).toEqual(["classic", "glyphs"]);
    expect(s.slots().glyphs).toMatchObject({ difficulty: "hard" });
    expect(s.open("glyphs")).toBe(true);
    expect(s.getSnapshot()).toMatchObject({ hub: false, mode: "glyphs", difficulty: "hard" });
    expect(s.getSnapshot().play).toEqual(glyphPlay);
    await s.flushed();
    const rec = (await repo.getMeta(slotKey("glyphs"))) as { mode: string; play: { glyphs?: boolean } };
    expect(rec.mode).toBe("glyphs");
    expect(rec.play.glyphs).toBe(true);
    expect(((await repo.getMeta(slotKey("classic"))) as { play: { glyphs?: boolean } }).play.glyphs).toBeUndefined();
  });

  it("перезагрузка: слот Глифов восстанавливается строкой хаба, партия — с флагом", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "glyphs");
    move(s);
    s.toHub();
    await s.flushed();
    const t = new PlayStore({ storage: repo });
    await t.restore();
    expect(Object.keys(t.slots())).toEqual(["glyphs"]);
    expect(t.open("glyphs")).toBe(true);
    expect(t.getSnapshot().play?.glyphs).toBe(true);
    expect(t.getSnapshot().play?.values[2]).toBe(4);
  });

  it("«Начать» в Глифах затирает только слот Глифов", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "classic");
    move(s);
    s.toHub();
    begin(s, "glyphs");
    move(s);
    s.toHub();
    s.startNew("glyphs", "hard");
    expect(s.slots().glyphs).toBeUndefined();
    expect(s.slots().classic).toBeDefined();
  });
});

describe("разбор записи слота (PD-194)", () => {
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

  it("флаг сохраняется; режим без флага получает флаг по слоту", () => {
    expect(parseSavedPlay(base({ ...fresh(), glyphs: true }, "glyphs"), "glyphs")?.play.glyphs).toBe(true);
    expect(parseSavedPlay(base(fresh(), "glyphs"), "glyphs")?.play.glyphs).toBe(true);
    // Запись без `mode` с флагом (на всякий случай) — режим выводится из партии.
    expect(parseSavedPlay(base({ ...fresh(), glyphs: true }))?.mode).toBe("glyphs");
  });

  it("флаг у партии другого режима или не `true` — запись не восстанавливается", () => {
    expect(parseSavedPlay(base({ ...fresh(), glyphs: true }, "classic"), "classic")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), glyphs: "yes" }, "glyphs"), "glyphs")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), glyphs: false }, "glyphs"), "glyphs")).toBeNull();
  });

  it("граница хранилища дня: `play.glyphs` — только `true`", () => {
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
    expect(dayProgressProblem(day({ ...fresh(), glyphs: true }))).toBeNull();
    expect(dayProgressProblem(day({ ...fresh(), glyphs: 1 }))).toBe("play.glyphs");
  });
});
