// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";
import { enterDigit, createPlay, type PlayState } from "./logic";
import { ResultCard } from "./ResultCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SOLUTION =
  "534678912" + "672195348" + "198342567" + "859761423" + "426853791" + "713924856" + "961537284" + "287419635" + "345286179";
const MISSION =
  "530070000" + "600195000" + "098000060" + "800060003" + "400803001" + "700020006" + "060000280" + "000419005" + "000080079";

/** Решённая партия: пустые клетки заполняются по порядку, каждая через 1 с; опционально одна ошибка. */
function solvedPlay(withMistake = false): PlayState {
  let p = createPlay({ mission: MISSION, solution: SOLUTION });
  let t = 0;
  for (let i = 0; i < 81; i++) {
    if (p.mission[i]) continue;
    t += 1000;
    if (withMistake && t === 1000) {
      const wrong = (p.solution[i]! % 9) + 1;
      p = enterDigit(p, i, wrong, t);
      t += 1000;
    }
    p = enterDigit(p, i, p.solution[i]!, t);
  }
  expect(p.solved).toBe(true);
  return p;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (play: PlayState, winRate?: number | null, winRateScope?: "today" | "day") =>
  act(() =>
    root.render(<ResultCard play={play} cardRef={createRef()} title="Your path" winRate={winRate} winRateScope={winRateScope} />),
  );

describe("карточка дня", () => {
  it("тепловая карта: 81 клетка, подсказки — контур, остальные — по порядку заполнения", () => {
    render(solvedPlay());
    const cells = [...host.querySelectorAll(".heat i")];
    expect(cells).toHaveLength(81);
    const givens = MISSION.split("").filter((c) => c !== "0").length;
    expect(cells.filter((c) => c.classList.contains("g"))).toHaveLength(givens);
    const first = MISSION.indexOf("0");
    const last = MISSION.lastIndexOf("0");
    expect(Number(cells[first]!.getAttribute("data-o"))).toBeLessThan(Number(cells[last]!.getAttribute("data-o")));
    expect(host.querySelectorAll(".legend .bar i")).toHaveLength(9);
    expect(host.querySelector(".heat")!.getAttribute("role")).toBe("img");
  });

  it("время, clean и достигнутая техника", () => {
    render(solvedPlay());
    const rows = [...host.querySelectorAll(".row")].map((r) => r.textContent);
    const empties = 81 - MISSION.split("").filter((c) => c !== "0").length;
    const secs = empties;
    expect(rows[0]).toContain(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
    expect(rows[1]).toContain("clean");
    expect(rows[2]).toContain("Technique reached");
    expect(rows[2]).not.toMatch(/undefined|technique\./);
  });

  it("ошибка: вместо «clean» — число исправлений/ошибок не показывает clean", () => {
    render(solvedPlay(true));
    const row = [...host.querySelectorAll(".row")][1]!.textContent!;
    expect(row).not.toContain("clean");
  });

  it("win rate — только если API его отдал", () => {
    render(solvedPlay(), null);
    expect(host.querySelector("[data-testid=winrate]")).toBeNull();
    render(solvedPlay(), undefined);
    expect(host.querySelector("[data-testid=winrate]")).toBeNull();
    render(solvedPlay(), 61.4);
    expect(host.querySelector("[data-testid=winrate]")!.textContent).toBe("61 % solved today");
    render(solvedPlay(), 0);
    expect(host.querySelector("[data-testid=winrate]")!.textContent).toBe("0 % solved today");
  });

  it("win rate архивного дня: «solved that day» (en/uk/ru), не «today»", async () => {
    render(solvedPlay(), 61.4, "day");
    expect(host.querySelector("[data-testid=winrate]")!.textContent).toBe("61\u00a0% solved that day");
    render(solvedPlay(), 61.4, "today");
    expect(host.querySelector("[data-testid=winrate]")!.textContent).toBe("61\u00a0% solved today");
    await act(() => i18n.changeLanguage("uk"));
    render(solvedPlay(), 61.4, "day");
    expect(host.querySelector("[data-testid=winrate]")!.textContent).toBe("61\u00a0% розв’язали в той день");
    await act(() => i18n.changeLanguage("ru"));
    render(solvedPlay(), 61.4, "day");
    expect(host.querySelector("[data-testid=winrate]")!.textContent).toBe("61\u00a0% решили в тот день");
    await act(() => i18n.changeLanguage("en"));
  });

  it("Share неактивна (PNG-шаринг — отдельный тикет)", () => {
    render(solvedPlay(), 50);
    const share = host.querySelector<HTMLButtonElement>("button.share")!;
    expect(share.disabled).toBe(true);
  });
});
