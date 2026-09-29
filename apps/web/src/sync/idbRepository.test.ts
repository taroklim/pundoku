import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { progressOf } from "./fixtures";
import { IndexedDbProgressRepository, LazyProgressRepository } from "./idbRepository";
import { InMemoryProgressRepository } from "../today/repository";
import { summary } from "@pundoku/engine";

const fresh = () => new IDBFactory();

describe("IndexedDbProgressRepository", () => {
  it("день: сохранение и чтение целиком — MoveLog, заметки, значения, таймер; переживает переоткрытие базы", async () => {
    const factory = fresh();
    const repo = await IndexedDbProgressRepository.open(factory);
    const p = progressOf("2026-09-29", { withFix: true });
    await repo.saveDay(p);
    repo.close();

    const again = await IndexedDbProgressRepository.open(factory);
    const back = (await again.getDay("2026-09-29"))!;
    expect(back).toEqual(p);
    expect(summary(back.play.log)).toEqual(summary(p.play.log));
    expect(await again.getDay("2026-01-01")).toBeNull();
  });

  it("день с заметками и незавершённой партией: таймер и заметки на месте", async () => {
    const repo = await IndexedDbProgressRepository.open(fresh());
    const p = progressOf("2026-09-29", { solved: false, moves: 12 });
    const withNotes = { ...p, elapsedMs: 123_456, play: { ...p.play, notes: p.play.notes.map((_, i) => (i === 3 ? 0b1010 : 0)) } };
    await repo.saveDay(withNotes);
    const back = (await repo.getDay("2026-09-29"))!;
    expect(back.elapsedMs).toBe(123_456);
    expect(back.play.notes[3]).toBe(0b1010);
    expect(back.solved).toBe(false);
  });

  it("saveDay перезаписывает день; listDays возвращает все дни", async () => {
    const repo = await IndexedDbProgressRepository.open(fresh());
    await repo.saveDay(progressOf("2026-09-28", { solved: false, moves: 3 }));
    await repo.saveDay(progressOf("2026-09-28"));
    await repo.saveDay(progressOf("2026-09-29"));
    const days = await repo.listDays();
    expect(days.map((d) => d.date).sort()).toEqual(["2026-09-28", "2026-09-29"]);
    expect((await repo.getDay("2026-09-28"))!.solved).toBe(true);
  });

  it("состояние Grid ∞: installSeed, счётчики, улёты", async () => {
    const factory = fresh();
    const repo = await IndexedDbProgressRepository.open(factory);
    expect(await repo.getPermanent()).toBeNull();
    const state = { installSeed: "inf-abc", index: 2, cells: [{ cell: 40, date: "2026-09-28" }, { cell: 41, date: "2026-09-29" }] };
    await repo.savePermanent(state);
    repo.close();
    expect(await (await IndexedDbProgressRepository.open(factory)).getPermanent()).toEqual(state);
  });

  it("meta: токен устройства и состояние синхронизации; setMetaIfAbsent не затирает существующее", async () => {
    const repo = await IndexedDbProgressRepository.open(fresh());
    expect(await repo.getMeta("deviceToken")).toBeNull();
    expect(await repo.setMetaIfAbsent("deviceToken", "first")).toBe("first");
    expect(await repo.setMetaIfAbsent("deviceToken", "second")).toBe("first");
    expect(await repo.getMeta("deviceToken")).toBe("first");
    await repo.setMeta("deviceToken", null);
    expect(await repo.setMetaIfAbsent("deviceToken", "third")).toBe("third");
  });

  it("параллельная запись двух токенов (две вкладки): побеждает один", async () => {
    const factory = fresh();
    const [a, b] = await Promise.all([IndexedDbProgressRepository.open(factory), IndexedDbProgressRepository.open(factory)]);
    const [x, y] = await Promise.all([a.setMetaIfAbsent("deviceToken", "tab-a"), b.setMetaIfAbsent("deviceToken", "tab-b")]);
    expect(x).toBe(y);
  });

  it("токен и прогресс — в одной базе: очистка базы уносит и то и другое (ограничение до PD-27)", async () => {
    const factory = fresh();
    const repo = await IndexedDbProgressRepository.open(factory);
    await repo.setMeta("deviceToken", "t");
    await repo.saveDay(progressOf("2026-09-29"));
    repo.close();
    await new Promise<void>((resolve, reject) => {
      const del = factory.deleteDatabase("pundoku");
      del.onsuccess = () => resolve();
      del.onerror = () => reject(del.error);
    });
    const empty = await IndexedDbProgressRepository.open(factory);
    expect(await empty.getMeta("deviceToken")).toBeNull();
    expect(await empty.listDays()).toEqual([]);
  });

  it("IndexedDB недоступна → open отклоняется", async () => {
    await expect(IndexedDbProgressRepository.open(undefined as never, "x")).rejects.toThrow();
  });
});

describe("LazyProgressRepository", () => {
  it("операции ждут открытия базы, затем идут в неё", async () => {
    const lazy = new LazyProgressRepository(() => IndexedDbProgressRepository.open(fresh()));
    await lazy.saveDay(progressOf("2026-09-29"));
    expect((await lazy.getDay("2026-09-29"))!.solved).toBe(true);
    expect(await lazy.backend()).toBeInstanceOf(IndexedDbProgressRepository);
  });

  it("база не открылась → деградация в память, игра продолжает работать", async () => {
    const onFallback = vi.fn();
    const lazy = new LazyProgressRepository(() => Promise.reject(new Error("blocked")), onFallback);
    await lazy.saveDay(progressOf("2026-09-29"));
    expect((await lazy.getDay("2026-09-29"))!.date).toBe("2026-09-29");
    expect(onFallback).toHaveBeenCalledOnce();
    expect(await lazy.backend()).toBeInstanceOf(InMemoryProgressRepository);
  });
});
