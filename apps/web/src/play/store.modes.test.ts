// @vitest-environment jsdom
/**
 * PD-167: слот незавершённой игры на каждый режим. Игры режимов не уничтожают друг друга; «Начать» затирает только слот своего
 * режима; открытие режима паркует живую партию; миграция единственного слота до PD-167 без потери (Классика и Чернила),
 * идемпотентно и устойчиво к сбою записи.
 */
import { describe, expect, it } from "vitest";
import { InMemoryProgressRepository } from "../today/repository";
import { enterDigit } from "./logic";
import { PLAY_META_KEY, PlayStore, slotKey } from "./store";

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
const PUZZLE = { mission: MISSION, solution: SOLUTION, difficulty: "easy" as const, seed: "t" };

interface Inner {
  requestId: number;
  onGenerated(id: number, r: unknown): void;
}
/** `startNew` без Worker: сразу «генерация готова». */
function begin(s: PlayStore, mode: "classic" | "ink", difficulty: "easy" | "medium" | "hard" = "medium"): void {
  s.startNew(mode, difficulty);
  const i = s as unknown as Inner;
  i.onGenerated(i.requestId, { id: i.requestId, ok: true, puzzle: PUZZLE });
}
const move = (s: PlayStore, cell = 2, digit = 4) => {
  s.select(cell);
  s.input(digit);
};

describe("слот на режим", () => {
  it("Классика и Чернила живут одновременно; переход между ними паркует живую партию со всем прогрессом", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "classic", "hard");
    move(s);
    const classic = s.getSnapshot().play;
    s.toHub();
    begin(s, "ink", "easy");
    move(s, 3, 7); // неверная цифра в чернилах — клякса
    const ink = s.getSnapshot().play;
    s.toHub();
    expect(Object.keys(s.slots()).sort()).toEqual(["classic", "ink"]);
    expect(s.slots().classic).toMatchObject({ difficulty: "hard", ink: false });
    expect(s.slots().ink).toMatchObject({ difficulty: "easy", ink: true });

    expect(s.open("classic")).toBe(true);
    expect(s.getSnapshot()).toMatchObject({ hub: false, mode: "classic", difficulty: "hard" });
    expect(s.getSnapshot().play).toEqual(classic);
    s.toHub();
    expect(s.open("ink")).toBe(true);
    expect(s.getSnapshot().play).toEqual(ink);
    await s.flushed();
    expect(await repo.getMeta(slotKey("classic"))).toMatchObject({ mode: "classic", difficulty: "hard" });
    expect(await repo.getMeta(slotKey("ink"))).toMatchObject({ mode: "ink", difficulty: "easy" });
  });

  it("«Начать» в режиме затирает только его слот; другая игра цела; open() режима без игры — false", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    expect(s.open("ink")).toBe(false);
    begin(s, "classic");
    move(s);
    s.toHub();
    begin(s, "ink");
    move(s);
    s.toHub();
    s.startNew("ink", "hard"); // «Начать новую» в шите Чернил; генерация ещё идёт
    expect(s.slots().ink).toBeUndefined();
    expect(s.slots().classic).toBeDefined();
    await s.flushed();
    expect(await repo.getMeta(slotKey("ink"))).toBeNull();
    expect(await repo.getMeta(slotKey("classic"))).not.toBeNull();
    s.toHub(); // передумал во время генерации — пустой слот Чернил, Классика на месте
    expect(Object.keys(s.slots())).toEqual(["classic"]);
  });

  it("время партии сохраняется при парковке: таймер не идёт на хабе и продолжается с накопленного", async () => {
    const s = new PlayStore();
    begin(s, "classic");
    (s as unknown as { elapsedBase: number }).elapsedBase = 61_000;
    move(s);
    s.toHub();
    begin(s, "ink");
    s.toHub();
    expect(s.slots().classic!.elapsedMs).toBeGreaterThanOrEqual(61_000);
    s.open("classic");
    expect(s.getElapsedMs()).toBeGreaterThanOrEqual(61_000);
  });

  it("решённая партия режима — не слот; после ухода с карточки на хаб запись удалена", async () => {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, "classic");
    for (let i = 0; i < 81; i++) if (MISSION[i] === "0") move(s, i, Number(SOLUTION[i]));
    expect(s.getSnapshot().phase).toBe("solved");
    expect(s.slots()).toEqual({});
    s.toHub();
    await s.flushed();
    expect(await repo.getMeta(slotKey("classic"))).toBeNull();
  });
});

