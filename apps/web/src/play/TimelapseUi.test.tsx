// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../i18n";
import { createPlay, enterDigit, type PlayState } from "./logic";
import { ResultCard } from "./ResultCard";
import { TimelapseSheet } from "./TimelapseSheet";
import { ExportSheet, fingerprintCaption } from "./ExportSheet";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

function solvedPlay(): PlayState {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  let t = 0;
  for (let i = 0; i < 81; i++) {
    if (p.mission[i]) continue;
    t += 1000;
    p = enterDigit(p, i, p.solution[i]!, t);
  }
  return p;
}
const MOVES = MISSION.split("").filter((c) => c === "0").length;

let host: HTMLDivElement;
let root: Root;
let reduced = false;
beforeEach(() => {
  reduced = false;
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q.includes("prefers-reduced-motion") ? reduced : false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: Element | null) => act(() => void (el as HTMLElement).click());

describe("вход в Таймлапс из карточки дня", () => {
  const card = (play: PlayState, timelapse = { date: "2026-09-30", difficulty: "medium" as string | null }) =>
    act(() => root.render(<ResultCard play={play} cardRef={createRef()} title="Your path" timelapse={timelapse} />));

  it("есть лог: тонированная кнопка над Share, Share активна, строки «нет повтора» нет", () => {
    card(solvedPlay());
    const watch = q("tl-watch")!;
    expect(watch.textContent).toContain("Watch your solve");
    expect(q("tl-nolog")).toBeNull();
    const share = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Share"))!;
    expect(share.hasAttribute("disabled")).toBe(false);
    expect(watch.compareDocumentPosition(share) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("лог синтетический: вместо кнопки — тихая строка, ни серой кнопки, ни предупреждения", () => {
    card({ ...solvedPlay(), logSynthetic: true });
    expect(q("tl-watch")).toBeNull();
    expect(q("tl-nolog")!.textContent).toBe("Replay isn’t available for this day — moves weren’t kept.");
    expect(q("tl-nolog")!.querySelector("svg")).toBeNull();
    const share = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Share"))!;
    expect(share.hasAttribute("disabled")).toBe(true);
  });

  it("Play (без prop timelapse): входа нет вообще", () => {
    act(() => root.render(<ResultCard play={solvedPlay()} cardRef={createRef()} title="Your path" />));
    expect(q("tl-watch")).toBeNull();
    expect(q("tl-nolog")).toBeNull();
  });

  it("кнопка и тепловая карта открывают шит; Done закрывает, Escape тоже", () => {
    card(solvedPlay());
    click(q("tl-watch"));
    expect(q("timelapse-sheet")).not.toBeNull();
    expect(document.querySelector('[role="dialog"]')!.getAttribute("aria-modal")).toBe("true");
    click([...document.querySelectorAll(".tl-done")][0]!);
    expect(q("timelapse-sheet")).toBeNull();
    click(host.querySelector(".heat"));
    expect(q("timelapse-sheet")).not.toBeNull();
    act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(q("timelapse-sheet")).toBeNull();
  });
});

describe("TimelapseSheet", () => {
  const sheet = () => act(() => root.render(<TimelapseSheet play={solvedPlay()} date="2026-09-30" difficulty="medium" onClose={() => {}} />));

  it("по умолчанию — контактный лист: девять мини-полей с подписями времени, aria-hidden, без движения", () => {
    sheet();
    expect(q("tl-contact")).not.toBeNull();
    expect(q("tl-player")).toBeNull();
    const figs = document.querySelectorAll(".tl-contact figure");
    expect(figs).toHaveLength(9);
    figs.forEach((f) => {
      expect(f.querySelector(".mini")!.getAttribute("aria-hidden")).toBe("true");
      expect(f.querySelectorAll(".mini i")).toHaveLength(81);
      expect(f.querySelector("figcaption")!.textContent).toMatch(/^\d+:\d\d$/);
    });
    expect(document.querySelector(".tl-sub")!.textContent).toContain("Medium");
  });

  it("«Start» открывает плеер на нулевом ходу: Move 0 of N, ползунок «Move», транспорт с aria-label, скорость Slow/Normal/Fast", () => {
    sheet();
    click(q("tl-start"));
    expect(q("tl-player")!.getAttribute("data-step")).toBe("false");
    expect(q("tl-move")!.textContent).toBe(`Move 0 of ${MOVES}`);
    const scrub = q("tl-scrub") as HTMLInputElement;
    expect(scrub.getAttribute("aria-label")).toBe("Move");
    expect(scrub.max).toBe(String(MOVES));
    for (const id of ["tl-loop", "tl-prev", "tl-play", "tl-next"]) expect(q(id)!.getAttribute("aria-label")).toBeTruthy();
    expect(q("tl-loop")!.getAttribute("aria-pressed")).toBe("false"); // повтор выключен по умолчанию
    expect([...q("tl-speed")!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Slow", "Normal", "Fast"]);
    expect(document.querySelectorAll(".tl-field .cell")).toHaveLength(81);
  });

  it("‹ › шагают на один ход и ставят на паузу; кольцо — на последней поставленной клетке; ‹ на нуле не уходит", () => {
    sheet();
    click(q("tl-start"));
    click(q("tl-next"));
    expect(q("tl-move")!.textContent).toBe(`Move 1 of ${MOVES}`);
    expect(q("tl-play")!.getAttribute("aria-label")).toBe("Play");
    expect(document.querySelectorAll(".tl-field .ring")).toHaveLength(1);
    click(q("tl-prev"));
    click(q("tl-prev"));
    expect(q("tl-move")!.textContent).toBe(`Move 0 of ${MOVES}`);
    expect(document.querySelectorAll(".tl-field .ring")).toHaveLength(0);
  });

  it("ползунок переводит к ходу; на последнем ходу поле заполнено и цифры решения на местах", () => {
    sheet();
    click(q("tl-start"));
    const scrub = q("tl-scrub") as HTMLInputElement;
    act(() => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(scrub, String(MOVES));
      scrub.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(q("tl-move")!.textContent).toBe(`Move ${MOVES} of ${MOVES}`);
    // DOM идёт по блокам 3×3; собираем значения обратно в порядок строк.
    const byBox = [...document.querySelectorAll(".tl-field .cell")].map((c) => c.textContent);
    const grid: string[] = [];
    byBox.forEach((d, k) => {
      const box = Math.floor(k / 9);
      const within = k % 9;
      const r = Math.floor(box / 3) * 3 + Math.floor(within / 3);
      const c = (box % 3) * 3 + (within % 3);
      grid[r * 9 + c] = d ?? "";
    });
    expect(grid.join("")).toBe(SOLUTION);
  });

  it("Reduce Motion: плеер пошагово — на паузе, без скорости и повтора, с пояснением", () => {
    reduced = true;
    sheet();
    click(q("tl-start"));
    expect(q("tl-player")!.getAttribute("data-step")).toBe("true");
    expect(q("tl-play")!.getAttribute("aria-label")).toBe("Play");
    expect(q("tl-speed")).toBeNull();
    expect(q("tl-loop")).toBeNull();
    expect(q("tl-note")!.textContent).toBe(i18n.t("timelapse.stepNote"));
    expect(q("tl-move")!.textContent).toBe(`Move 0 of ${MOVES}`);
  });

  it("«назад к этапам» возвращает контактный лист", () => {
    sheet();
    click(q("tl-start"));
    click(q("tl-back"));
    expect(q("tl-contact")).not.toBeNull();
  });
});

describe("ExportSheet / подпись PNG", () => {
  it("подпись: дата · время · ходы · clean; с кляксами — «N blots»", () => {
    const t = i18n.t.bind(i18n);
    const base = { date: "2026-09-30", durationMs: 494000, moves: 51, blots: 0, corrections: 0, clean: true };
    const c = fingerprintCaption(t, "en", base);
    expect(c.left).toBe("Pundoku");
    expect(c.right).toBe("30 Sep 2026 · 8:14 · 51 moves · clean");
    expect(fingerprintCaption(t, "en", { ...base, blots: 2, clean: false }).right).toMatch(/· 2 blots$/);
    expect(fingerprintCaption(t, "en", { ...base, blots: 1, clean: false }).right).toMatch(/· 1 blot$/);
  });

  it("шит: Share недоступен, пока PNG не готов; готовый PNG — превью 1080×1350 и передаётся в navigator.share", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    const ctx = new Proxy({ measureText: () => ({ width: 100 }) } as Record<string, unknown>, {
      get: (o, k) => (k in o ? o[k as string] : () => {}),
      set: () => true,
    });
    const sizes: number[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, cb) {
      sizes.push(this.width, this.height);
      cb(blob);
    });
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    await act(async () => root.render(<ExportSheet play={solvedPlay()} date="2026-09-30" onClose={() => {}} />));
    expect(sizes).toEqual([1080, 1350]);
    const img = q("fp-image") as HTMLImageElement;
    expect(img.getAttribute("width")).toBe("1080");
    expect(img.getAttribute("height")).toBe("1350");
    expect(q("fp-share")!.hasAttribute("disabled")).toBe(false);
    await act(async () => void q("fp-share")!.click());
    expect(share).toHaveBeenCalledTimes(1);
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0];
    expect(arg.files[0]!.name).toBe("pundoku-2026-09-30.png");
    expect(arg.files[0]!.type).toBe("image/png");
    delete (navigator as unknown as Record<string, unknown>).share;
    delete (navigator as unknown as Record<string, unknown>).canShare;
  });
});
