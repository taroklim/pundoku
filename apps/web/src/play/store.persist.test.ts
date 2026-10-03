// @vitest-environment jsdom
/**
 * PD-116: партия Play переживает перезагрузку/вытеснение PWA — пишется локально (IndexedDB `kv`, без `days`),
 * восстанавливается при старте со всем: поле, заметки, undo-стек и лог, таймер, ink, сложность.
 * PD-144: после перезагрузки всегда хаб, незавершённая партия — слот «Продолжить» (`resume()` открывает доску);
 * «Начать» (`start`/`newGame`) стирает запись, возврат на хаб из партии (`toHub`) — нет; решённая запись удаляется.
 * Формат записи (`SavedPlay` v1, `hints`/`assisted` опциональны) не менялся — старые сохранения читаются как есть.
 */
import { describe, expect, it } from "vitest";
import { progressOf } from "../sync/fixtures";
import { InMemoryProgressRepository } from "../today/repository";
import { PLAY_META_KEY, PlayStore, parseSavedPlay } from "./store";

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
  (s as unknown as { snap: Record<string, unknown> }).snap = { ...s.getSnapshot(), hub: false, restoring: false, difficulty: patch.difficulty ?? "medium" };
  inner(s).beginGame({ mission: MISSION, solution: SOLUTION });
  if (patch.ink) s.setInk(true);
  return s;
}

const restored = async (repo: InMemoryProgressRepository): Promise<PlayStore> => {
  const s = new PlayStore({ storage: repo });
  await s.restore();
  return s;
};

describe("PD-116: сохранение и восстановление партии Play", () => {
  it("без записи — пустой хаб; restoring снимается", async () => {
    const s = await restored(new InMemoryProgressRepository());
    expect(s.getSnapshot().restoring).toBe(false);
    expect(s.getSnapshot().hub).toBe(true);
    expect(s.hasSlot()).toBe(false);
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
    const after = b.getSnapshot();
    expect(after.restoring).toBe(false);
    expect(after.hub).toBe(true); // после перезагрузки — хаб, партия в слоте «Продолжить»
    expect(b.hasSlot()).toBe(true);
    expect(after.phase).toBe("playing");
    expect(after.difficulty).toBe("hard");
    expect(after.pick).toBe("hard");
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
    // «Продолжить» открывает доску, игра продолжается: undo из восстановленного стека работает
    b.resume();
    expect(b.getSnapshot().hub).toBe(false);
    b.undo();
    expect(b.getSnapshot().play!.log.at(-1)!.kind).toBe("undo");
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

    const b = await restored(repo);
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
    const b = await restored(repo);
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
    const b = await restored(repo);
    expect(b.getSnapshot().play!.log).toHaveLength(0);
    expect(b.getSnapshot().play!.ink).toBe(true);
  });

  it("возврат на хаб из партии НЕ стирает запись; «Начать» (newGame) стирает: перезагрузка не воскрешает отброшенную", async () => {
    const repo = new InMemoryProgressRepository();
    const a = started(repo);
    a.select(2);
    a.input(4);
    await flush();
    expect(await repo.getMeta(PLAY_META_KEY)).not.toBeNull();
    a.toHub();
    await flush();
    expect(a.getSnapshot().hub).toBe(true);
    expect(a.hasSlot()).toBe(true);
    expect(await repo.getMeta(PLAY_META_KEY)).not.toBeNull(); // слот жив
    expect((await restored(repo)).hasSlot()).toBe(true);
    a.newGame("easy", false); // «Начать» после подтверждения «Отбросить»
    await flush();
    expect(await repo.getMeta(PLAY_META_KEY)).toBeNull();
    const b = await restored(repo);
    expect(b.getSnapshot().hub).toBe(true);
    expect(b.getSnapshot().play).toBeNull();
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
    expect(await repo.getMeta(PLAY_META_KEY)).toMatchObject({ v: 1 });
    const b = await restored(repo);
    await flush();
    expect(b.getSnapshot().hub).toBe(true);
    expect(b.getSnapshot().play).toBeNull();
    expect(b.hasSlot()).toBe(false);
    expect(await repo.getMeta(PLAY_META_KEY)).toBeNull();
  });

  it("МИГРАЦИЯ: запись формата до PD-144 (v1 без hints/assisted) читается как есть и становится слотом хаба", async () => {
    const src = new InMemoryProgressRepository();
    const a = started(src, { difficulty: "hard" });
    a.select(2);
    a.input(4);
    await flush();
    const raw = { ...((await src.getMeta(PLAY_META_KEY)) as Record<string, unknown>) };
    delete raw.hints; // старые записи этих полей не знали
    delete raw.assisted;
    expect(raw.v).toBe(1);
    const old = new InMemoryProgressRepository();
    await old.setMeta(PLAY_META_KEY, raw);
    const b = await restored(old);
    expect(b.hasSlot()).toBe(true);
    expect(b.getSnapshot().hub).toBe(true);
    expect(b.getSnapshot().play!.values[2]).toBe(4);
    expect(b.getSnapshot().difficulty).toBe("hard");
    expect(b.getSnapshot().hints ?? 0).toBe(0);
    expect(b.getSnapshot().assisted).not.toBe(true);
    // формат записи после PD-144 прежний (тот же ключ и версия): партию читает и сборка до PD-144
    b.resume();
    b.select(3);
    b.input(6);
    await flush();
    expect(await old.getMeta(PLAY_META_KEY)).toMatchObject({ v: 1, difficulty: "hard" });
    expect(parseSavedPlay(await old.getMeta(PLAY_META_KEY))).not.toBeNull();
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
    a.newGame("easy", false);
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
    expect(await repo.getMeta(PLAY_META_KEY)).toMatchObject({ v: 1, difficulty: "medium" });
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
      const s = await restored(repo);
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
    const raw = (await repo.getMeta(PLAY_META_KEY)) as Record<string, unknown>;
    expect(parseSavedPlay(raw)).not.toBeNull();
    expect(parseSavedPlay({ ...raw, elapsedMs: -1 })).toBeNull();
    expect(parseSavedPlay({ ...raw, startedOn: "never" })).toBeNull();
    expect(parseSavedPlay({ ...raw, play: { ...(raw.play as object), values: [1, 2, 3] } })).toBeNull();
  });
});
