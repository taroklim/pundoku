// @vitest-environment jsdom
/**
 * PD-116: партия Play переживает перезагрузку/вытеснение PWA — пишется локально (IndexedDB `kv`, без `days`),
 * восстанавливается при старте со всем: поле, заметки, undo-стек и лог, таймер, ink, сложность.
 * PD-144: после перезагрузки всегда хаб; «Начать» (`startNew`/`newGame`) стирает запись, возврат на хаб (`toHub`) — нет;
 * решённая запись удаляется. PD-167: слот на каждый режим (`meta:playGame:<режим>`), после перезагрузки незавершённая игра —
 * строка режима на хабе (`slots()`), `open(режим)` поднимает её на доску. Формат записи — `SavedPlay` v1 (+ `mode`).
 */
import { describe, expect, it } from "vitest";
import { progressOf } from "../sync/fixtures";
import { InMemoryProgressRepository } from "../today/repository";
import { PLAY_META_KEY, PlayStore, parseSavedPlay, slotKey } from "./store";

const CLASSIC = slotKey("classic");

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

interface Inner {
  beginGame(p: { mission: string; solution: string }): void;
  elapsedBase: number;
}
const inner = (s: PlayStore) => s as unknown as Inner;

/** Игра как после «Start»: новая партия в стор, без Worker. */
function started(repo: InMemoryProgressRepository, patch: { ink?: boolean; difficulty?: "hard" } = {}): PlayStore {
  const s = new PlayStore({ storage: repo });
  // как `start()` без генератора: выход с хаба + новая партия
  (s as unknown as { snap: Record<string, unknown> }).snap = { ...s.getSnapshot(), hub: false, restoring: false, difficulty: patch.difficulty ?? "medium", mode: patch.ink ? "ink" : "classic" };
  inner(s).beginGame({ mission: MISSION, solution: SOLUTION });
  if (patch.ink) s.setInk(true);
  return s;
}

const restored = async (repo: InMemoryProgressRepository): Promise<PlayStore> => {
  const s = new PlayStore({ storage: repo });
  await s.restore();
  return s;
};

/** Перезагрузка + тап по строке режима на хабе: незавершённая игра поднимается на доску, затем — обратно на хаб (пауза). */
const reopened = async (repo: InMemoryProgressRepository, mode: "classic" | "ink" = "classic"): Promise<PlayStore> => {
  const s = await restored(repo);
  expect(s.open(mode)).toBe(true);
  s.toHub();
  return s;
};

