import { dailyPuzzle, summary, timelapseFingerprint } from "@pundoku/engine";
import * as NEW from "./fingerprint";
import * as OLD from "./__qa_fp_main";
import { createPlay, enterDigit, setInkMode } from "./logic";

function play(date: string, diff: "easy" | "hard", ink: boolean, blotsAt: number[]) {
  let p = createPlay(dailyPuzzle(date, diff));
  if (ink) p = setInkMode(p, true);
  const empty = p.mission.map((g, i) => (g ? -1 : i)).filter((i) => i >= 0);
  let t = 1000;
  empty.forEach((cell, idx) => {
    const digit = blotsAt.includes(idx) ? (p.solution[cell]! % 9) + 1 : p.solution[cell]!;
    p = enterDigit(p, cell, digit, (t += 700 + ((idx * 37) % 900)));
  });
  return p;
}
async function toB64(b: Blob) { const buf = new Uint8Array(await b.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000)); return btoa(s); }
export async function probe(which: "new" | "old", scenario: string, right: string, noPath2D: boolean) {
  const [date, diff, ink, blots] = ({ clean: ["2026-09-20", "easy", false, []], ink: ["2026-10-03", "hard", true, [3, 20]], day3: ["2026-08-11", "easy", false, [5]] } as const)[scenario as "clean"] as [string, "easy" | "hard", boolean, number[]];
  const p = play(date, diff, ink, [...blots]);
  const mission = p.mission.join("");
  const fp = timelapseFingerprint(p.log, { mission, solution: p.solution.join("") }, { maxGapMs: Infinity });
  const M = which === "new" ? NEW : OLD;
  const real = (globalThis as any).Path2D;
  if (noPath2D) (globalThis as any).Path2D = undefined;
  try { return await toB64(await M.renderFingerprintPng(fp, mission, { left: "Pundoku", right })); }
  finally { (globalThis as any).Path2D = real; }
}
import i18n from "i18next";
import { fingerprintCaption } from "./ExportSheet";
export async function captionFor(lang: string, input: { date: string; durationMs: number; moves: number; blots: number; corrections: number; clean: boolean; hints?: number }) {
  await i18n.changeLanguage(lang);
  return fingerprintCaption(i18n.getFixedT(lang) as never, lang, input).right;
}
import { solve } from "@pundoku/engine";
export function solveGrid(rows: number[][]) { const s = solve(rows.flat() as never) as unknown; return s; }
