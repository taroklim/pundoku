// @vitest-environment jsdom
/**
 * UI лесенки подсказок (PD-139): док, лампочка, шит правила, метки на поле, карточка результата, подпись дня.
 * Главное правило макета: цифра шага не выводится в DOM ни на одной ступени.
 */
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { Board } from "./Board";
import { HintButton } from "./HintButton";
import { HintDock } from "./HintDock";
import { HintRuleSheet } from "./HintRuleSheet";
import { ResultCard } from "./ResultCard";
import { Subline } from "./Subline";
import { hintCellSet, hintCount, HintsRow } from "./hintCard";
import { playOf } from "./hint.fixtures";
import type { FixtureName } from "./hint.fixtures";
import { HintLadder, RULE_KEY } from "./hintStore";
import type { FlagStore } from "./hintStore";
import { createPlay, enterDigit } from "./logic";
import type { PlayState } from "./logic";
import { PlayStore } from "./store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const flags: FlagStore = { get: () => true, set: () => undefined };

function ladderFor(name: FixtureName): { ladder: HintLadder; store: PlayStore } {
  const store = new PlayStore();
  const inner = store as unknown as { snap: Record<string, unknown> };
  inner.snap = { ...inner.snap, hub: false, phase: "playing", play: playOf(name), selected: null };
  const ladder = new HintLadder(store, { flags });
  ladder.attach();
  return { ladder, store };
}

const dock = (ladder: HintLadder, play = false) => act(() => root.render(<HintDock ladder={ladder} state={ladder.getState()} play={play} />));

