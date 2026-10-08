// @vitest-environment jsdom
/**
 * PD-225 (design/pd224-swipe-gestures.md §A6): удаление незаконченной свободной партии режима с хаба (свайп строки, пункт
 * «Удалить сетку», кнопка «Удалить») и «Отменить» из тоста. Удаление пишется СРАЗУ (слот `meta:playGame:<режим>` → `null`);
 * «Отменить» записывает ту же запись обратно — байт в байт. Запаркованная живая партия того же режима сбрасывается тоже,
 * иначе тап по строке поднял бы удалённую. Не трогаются: выбор сложности (`picks`), другие слоты, Лжец дня, история поимок.
 */
import { describe, expect, it } from "vitest";
import { InMemoryProgressRepository } from "../today/repository";
import { liarDayKey } from "./savedPlay";
import { LIAR_HISTORY_KEY, PlayStore, slotKey } from "./store";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const PUZZLE = { mission: MISSION, solution: SOLUTION, difficulty: "easy" as const, seed: "t" };

interface Inner {
  requestId: number;
  onGenerated(id: number, r: unknown): void;
}
function begin(s: PlayStore, mode: "classic" | "ink", difficulty: "easy" | "medium" | "hard" = "medium"): void {
  s.startNew(mode, difficulty);
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: PUZZLE });
}
const move = (s: PlayStore, cell = 2, digit = 4) => {
  s.select(cell);
  s.input(digit);
};

/** Две незаконченные: Классика (запаркована в слоте) и Чернила (живая партия на хабе). */
async function twoGames() {
  const repo = new InMemoryProgressRepository();
  const s = new PlayStore({ storage: repo });
  await s.restore();
  begin(s, "classic", "hard");
  move(s);
  s.toHub();
  begin(s, "ink", "easy");
  move(s, 3, 6);
  s.toHub();
  await s.flushed();
  return { repo, s };
}

describe("PlayStore.discard — удалить незаконченную партию режима", () => {
  it("запаркованный слот: запись возвращается для отмены, слот в памяти и в IndexedDB — null, остальное цело", async () => {
    const { repo, s } = await twoGames();
    const before = JSON.stringify(await repo.getMeta(slotKey("classic")));
    const rec = s.discard("classic");
    expect(rec).not.toBeNull();
    expect(JSON.stringify(rec)).toBe(before);
    expect(s.slots().classic).toBeUndefined();
    expect(s.slots().ink).toBeDefined();
    expect(s.open("classic")).toBe(false); // экран откроет шит режима, а не удалённую партию
    await s.flushed();
    expect(await repo.getMeta(slotKey("classic"))).toBeNull();
    expect(await repo.getMeta(slotKey("ink"))).not.toBeNull();
    expect(s.getSnapshot().picks).toMatchObject({ classic: "hard", ink: "easy" }); // выбор сложности не трогаем
  });

  it("живая «запаркованная» партия того же режима (вышли на хаб тапом по вкладке) сбрасывается тоже (§A11 п. 9)", async () => {
    const { repo, s } = await twoGames();
    expect(s.getSnapshot()).toMatchObject({ mode: "ink", hub: true, phase: "playing" });
    const rec = s.discard("ink");
    expect(rec).toMatchObject({ mode: "ink", difficulty: "easy" });
    expect(s.hasSlot()).toBe(false);
    expect(s.getSnapshot()).toMatchObject({ hub: true, play: null });
    expect(s.slots().ink).toBeUndefined();
    expect(s.open("ink")).toBe(false);
    await s.flushed();
    expect(await repo.getMeta(slotKey("ink"))).toBeNull();
    // перезапуск приложения сразу после удаления (тост не дождались) — партии нет
    const next = new PlayStore({ storage: repo });
    await next.restore();
    expect(next.slots().ink).toBeUndefined();
    expect(next.slots().classic).toBeDefined();
  });

  it("с доски (не хаб), без партии, решённая — ничего не удаляет и возвращает null", async () => {
    const { repo, s } = await twoGames();
    expect(s.open("ink")).toBe(true);
    expect(s.discard("ink")).toBeNull();
    expect(s.getSnapshot().hub).toBe(false);
    expect(s.discard("melody")).toBeNull();
    s.toHub();
    await s.flushed();
    expect(await repo.getMeta(slotKey("ink"))).not.toBeNull();
  });

  it("подписчики узнают об удалении (хаб перерисует строку без партии)", async () => {
    const { s } = await twoGames();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.discard("classic");
    expect(calls).toBeGreaterThan(0);
    off();
  });

  it("Лжец дня и история поимок не трогаются удалением слота", async () => {
    const { repo, s } = await twoGames();
    const day = { marker: "liar-day" };
    await repo.setMeta(liarDayKey("2026-10-08"), day);
    await repo.setMeta(LIAR_HISTORY_KEY, [{ id: "x", catchPlacement: 3 }]);
    s.discard("classic");
    s.discard("ink");
    await s.flushed();
    expect(await repo.getMeta(liarDayKey("2026-10-08"))).toEqual(day);
    expect(await repo.getMeta(LIAR_HISTORY_KEY)).toEqual([{ id: "x", catchPlacement: 3 }]);
  });
});

describe("PlayStore.restoreSlot — «Отменить» в тосте", () => {
  it("запаркованный слот возвращается байт в байт (IndexedDB) и открывается той же партией", async () => {
    const { repo, s } = await twoGames();
    const before = JSON.stringify(await repo.getMeta(slotKey("classic")));
    const rec = s.discard("classic")!;
    await s.flushed();
    expect(s.restoreSlot(rec)).toBe(true);
    await s.flushed();
    expect(JSON.stringify(await repo.getMeta(slotKey("classic")))).toBe(before);
    expect(s.slots().classic).toMatchObject({ difficulty: "hard" });
    expect(s.open("classic")).toBe(true);
    expect(s.getSnapshot().play!.values[2]).toBe(4);
  });

  it("удалённая живая партия возвращается слотом: тап по строке поднимает её на доску с тем же прогрессом и временем", async () => {
    const { repo, s } = await twoGames();
    (s as unknown as { elapsedBase: number }).elapsedBase = 42_000;
    s.open("ink");
    s.toHub();
    await s.flushed();
    const before = JSON.stringify(await repo.getMeta(slotKey("ink")));
    const play = s.getSnapshot().play;
    const rec = s.discard("ink")!;
    expect(s.restoreSlot(rec)).toBe(true);
    await s.flushed();
    expect(JSON.stringify(await repo.getMeta(slotKey("ink")))).toBe(before);
    expect(s.open("ink")).toBe(true);
    expect(s.getSnapshot().play).toEqual(play);
    expect(s.getElapsedMs()).toBeGreaterThanOrEqual(42_000);
  });

  it("в режиме уже началась новая партия — отмена её не затирает (false)", async () => {
    const { repo, s } = await twoGames();
    const rec = s.discard("classic")!;
    begin(s, "classic", "easy");
    move(s, 3, 6);
    s.toHub();
    expect(s.restoreSlot(rec)).toBe(false);
    await s.flushed();
    expect(await repo.getMeta(slotKey("classic"))).toMatchObject({ difficulty: "easy" });
  });

  it("подписчики узнают о восстановлении", async () => {
    const { s } = await twoGames();
    const rec = s.discard("classic")!;
    let calls = 0;
    const off = s.subscribe(() => calls++);
    s.restoreSlot(rec);
    expect(calls).toBeGreaterThan(0);
    off();
  });
});