describe("миграция единственного слота до PD-167", () => {
  async function legacyRecord(ink: boolean): Promise<Record<string, unknown>> {
    const repo = new InMemoryProgressRepository();
    const s = new PlayStore({ storage: repo });
    await s.restore();
    begin(s, ink ? "ink" : "classic", "hard");
    move(s);
    await s.flushed();
    const rec = { ...((await repo.getMeta(slotKey(ink ? "ink" : "classic"))) as Record<string, unknown>) };
    delete rec.mode;
    return rec;
  }

  it("незавершённая чернильная — в слот Чернил; старый ключ удалён ПОСЛЕ записи нового; повторный старт ничего не меняет", async () => {
    const rec = await legacyRecord(true);
    const repo = new InMemoryProgressRepository();
    await repo.setMeta(PLAY_META_KEY, rec);
    const order: string[] = [];
    const orig = repo.setMeta.bind(repo);
    repo.setMeta = async (k, v) => {
      order.push(`${k}=${v === null ? "null" : "rec"}`);
      return orig(k, v);
    };
    const s = new PlayStore({ storage: repo });
    await s.restore();
    expect(s.slots().ink).toMatchObject({ difficulty: "hard", ink: true });
    expect(s.slots().classic).toBeUndefined();
    await s.flushed();
    expect(order).toEqual(["playGame:ink=rec", "playGame=null"]);
    expect(await repo.getMeta(PLAY_META_KEY)).toBeNull();
    const again = new PlayStore({ storage: repo });
    await again.restore();
    expect(again.slots().ink).toMatchObject({ difficulty: "hard" });
    expect(again.open("ink")).toBe(true);
    expect(again.getSnapshot().play!.values[2]).toBe(4);
  });

  it("сбой записи нового слота — старая запись НЕ удаляется (следующий старт доделает перенос)", async () => {
    const rec = await legacyRecord(false);
    const repo = new InMemoryProgressRepository();
    await repo.setMeta(PLAY_META_KEY, rec);
    const orig = repo.setMeta.bind(repo);
    repo.setMeta = async (k, v) => {
      if (k === slotKey("classic")) throw new Error("quota");
      return orig(k, v);
    };
    const s = new PlayStore({ storage: repo });
    await s.restore();
    expect(s.slots().classic).toBeDefined(); // в памяти игра есть
    await s.flushed();
    expect(await repo.getMeta(PLAY_META_KEY)).not.toBeNull();
    repo.setMeta = orig;
    const next = new PlayStore({ storage: repo });
    await next.restore();
    await next.flushed();
    expect(await repo.getMeta(PLAY_META_KEY)).toBeNull();
    expect(await repo.getMeta(slotKey("classic"))).toMatchObject({ mode: "classic" });
  });

  it("слот режима уже занят — его игра главнее, старая запись просто удаляется; решённая старая — удаляется", async () => {
    const legacy = await legacyRecord(false);
    const repo = new InMemoryProgressRepository();
    const cur = await legacyRecord(false);
    await repo.setMeta(slotKey("classic"), { ...cur, difficulty: "easy", mode: "classic" });
    await repo.setMeta(PLAY_META_KEY, legacy);
    const s = new PlayStore({ storage: repo });
    await s.restore();
    await s.flushed();
    expect(s.slots().classic!.difficulty).toBe("easy");
    expect(await repo.getMeta(PLAY_META_KEY)).toBeNull();

    const repo2 = new InMemoryProgressRepository();
    await repo2.setMeta(PLAY_META_KEY, { ...legacy, play: { ...(legacy.play as object), solved: true } });
    const t = new PlayStore({ storage: repo2 });
    await t.restore();
    await t.flushed();
    expect(t.slots()).toEqual({});
    expect(await repo2.getMeta(PLAY_META_KEY)).toBeNull();
  });

  it("нечитаемая старая запись не трогается; слот режима, неизвестного этой версии, не читается и не стирается", async () => {
    const repo = new InMemoryProgressRepository();
    await repo.setMeta(PLAY_META_KEY, { v: 1, play: "junk" });
    const future = { ...(await legacyRecord(false)), mode: "liar" };
    await repo.setMeta("playGame:liar", future);
    const s = new PlayStore({ storage: repo });
    await s.restore();
    await s.flushed();
    expect(s.slots()).toEqual({});
    expect(await repo.getMeta(PLAY_META_KEY)).toEqual({ v: 1, play: "junk" });
    expect(await repo.getMeta("playGame:liar")).toEqual(future);
  });
});

describe("предвыбор сложности шита", () => {
  it("недопустимая для режима сложность не ставится; по умолчанию — medium", () => {
    const s = new PlayStore();
    expect(s.pickFor("classic")).toBe("medium");
    s.setPick("classic", "nope" as never);
    expect(s.pickFor("classic")).toBe("medium");
    s.setPick("classic", "master");
    expect(s.pickFor("classic")).toBe("master");
    expect(enterDigit).toBeTypeOf("function");
  });
});