describe("HintDock", () => {
  it("PD-199: с glyphs ступени говорят «shape», без — «digit» (Классика)", () => {
    const { ladder } = ladderFor("hiddenSingle");
    act(() => ladder.openLadder());
    const live = (glyphs: boolean) => {
      act(() => root.render(<HintDock ladder={ladder} state={ladder.getState()} play glyphs={glyphs} />));
      return q("hint-live")!.textContent ?? "";
    };
    act(() => ladder.next()); // ступень 2: «one digit has only one place left»
    expect(live(false)).toMatch(/\bdigit\b/);
    expect(live(true)).toMatch(/\bshape\b/);
    expect(live(true)).not.toMatch(/digit/i);
    act(() => ladder.next());
    act(() => ladder.next()); // ступень 4
    expect(live(true)).toMatch(/one shape is still missing/);
    expect(live(true)).not.toMatch(/digit/i);
  });

  it("закрыт — ничего не рисует; открыт — счётчик «Step 1 of 4», «More» и подвал с правилом", () => {
    const { ladder } = ladderFor("hiddenSingle");
    dock(ladder);
    expect(q("hint-dock")).toBeNull();
    act(() => ladder.openLadder());
    dock(ladder);
    expect(q("hint-dock")).not.toBeNull();
    expect(q("hint-step")!.textContent).toMatch(/1/);
    expect(q("hint-more")!.textContent).toBe(i18n.t("hint.more"));
    expect(q("hint-foot")!.textContent).toContain(i18n.t("hint.foot"));
    expect(q("hint-live")!.getAttribute("aria-live")).toBe("polite");
  });

  it("«More» ведёт по ступеням, на 4-й кнопка — «Got it», затем закрывает док", () => {
    const { ladder } = ladderFor("pointing");
    act(() => ladder.openLadder());
    dock(ladder);
    for (let s = 2; s <= 4; s++) {
      act(() => (q("hint-more") as HTMLButtonElement).click());
      dock(ladder);
      expect(q("hint-dock")!.getAttribute("data-step")).toBe(String(s));
    }
    expect(q("hint-more")!.textContent).toBe(i18n.t("hint.done"));
    act(() => (q("hint-more") as HTMLButtonElement).click());
    dock(ladder);
    expect(q("hint-dock")).toBeNull();
  });

  it("PD-144 D-1: текст ступени и ключ значков — в одной прокручиваемой части (.hint-scroll); кнопки и счётчик вне неё", () => {
    const { ladder } = ladderFor("hiddenSingle");
    act(() => ladder.openLadder());
    dock(ladder, true);
    const scroll = document.querySelector<HTMLElement>(".hint-scroll")!;
    expect(scroll.contains(q("hint-live"))).toBe(true);
    expect(scroll.contains(q("hint-more"))).toBe(false);
    expect(scroll.contains(q("hint-close"))).toBe(false);
    expect(scroll.contains(q("hint-foot"))).toBe(false);
    // jsdom не считает раскладку: «под нижней кромкой есть текст» не заявляется без измеренной прокрутки.
    expect(scroll.getAttribute("data-more")).toBeNull();
    // Ступень не меняет структуру: после «More» тот же контейнер, текст по-прежнему внутри, `aria-live` не потерян.
    act(() => (q("hint-more") as HTMLButtonElement).click());
    dock(ladder, true);
    expect(document.querySelector(".hint-scroll")!.contains(q("hint-live"))).toBe(true);
    expect(q("hint-live")!.getAttribute("aria-live")).toBe("polite");
  });

  it("«Close» закрывает на любой ступени", () => {
    const { ladder } = ladderFor("nakedSingle");
    act(() => ladder.openLadder());
    dock(ladder);
    act(() => (q("hint-close") as HTMLButtonElement).click());
    expect(ladder.getState().open).toBe(false);
  });

  it("«ничего не нашёл» в Play: подвал говорит про игру, не про день", () => {
    const { ladder } = ladderFor("beyond");
    act(() => ladder.openLadder());
    dock(ladder, true);
    expect(q("hint-foot")!.textContent).toBe(i18n.t("hint.none.footPlay"));
    expect(q("hint-foot")!.textContent).not.toMatch(/\bday\b/);
  });

  it("ветка «ничего не нашёл»: только «Close», без счётчика ступеней и без подвала про пометку", () => {
    const { ladder } = ladderFor("beyond");
    act(() => ladder.openLadder());
    dock(ladder);
    expect(q("hint-dock")!.getAttribute("data-kind")).toBe("none");
    expect(q("hint-more")!.textContent).toBe(i18n.t("hint.close"));
    expect(q("hint-key")).toBeNull();
    expect(q("hint-foot")!.textContent).toBe(i18n.t("hint.none.foot"));
    expect(q("hint-dock")!.querySelector(".hint-mark")).toBeNull();
  });

  it("фокус уходит на скрытый заголовок дока при открытии", () => {
    const { ladder } = ladderFor("hiddenSingle");
    act(() => ladder.openLadder());
    dock(ladder);
    expect(document.activeElement?.tagName).toBe("H2");
    expect(document.activeElement?.closest("#hint-dock")).not.toBeNull();
  });

  it("цифра шага не попадает в DOM дока ни на одной ступени и ни в одной из трёх локалей", async () => {
    for (const lng of ["en", "uk", "ru"] as const) {
      await act(() => i18n.changeLanguage(lng));
      for (const name of ["nakedSingle", "hiddenSingle", "pointing", "claiming", "nakedPair", "hiddenPair"] as const) {
        const { ladder } = ladderFor(name);
        act(() => ladder.openLadder());
        const h = ladder.getState().hint;
        if (h?.kind !== "step") throw new Error(name);
        for (let s = 1; s <= 4; s++) {
          dock(ladder);
          const text = q("hint-dock")!.textContent ?? "";
          // Цифры в тексте допустимы только как номера строк/столбцов в названиях областей; проверяем «цифра шага» как слово
          // в явных шаблонах («digit N», «цифра N»).
          expect(text, `${lng}/${name}/${s}`).not.toMatch(/(digit|цифр[аиуо]?|цифру)\s*\d/i);
          if (s < 4) act(() => ladder.next());
        }
        act(() => ladder.close(false));
      }
    }
    await act(() => i18n.changeLanguage("en"));
  });
});