describe("PD-116: сохранение и восстановление партии Play", () => {
  it("без записи — пустой хаб; restoring снимается", async () => {
    const s = await restored(new InMemoryProgressRepository());
    expect(s.getSnapshot().restoring).toBe(false);
    expect(s.getSnapshot().hub).toBe(true);
    expect(s.hasSlot()).toBe(false);
    expect(s.slots()).toEqual({});
    expect(s.getSnapshot().phase).toBe("loading");
  });

  it("до окончания чтения экран знает, что идёт восстановление (хаб не мигает пустым при живом слоте)", () => {
    const s = new PlayStore({ storage: new InMemoryProgressRepository() });
    expect(s.getSnapshot().restoring).toBe(true);
    expect(new PlayStore().getSnapshot().restoring).toBe(false); // без хранилища восстанавливать нечего
  });

  it("поле, заметки, undo-стек, лог, таймер, сложность, выбор и режим заметок переживают «перезагрузку»", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo, { difficulty: "hard" });
    a.select(2);
    a.input(4); // верная цифра в клетке 2
    a.select(3);
    a.toggleNotesMode();
    a.input(6);
    a.input(9); // две заметки в клетке 3
    a.select(7);
    a.input(1); // неверная цифра
    inner(a).elapsedBase = 83_000;
    a.undo(); // откатываем неверную: в логе place+undo
    await flush();
    const before = a.getSnapshot();

    const b = await restored(repo);
    expect(b.getSnapshot().restoring).toBe(false);
    expect(b.getSnapshot().hub).toBe(true); // после перезагрузки — хаб, партия — строка своего режима
    expect(b.slots().classic).toMatchObject({ difficulty: "hard", left: 50 });
    expect(b.slots().ink).toBeUndefined();
    expect(b.open("classic")).toBe(true);
    b.toHub();
    const after = b.getSnapshot();
    expect(b.hasSlot()).toBe(true);
    expect(after.phase).toBe("playing");
    expect(after.difficulty).toBe("hard");
    expect(after.mode).toBe("classic");
    expect(after.play).toEqual(before.play);
    expect(after.play!.values[2]).toBe(4);
    expect(after.play!.notes[3]).toBe((1 << 6) | (1 << 9));
    expect(after.play!.undoStack).toHaveLength(before.play!.undoStack.length);
    expect(after.play!.log.map((m) => m.kind)).toEqual(before.play!.log.map((m) => m.kind));
    expect(after.startedOn.getTime()).toBe(before.startedOn.getTime());
    expect(after.notesMode).toBe(true);
    expect(after.selected).toBe(before.selected);
    // таймер на хабе стоит на накопленном (≥ 83 с, а не с нуля)
    const held = b.getElapsedMs();
    expect(held).toBeGreaterThanOrEqual(83_000);
    expect(b.getElapsedMs()).toBe(held);
    // строка режима открывает доску, игра продолжается: undo из восстановленного стека работает
    b.resume();
    expect(b.getSnapshot().hub).toBe(false);
    b.undo();
    expect(b.getSnapshot().play!.log.at(-1)!.kind).toBe("undo");
  });

  it("PD-147: курсор на заполненной клетке после перезагрузки уходит на первую пустую; на пустой — остаётся", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    a.select(2);
    a.input(4); // клетка 2 заполнена, курсор остаётся на ней
    await flush();
    const b = await reopened(repo);
    expect(b.getSnapshot().selected).toBe(3); // первая пустая, а не заполненная клетка 2

    const c2 = new InMemoryProgressRepository();
    const c = started(c2);
    c.select(40); // пустая клетка
    c.toggleNotesMode();
    c.input(1);
    await flush();
    const d = await reopened(c2);
    expect(d.getSnapshot().selected).toBe(40);
  });

  it("предвыбор шита: последняя выбранная сложность режима → сложность его незавершённой игры → по умолчанию; режимы независимы", async () => {
    const repo = new InMemoryProgressRepository();
    started(repo, { difficulty: "hard" });
    await flush();

    const b = new PlayStore({ storage: repo });
    b.setPick("classic", "expert"); // выбор в шите до окончания чтения слотов
    await b.restore();
    expect(b.pickFor("classic")).toBe("expert");
    expect(b.slots().classic!.difficulty).toBe("hard"); // слот — своя сложность

    const c = await restored(repo);
    expect(c.pickFor("classic")).toBe("hard"); // нет выбора — сложность незавершённой игры режима
    expect(c.pickFor("ink")).toBe("medium"); // у Чернил игры нет — по умолчанию
    c.setPick("ink", "easy");
    expect(c.pickFor("ink")).toBe("easy");
    expect(c.pickFor("classic")).toBe("hard");
  });

  it("PD-119: заметки, автоочистка и Fill переживают перезагрузку; Undo из восстановленного стека откатывает ход вместе с очисткой", async () => {
    localStorage.clear();
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    a.toggleNotesMode();
    a.select(3);
    a.input(4); // заметка 4 в клетке 3 (строка клетки 2)
    a.toggleNotesMode();
    a.select(2);
    a.input(4); // автоочистка: у клетки 3 заметка 4 ушла
    expect(a.getSnapshot().play!.notes[3]).toBe(0);
    a.fillCandidates();
    await flush();
    const before = a.getSnapshot().play!;

    const b = await reopened(repo);
    b.resume();
    expect(b.getSnapshot().play).toEqual(before);
    expect(b.getSnapshot().play!.notes[3]).not.toBe(0); // Fill записал кандидатов в клетку 3
    b.undo(); // откат Fill: заметки как после автоочистки
    expect(b.getSnapshot().play!.notes[3]).toBe(0);
    b.undo(); // откат хода: цифра ушла, у соседа вернулась ручная заметка 4
    expect(b.getSnapshot().play!.values[2]).toBe(0);
    expect(b.getSnapshot().play!.notes[3]).toBe(1 << 4);
  });

  it("Ink переживает перезагрузку: режим, клякса и блокировка клеток", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo, { ink: true });
    a.select(2);
    a.input(1); // клякса (верная 4 вписывается сама)
    await flush();
    expect(await repo.getMeta(CLASSIC)).toBeNull(); // Чернила — в своём слоте
    const b = await reopened(repo, "ink");
    expect(b.getSnapshot().mode).toBe("ink");
    b.resume();
    const p = b.getSnapshot().play!;
    expect(p.ink).toBe(true);
    expect(p.values[2]).toBe(4);
    expect(p.log.some((m) => m.blot === true)).toBe(true);
    b.select(2);
    b.input(5);
    expect(b.getSnapshot().play!.values[2]).toBe(4); // клетка заперта и после перезагрузки
  });

  it("партия без единого хода тоже восстанавливается (включая выбранный Ink)", async () => {
    const repo = new InMemoryProgressRepository();
    started(repo, { ink: true });
    await flush();
    const b = await reopened(repo, "ink");
    expect(b.getSnapshot().play!.log).toHaveLength(0);
    expect(b.getSnapshot().play!.ink).toBe(true);
  });

  it("возврат на хаб из партии НЕ стирает запись; «Начать» (newGame) стирает: перезагрузка не воскрешает отброшенную", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    a.select(2);
    a.input(4);
    await flush();
    expect(await repo.getMeta(CLASSIC)).not.toBeNull();
    a.toHub();
    await flush();
    expect(a.getSnapshot().hub).toBe(true);
    expect(a.hasSlot()).toBe(true);
    expect(await repo.getMeta(CLASSIC)).not.toBeNull(); // слот жив
    expect((await restored(repo)).slots().classic).toBeDefined();
    a.startNew("classic", "easy"); // «Начать новую» в шите режима
    await flush();
    expect(await repo.getMeta(CLASSIC)).toBeNull();
    const b = await restored(repo);
    expect(b.getSnapshot().hub).toBe(true);
    expect(b.getSnapshot().play).toBeNull();
    expect(b.slots()).toEqual({});
    a.toHub(); // идёт генерация: возврат на хаб отменяет её, слота нет
    expect(a.getSnapshot().hub).toBe(true);
    expect(a.getSnapshot().phase).toBe("loading");
    expect(a.hasSlot()).toBe(false);
  });

  it("решённая своя сетка исчезает после перезагрузки: хаб без слота, запись удалена", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    for (let i = 0; i < 81; i++) {
      if (MISSION[i] !== "0") continue;
      a.select(i);
      a.input(Number(SOLUTION[i]));
    }
    expect(a.getSnapshot().phase).toBe("solved");
    expect(a.hasSlot()).toBe(false); // решённая слотом не бывает
    await flush();
    expect(await repo.getMeta(CLASSIC)).toMatchObject({ v: 1, mode: "classic" });
    expect(a.slots()).toEqual({});
    const b = await restored(repo);
    await flush();
    expect(b.getSnapshot().hub).toBe(true);
    expect(b.getSnapshot().play).toBeNull();
    expect(b.slots()).toEqual({});
    expect(await repo.getMeta(CLASSIC)).toBeNull();
  });

  it("МИГРАЦИЯ: запись формата до PD-144 (v1 без hints/assisted, без mode) в старом ключе читается и становится слотом Классики", async () => {
    const src = new InMemoryProgressRepository();
    const a = started(src, { difficulty: "hard" });
    a.select(2);
    a.input(4);
    await flush();
    const raw = { ...((await src.getMeta(CLASSIC)) as Record<string, unknown>) };
    delete raw.hints; // старые записи этих полей не знали
    delete raw.assisted;
    delete raw.mode;
    expect(raw.v).toBe(1);
    const old = new InMemoryProgressRepository();
    await old.setMeta(PLAY_META_KEY, raw);
    const b = await restored(old);
    expect(b.slots().classic).toMatchObject({ difficulty: "hard", left: 50 });
    expect(b.open("classic")).toBe(true);
    expect(b.getSnapshot().play!.values[2]).toBe(4);
    expect(b.getSnapshot().difficulty).toBe("hard");
    expect(b.getSnapshot().hints ?? 0).toBe(0);
    expect(b.getSnapshot().assisted).not.toBe(true);
    await b.flushed();
    expect(await old.getMeta(PLAY_META_KEY)).toBeNull(); // старый ключ убран только после записи нового
    expect(await old.getMeta(CLASSIC)).toMatchObject({ v: 1, mode: "classic", difficulty: "hard" });
  });

  it("слот своей сетки не трогает слот дня: запись `days` байт в байт прежняя после всех переходов хаба", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.saveDay(progressOf("2026-10-03", { solved: false, moves: 5 }));
    const before = JSON.stringify(await repo.listDays());
    expect(before).not.toBe("[]");
    const a = started(repo);
    a.select(2);
    a.input(4);
    a.toHub();
    a.resume();
    a.toHub();
    a.startNew("ink", "easy");
    a.toHub();
    a.open("classic");
    a.toHub();
    await flush();
    expect(JSON.stringify(await repo.listDays())).toBe(before);
  });

  it("запись Play лежит в meta, а не в days: в снапшот синхронизации (listDays) и в Year не попадает", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    a.select(2);
    a.input(4);
    await flush();
    expect(await repo.listDays()).toEqual([]);
    expect(await repo.getMeta(CLASSIC)).toMatchObject({ v: 1, difficulty: "medium" });
  });

  it("выбор клетки и отклик на отказ — не прогресс: записи не плодят", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    await flush();
    let writes = 0;
    const orig = repo.setMeta.bind(repo);
    repo.setMeta = async (k, v) => {
      writes++;
      return orig(k, v);
    };
    a.select(7);
    a.select(2);
    a.select(null);
    a.input(5); // нет выбранной клетки: отклик
    await flush();
    expect(writes).toBe(0);
    a.select(2);
    a.input(4);
    await flush();
    expect(writes).toBe(1);
  });

  it("битая/чужая запись не роняет старт: пустой хаб", async () => {
    for (const junk of ["x", 42, { v: 2 }, { v: 1, play: {} }, { v: 1, difficulty: "nope" }]) {
      const repo = new InMemoryProgressRepository();
      await repo.setMeta(PLAY_META_KEY, junk);
      await repo.setMeta(CLASSIC, junk);
      await repo.setMeta(slotKey("ink"), junk);
      const s = await restored(repo);
      expect(s.slots()).toEqual({});
      expect(s.getSnapshot().hub).toBe(true);
      expect(s.hasSlot()).toBe(false);
      expect(s.getSnapshot().restoring).toBe(false);
    }
  });

  it("parseSavedPlay: принимает целую запись, отвергает усечённые массивы и плохое время", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    a.select(2);
    a.input(4);
    await flush();
    const raw = (await repo.getMeta(CLASSIC)) as Record<string, unknown>;
    expect(parseSavedPlay(raw)).not.toBeNull();
    expect(parseSavedPlay({ ...raw, mode: "melody" })).toBeNull(); // режим, которого эта версия не знает, не подменяется Классикой
    expect(parseSavedPlay({ ...raw, mode: "liar" })).toBeNull(); // PD-171: партия Лжеца без секрета — порча записи
    expect(parseSavedPlay({ ...raw, mode: undefined, play: { ...(raw.play as object), ink: true } })!.mode).toBe("ink");
    expect(parseSavedPlay({ ...raw, mode: "classic" }, "ink")!.mode).toBe("ink"); // ключ слота главнее поля
    expect(parseSavedPlay({ ...raw, elapsedMs: -1 })).toBeNull();
    expect(parseSavedPlay({ ...raw, startedOn: "never" })).toBeNull();
    expect(parseSavedPlay({ ...raw, play: { ...(raw.play as object), values: [1, 2, 3] } })).toBeNull();
  });
});
