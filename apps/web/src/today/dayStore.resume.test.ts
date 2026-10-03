// @vitest-environment jsdom
/**
 * PD-147 (c): после возврата в начатый день (перезагрузка) выбрана ПЕРВАЯ ПУСТАЯ клетка, а не первая незаданная (она у начатой
 * партии уже заполнена, и первый ход стоил двух касаний). Нет пустых — нет выбора. PD-115: повторное касание той же цифры не стирает.
 */
import { dailyPuzzle } from "@pundoku/engine";
import { describe, expect, it, vi } from "vitest";
import type { DayDeps } from "./dayStore";
import { DayStore } from "./dayStore";
import type { FetchedDay } from "./dayResolver";
import { InMemoryProgressRepository } from "./repository";

const NOW = new Date(2026, 8, 29, 12, 0);
const down: FetchedDay = { ok: false, reason: "network" };

const make = (repo: InMemoryProgressRepository) => {
  const deps: DayDeps = {
    repo,
    fetchDay: vi.fn(async () => down),
    verify: vi.fn(async () => true),
    generateFallback: vi.fn(async (d, diff) => dailyPuzzle(d, diff)),
    now: () => NOW,
    isOnline: () => false,
    slowFetchMs: 50,
  };
  return new DayStore(deps);
};
const started = async (store: DayStore) => {
  void store.load();
  await vi.waitFor(() => expect(store.getSnapshot().phase).toBe("playing"));
};
const flush = () => new Promise<void>((r) => setTimeout(r, 20));
const emptyCells = (store: DayStore) => {
  const { play } = store.getSnapshot();
  return play!.mission.map((g, i) => (g === 0 && play!.values[i] === 0 ? i : -1)).filter((i) => i >= 0);
};

describe("PD-147 (c): выбор после возврата в начатый день", () => {
  it("начатая партия: выбрана первая пустая клетка, а не заполненная; следующий ход — одно касание", async () => {
    const repo = new InMemoryProgressRepository();
    const a = make(repo);
    await started(a);
    const empty = emptyCells(a);
    const sol = a.getSnapshot().play!.solution;
    for (const i of empty.slice(0, 5)) {
      a.select(i);
      a.input(sol[i]!);
    }
    await flush();

    const b = make(repo);
    await started(b);
    const s = b.getSnapshot();
    expect(s.selected).toBe(empty[5]);
    expect(s.play!.values[s.selected!]).toBe(0);
    // Ход без предварительного выбора клетки: цифра ложится в выбранную пустую.
    b.input(sol[empty[5]!]!);
    expect(b.getSnapshot().play!.values[empty[5]!]).toBe(sol[empty[5]!]);
  });

  it("новая партия (нет записи): первая пустая клетка, как раньше", async () => {
    const a = make(new InMemoryProgressRepository());
    await started(a);
    expect(a.getSnapshot().selected).toBe(emptyCells(a)[0]);
  });

  it("пустых нет (сетка заполнена, но не решена): выбора нет, ввод ничего не ломает", async () => {
    const repo = new InMemoryProgressRepository();
    const a = make(repo);
    await started(a);
    const sol = a.getSnapshot().play!.solution;
    const empty = emptyCells(a);
    const wrong = (d: number) => (d % 9) + 1;
    // Всё верно, кроме последней клетки — в ней неверная цифра: сетка полна, не решена.
    for (const i of empty.slice(0, -1)) {
      a.select(i);
      a.input(sol[i]!);
    }
    a.select(empty.at(-1)!);
    a.input(wrong(sol[empty.at(-1)!]!));
    await flush();
    expect(a.getSnapshot().play!.solved).toBe(false);

    const b = make(repo);
    await started(b);
    expect(b.getSnapshot().selected).toBeNull();
    const before = b.getSnapshot().play!.values.join("");
    expect(() => b.input(5)).not.toThrow();
    expect(b.getSnapshot().play!.values.join("")).toBe(before);
  });

  it("PD-115: повторное касание той же цифры в клетке не стирает её", async () => {
    const repo = new InMemoryProgressRepository();
    const a = make(repo);
    await started(a);
    const [first] = emptyCells(a);
    const d = a.getSnapshot().play!.solution[first!]!;
    a.select(first!);
    a.input(d);
    a.input(d);
    expect(a.getSnapshot().play!.values[first!]).toBe(d);
  });
});