describe("HintButton", () => {
  it("подпись «Hint» / «Hint, N used today»; aria-expanded и aria-controls только при открытом доке", () => {
    const press = vi.fn();
    act(() => root.render(<HintButton open={false} used={0} onPress={press} controls="hint-dock" />));
    const b = q("hint-button")!;
    expect(b.getAttribute("aria-label")).toBe(i18n.t("hint.button"));
    expect(b.getAttribute("aria-expanded")).toBe("false");
    expect(b.hasAttribute("aria-controls")).toBe(false);
    act(() => root.render(<HintButton open used={2} onPress={press} controls="hint-dock" />));
    expect(b.getAttribute("aria-label")).toBe(i18n.t("hint.buttonUsed", { count: 2 }));
    expect(b.getAttribute("aria-expanded")).toBe("true");
    expect(b.getAttribute("aria-controls")).toBe("hint-dock");
    act(() => b.click());
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("в Play подпись без «today»", () => {
    act(() => root.render(<HintButton open={false} used={3} play onPress={() => {}} />));
    expect(q("hint-button")!.getAttribute("aria-label")).toBe(i18n.t("hint.buttonUsedPlay", { count: 3 }));
    expect(q("hint-button")!.getAttribute("aria-label")).not.toMatch(/today/i);
  });
});

describe("HintRuleSheet", () => {
  it("диалог: «Show hint» идёт дальше, «Not now» и Esc отменяют; фон inert пока открыт", () => {
    const go = vi.fn();
    const cancel = vi.fn();
    act(() => root.render(<HintRuleSheet onGo={go} onCancel={cancel} />));
    const sheet = q("hint-rule-sheet")!;
    expect(sheet.getAttribute("role")).toBe("dialog");
    expect(sheet.getAttribute("aria-modal")).toBe("true");
    expect(host.hasAttribute("inert")).toBe(true);
    act(() => (q("hint-rule-go") as HTMLButtonElement).click());
    expect(go).toHaveBeenCalledTimes(1);
    act(() => (q("hint-rule-cancel") as HTMLButtonElement).click());
    expect(cancel).toHaveBeenCalledTimes(1);
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("в Play правило говорит про партию и карточку, не про день и Year", () => {
    act(() => root.render(<HintRuleSheet play onGo={() => {}} onCancel={() => {}} />));
    const text = q("hint-rule-sheet")!.textContent ?? "";
    expect(text).toContain(i18n.t("hint.rule.titlePlay"));
    expect(text).not.toContain(i18n.t("hint.rule.title"));
    expect(text).not.toMatch(/\byear\b/i);
  });
});

describe("Board: метки подсказки", () => {
  const fake = { select: () => undefined, moveSelection: () => null } as unknown as Parameters<typeof Board>[0]["store"];
  it("ступень 3 одиночки: область под цифрами, полоса на клетке; ступень 1 — только область; всё aria-hidden", () => {
    const { ladder, store } = ladderFor("hiddenSingle");
    act(() => ladder.openLadder());
    act(() => root.render(<Board snap={store.getSnapshot()} store={fake} dim={false} hintMarks={ladder.getState().marks} />));
    expect(q("hint-area")).not.toBeNull();
    expect(q("hint-area")!.getAttribute("aria-hidden")).toBe("true");
    expect(document.querySelectorAll(".hint-strip")).toHaveLength(0);
    act(() => ladder.next());
    act(() => ladder.next());
    act(() => root.render(<Board snap={store.getSnapshot()} store={fake} dim={false} hintMarks={ladder.getState().marks} />));
    expect(document.querySelectorAll(".hint-strip")).toHaveLength(1);
    document.querySelectorAll(".hint-strip, .hint-ring").forEach((el) => expect(el.getAttribute("aria-hidden")).toBe("true"));
  });

  it("без подсказки меток нет", () => {
    const { store } = ladderFor("hiddenSingle");
    act(() => root.render(<Board snap={store.getSnapshot()} store={fake} dim={false} />));
    expect(q("hint-area")).toBeNull();
    expect(document.querySelectorAll(".hint-strip, .hint-ring")).toHaveLength(0);
  });
});

describe("карточка результата и подпись дня", () => {
  const MISSION =
    "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
  const SOLUTION =
    "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
  function solved(hintLog?: PlayState["hintLog"]): PlayState {
    let p = createPlay({ mission: MISSION, solution: SOLUTION });
    let t = 0;
    for (let i = 0; i < 81; i++) {
      if (p.mission[i]) continue;
      p = enterDigit(p, i, p.solution[i]!, (t += 1000));
    }
    return hintLog ? { ...p, hintLog } : p;
  }

  it("hintCellSet/hintCount: клетки из журнала без null; счёт — максимум из счётчика и журнала", () => {
    const log = [{ t: 1, cell: 4 }, { t: 2, cell: null }, { t: 3, cell: 4 }];
    expect([...hintCellSet({ hintLog: log })]).toEqual([4]);
    expect(hintCellSet({})).toEqual(new Set());
    expect(hintCount({ hintLog: log })).toBe(3);
    expect(hintCount({ hintLog: log }, 5)).toBe(5);
    expect(hintCount({}, undefined)).toBe(0);
  });

  it("ряд «Hints» только при N > 0", () => {
    act(() => root.render(<HintsRow count={0} />));
    expect(q("hints-row")).toBeNull();
    act(() => root.render(<HintsRow count={3} />));
    expect(q("hints-row")!.textContent).toBe(`${i18n.t("solved.hints")}3`);
  });

  it("ResultCard: ряд Hints и полая середина у клетки подсказки; без подсказок ни того ни другого", () => {
    const first = solved().mission.findIndex((g) => !g);
    act(() => root.render(<ResultCard play={solved([{ t: 500, cell: first }])} cardRef={createRef()} title="Your path" />));
    expect(q("hints-row")!.textContent).toContain("1");
    const cells = [...host.querySelectorAll(".heat i")];
    expect(cells[first]!.getAttribute("data-hinted")).toBe("true");
    expect(host.querySelectorAll('.heat i[data-hinted="true"]')).toHaveLength(1);
    act(() => root.render(<ResultCard play={solved()} cardRef={createRef()} title="Your path" />));
    expect(q("hints-row")).toBeNull();
    expect(host.querySelector('.heat i[data-hinted="true"]')).toBeNull();
  });

  it("ResultCard: счётчик записи без журнала (запись с другого устройства) всё равно даёт ряд, полых клеток нет", () => {
    act(() => root.render(<ResultCard play={solved()} cardRef={createRef()} title="Your path" hints={2} />));
    expect(q("hints-row")!.textContent).toContain("2");
    expect(host.querySelector('.heat i[data-hinted="true"]')).toBeNull();
  });

  it("Subline: «with help» словом, не цветом — перед часами; uk/ru локализованы; без help слова нет", async () => {
    act(() => root.render(<Subline day="Wed 30 Sep" difficulty="Medium" help clock="4:12" />));
    expect(host.querySelector(".subline")!.textContent).toBe("Wed 30 Sep · Medium · with help · 4:12");
    expect(q("help-mark")).not.toBeNull();
    await act(() => i18n.changeLanguage("uk"));
    expect(host.querySelector(".subline")!.textContent).toContain("з підказкою");
    await act(() => i18n.changeLanguage("ru"));
    expect(host.querySelector(".subline")!.textContent).toContain("с подсказкой");
    await act(() => i18n.changeLanguage("en"));
    act(() => root.render(<Subline day="Wed 30 Sep" difficulty="Medium" clock="4:12" />));
    expect(q("help-mark")).toBeNull();
  });
});

describe("правило без миграции: RULE_KEY экспортируется как есть", () => {
  it("ключи флагов устройства — pundoku.hintRule", () => {
    expect(RULE_KEY).toBe("pundoku.hintRule");
  });
});
