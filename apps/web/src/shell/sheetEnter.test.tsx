// @vitest-environment jsdom
/**
 * PD-232 (в), аудит PD-228 п. 9: Enter в шитах. Начальный фокус — на основном действии там, где оно не разрушительное (Enter/пробел
 * сразу его выполняют: нативный click кнопки); в разрушительных подтверждениях фокус остаётся на безопасной кнопке.
 * Нажатие Enter по кнопке jsdom в click не превращает — тут проверяем, КУДА встал фокус; сам Enter — живая проверка
 * design/pd232-check.mjs (chromium + webkit).
 */
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { GamePad, LONG_PRESS_MS } from "../play/controls";
import type { PlaySnapshot } from "../play/gameStore";
import { HintRuleSheet } from "../play/HintRuleSheet";
import { InkRuleSheet } from "../play/InkEntry";
import { createPlay } from "../play/logic";
import { ModeSheet } from "../play/ModeSheet";
import { MODES } from "../play/modes";
import { ActionSheet } from "../recovery/ActionSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const show = (node: ReactNode) => act(() => root.render(node));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("шит режима", () => {
  const mode = MODES[0]!;
  it("отбрасывать нечего — фокус на «Start»: Enter запускает партию", () => {
    const onStart = vi.fn();
    show(<ModeSheet mode={mode} pick={mode.difficulties[0]!} discard={null} onPick={vi.fn()} onStart={onStart} onClose={vi.fn()} />);
    expect(document.activeElement).toBe(q("sheet-start"));
    act(() => q("sheet-start")!.click());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("«Start new» отбросит незаконченную партию — фокус остаётся на «Cancel»", () => {
    const discard = { difficulty: "medium", left: 50, elapsedMs: 60_000 } as never;
    show(<ModeSheet mode={mode} pick={mode.difficulties[0]!} discard={discard} onPick={vi.fn()} onStart={vi.fn()} onClose={vi.fn()} />);
    expect(q("discard-note")).not.toBeNull();
    expect(document.activeElement).toBe(q("sheet-cancel"));
  });
});

describe("шиты правила режима/подсказки", () => {
  it("правило подсказки: фокус на «Show the hint»", () => {
    show(<HintRuleSheet onGo={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(q("hint-rule-go"));
  });

  it("правило чернил: фокус на «Play in ink» (до первого хода режим снимается обратно)", () => {
    show(<InkRuleSheet onStart={vi.fn()} onCancel={vi.fn()} />);
    expect(document.activeElement).toBe(q("ink-rule-start"));
  });
});

describe("action sheet", () => {
  const sheet = (extra: Partial<Parameters<typeof ActionSheet>[0]>) => (
    <ActionSheet title="T" message="M" actionLabel="Go" cancelLabel="Cancel" onAction={vi.fn()} onCancel={vi.fn()} {...extra} />
  );
  it("primary — фокус на действии", () => {
    show(sheet({ primary: true }));
    expect(document.activeElement).toBe(q("action-sheet-go"));
  });
  it("разрушительный — на «Отмене», даже если попросили primary", () => {
    show(sheet({ destructive: true, primary: true }));
    expect(document.activeElement).toBe(q("action-sheet-cancel"));
  });
  it("по умолчанию (Settings: ключ восстановления) — как раньше, на самом шите", () => {
    show(sheet({}));
    expect(document.activeElement).toBe(q("action-sheet"));
  });

  it("«Fill candidates» (долгий Notes): фокус на «Fill» — действие откатывается одним Undo", () => {
    vi.useFakeTimers();
    const SOLUTION =
      "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
    const MISSION =
      "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";
    const snap = { phase: "playing", difficulty: "medium", startedOn: new Date(0), play: createPlay({ mission: MISSION, solution: SOLUTION }), selected: 2, notesMode: false, pop: null, wave: null } as PlaySnapshot;
    const store = { input: vi.fn(), undo: vi.fn(), erase: vi.fn(), toggleNotesMode: vi.fn(), fillCandidates: vi.fn() };
    show(<GamePad snap={snap} store={store as never} />);
    const notes = host.querySelector<HTMLButtonElement>(".actions .act")!;
    act(() => void notes.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    act(() => void vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(q("action-sheet")).not.toBeNull();
    expect(document.activeElement).toBe(q("action-sheet-go"));
  });
});
