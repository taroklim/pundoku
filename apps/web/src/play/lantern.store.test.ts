// @vitest-environment jsdom
/**
 * PD-208: слот хранилища режима Фонарь (`playGame:lantern`) и флаг `play.lantern: true` — по прецеденту Глифов/Мелодии. Партия
 * стартует с флагом и в темноте (без выбранной клетки), переживает перезагрузку (выбор восстанавливается), запись слота
 * разбирается строго (флаг только `true` и только у режима `lantern`); режимы не комбинируются.
 */
import { describe, expect, it } from "vitest";
import { InMemoryProgressRepository, dayProgressProblem } from "../today/repository";
import { createPlay, isLantern, setGlyphMode, setInkMode, setLanternMode, setMelodyMode } from "./logic";
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
function begin(s: PlayStore, mode: "classic" | "lantern", difficulty: "easy" | "medium" | "hard" = "medium"): void {
  s.startNew(mode, difficulty);
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: PUZZLE });
}
const move = (s: PlayStore, cell = 2, digit = 4) => {
  s.select(cell);
  s.input(digit);
};
const fresh = () => createPlay({ mission: MISSION, solution: SOLUTION });

describe("слот режима Фонарь", () => {
  it("партия стартует с флагом `lantern` и без выбора (свет пуст); Классика — с выбором и без флага", async () => {
    const s = new PlayStore({ storage: new InMemoryProgressRepository() });
    await s.restore();
    begin(s, "lantern");
    expect(s.getSnapshot().mode).toBe("lantern");
    expect(s.getSnapshot().play?.lantern).toBe(true);
    expect(s.getSnapshot().selected).toBeNull();
    s.toHub();
    begin(s, "classic");
    expect(s.getSnapshot().play?.lantern).toBeUndefined();
    expect(s.getSnapshot().selected).not.toBeNull();
  });

  it("цифра без выбора не ставится (отказ «выберите клетку»), после тапа — как обычно", async () => {
    const s = new PlayStore({ storage: new InMemoryProgressRepository() });
    await s.restore();
    begin(s, "lantern");
    s.input(4);
    expect(s.getSnapshot().play?.values[2]).toBe(0);
    move(s);
    expect(s.getSnapshot().play?.values[2]).toBe(4);
  });

  it("живёт в своём слоте рядом с Классикой и переживает перезагрузку; выбор восстанавливается", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "lantern", "hard");
    move(s);
    s.select(3); // пустая клетка — выбор переживает возврат (PD-147)
    s.toHub();
    begin(s, "classic", "easy");
    move(s);
    s.toHub();
    expect(Object.keys(s.slots()).sort()).toEqual(["classic", "lantern"]);
    await s.flushed();
    const rec = (await repo.getMeta(slotKey("lantern"))) as { mode: string; play: { lantern?: boolean } };
    expect(rec.mode).toBe("lantern");
    expect(rec.play.lantern).toBe(true);
    const t = new PlayStore({ storage: repo });
    await t.restore();
    expect(t.open("lantern")).toBe(true);
    expect(t.getSnapshot().play?.lantern).toBe(true);
    expect(t.getSnapshot().play?.values[2]).toBe(4);
    expect(t.getSnapshot().selected).toBe(3);
  });
});

describe("setLanternMode: режимы не комбинируются", () => {
  it("свежая партия получает флаг; начатая, решённая и партия другого режима — нет", () => {
    expect(isLantern(setLanternMode(fresh()))).toBe(true);
    expect(setLanternMode(setLanternMode(fresh()))).toEqual(setLanternMode(fresh()));
    expect(setLanternMode(setInkMode(fresh(), true)).lantern).toBeUndefined();
    expect(setLanternMode(setGlyphMode(fresh())).lantern).toBeUndefined();
    expect(setLanternMode(setMelodyMode(fresh())).lantern).toBeUndefined();
    expect(setLanternMode({ ...fresh(), solved: true }).lantern).toBeUndefined();
    const started = { ...fresh(), log: [{ t: 0, cell: 2, kind: "place" as const, digit: 4 as const }] };
    expect(setLanternMode(started).lantern).toBeUndefined();
  });
});

describe("разбор записи слота (PD-208)", () => {
  const base = (play: object, mode?: string) => ({
    v: 1,
    ...(mode ? { mode } : {}),
    difficulty: "easy",
    startedOn: "2026-10-06T10:00:00.000Z",
    play,
    elapsedMs: 1000,
    selected: null,
    notesMode: false,
  });

  it("флаг сохраняется; режим без флага получает флаг по слоту; запись без `mode` — режим из партии", () => {
    expect(parseSavedPlay(base({ ...fresh(), lantern: true }, "lantern"), "lantern")?.play.lantern).toBe(true);
    expect(parseSavedPlay(base(fresh(), "lantern"), "lantern")?.play.lantern).toBe(true);
    expect(parseSavedPlay(base({ ...fresh(), lantern: true }))?.mode).toBe("lantern");
  });

  it("флаг у партии другого режима или не `true` — запись не восстанавливается", () => {
    expect(parseSavedPlay(base({ ...fresh(), lantern: true }, "classic"), "classic")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), lantern: true }, "melody"), "melody")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), lantern: "yes" }, "lantern"), "lantern")).toBeNull();
    expect(parseSavedPlay(base({ ...fresh(), lantern: false }, "lantern"), "lantern")).toBeNull();
  });

  it("граница хранилища дня: `play.lantern` — только `true`", () => {
    const day = (play: object) => ({
      date: "2026-10-06",
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
    expect(dayProgressProblem(day({ ...fresh(), lantern: true }))).toBeNull();
    expect(dayProgressProblem(day({ ...fresh(), lantern: 1 }))).toBe("play.lantern");
  });
});
