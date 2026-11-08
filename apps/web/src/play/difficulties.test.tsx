// @vitest-environment jsdom
import { DIFFICULTIES } from "@pundoku/engine";
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import i18n from "../i18n";
import { setNoXWing } from "../settings/prefs";
import { DifficultyList } from "./DifficultyList";
import { PLAY_DEFAULT_DIFFICULTY, X_WING_DIFFICULTIES, clampDifficulty, hiddenByNoXWing, playableDifficulties } from "./difficulties";
import { PlayStore } from "./store";

afterEach(() => {
  localStorage.clear();
  setNoXWing(true);
});

describe("PD-305: фильтр сложностей «Без X-Wing»", () => {
  it("вкл — easy..expert (без expert_plus и master); выкл — все шесть; порядок сохраняется", () => {
    expect(X_WING_DIFFICULTIES).toEqual(["expert_plus", "master"]);
    expect(playableDifficulties(DIFFICULTIES, true)).toEqual(["easy", "medium", "hard", "expert"]);
    expect(playableDifficulties(DIFFICULTIES, false)).toEqual(DIFFICULTIES);
    expect(hiddenByNoXWing(DIFFICULTIES, true)).toBe(true);
    expect(hiddenByNoXWing(DIFFICULTIES, false)).toBe(false);
    expect(hiddenByNoXWing(["easy", "medium"], true)).toBe(false); // скрывать нечего — пояснения нет
  });

  it("clampDifficulty: допустимый — как есть; скрытый — ближайший допустимый ниже, а не первый", () => {
    const allowed = playableDifficulties(DIFFICULTIES, true);
    expect(clampDifficulty("hard", allowed)).toBe("hard");
    expect(clampDifficulty("master", allowed)).toBe("expert");
    expect(clampDifficulty("expert_plus", allowed)).toBe("expert");
    expect(clampDifficulty("easy", ["medium", "hard"])).toBe("medium"); // ниже нет — первый
    expect(clampDifficulty("hard", [])).toBe("hard");
  });

  it("Play по умолчанию — expert (новый пользователь, режим без выбора и без партии)", () => {
    expect(PLAY_DEFAULT_DIFFICULTY).toBe("expert");
    const s = new PlayStore();
    for (const mode of ["classic", "ink", "liar", "melody", "lantern", "glyphs"] as const) expect(s.pickFor(mode), mode).toBe("expert");
  });

  it("сохранённый выбор не ломается: hard остаётся hard; master при «Без X-Wing» → expert, выключили — снова master", () => {
    const s = new PlayStore();
    s.setPick("classic", "hard");
    expect(s.pickFor("classic")).toBe("hard");
    setNoXWing(false);
    s.setPick("classic", "master");
    expect(s.pickFor("classic")).toBe("master");
    setNoXWing(true);
    expect(s.pickFor("classic")).toBe("expert");
    expect(s.allowedFor("classic")).not.toContain("master");
    s.setPick("classic", "expert_plus"); // скрытый класс выбрать нельзя
    expect(s.pickFor("classic")).toBe("expert");
    setNoXWing(false);
    expect(s.pickFor("classic")).toBe("master"); // выбор не стёрт
  });

  it("«Новая сетка» после партии скрытого класса строит допустимый (expert), а не master", () => {
    const sent: { difficulty: string }[] = [];
    const W = class {
      onmessage = null;
      onerror = null;
      postMessage(req: { difficulty: string }) {
        sent.push(req);
      }
      terminate() {}
    };
    const orig = globalThis.Worker;
    (globalThis as { Worker: unknown }).Worker = W;
    try {
      const s = new PlayStore();
      s.newGame("master", "classic");
      expect(s.getSnapshot().difficulty).toBe("expert");
      expect(sent.at(-1)!.difficulty).toBe("expert");
      setNoXWing(false);
      s.newGame("master", "classic");
      expect(sent.at(-1)!.difficulty).toBe("master");
    } finally {
      (globalThis as { Worker: unknown }).Worker = orig;
    }
  });
});

describe("PD-305: DifficultyList", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  it("«Без X-Wing» вкл — 4 строки и пояснение; выкл — 6 строк (Virtuoso с подписью про X-Wing) без пояснения; переключение — сразу", async () => {
    await i18n.changeLanguage("en");
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(<DifficultyList options={DIFFICULTIES} pick="expert" onPick={() => undefined} />));
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(4);
    expect(host.querySelector('[data-testid="difficulty-noxwing-note"]')!.textContent).toContain("turn off “No X-Wing” in Settings");
    act(() => setNoXWing(false));
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(6);
    expect(host.querySelector('[data-testid="difficulty-noxwing-note"]')).toBeNull();
    expect(host.querySelector('[data-testid="difficulty-expert_plus"]')!.textContent).toBe("Virtuoso24 clues · X-Wing, Swordfish");
    expect(host.querySelector('[data-testid="difficulty-master"]')!.textContent).toBe("Master24 clues · beyond X-Wing");
    act(() => root.unmount());
    host.remove();
  });
});
