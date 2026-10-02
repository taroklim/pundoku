/** Фикстуры лесенки подсказок (PD-139): реальные доски из тестов движка (`packages/engine/src/hint.test.ts`) → `PlayState`. */
import { solve } from "@pundoku/engine";
import { createPlay } from "./logic";
import type { PlayState } from "./logic";

export const HINT_FIXTURES = {
  pointing: {
    givens: "007095000000007060800010700000409020000000008002000900300050100009200403400000079",
    state: "007095000000047060800012790008409020000020008002000900376954182189276453425000679",
  },
  claiming: {
    givens: "064200000000001003701090000200050100000710030050800400000002090002000000970000508",
    state: "064207951529001003701090002200050180008710235150820400015002090002000010970100528",
  },
  hiddenPair: {
    givens: "010600400000005060040031000600300200005000080020900036000000015270000000903070000",
    state: "010629400092045060046031000689307200135462987020908036060293715271580000953170000",
  },
  nakedPair: {
    givens: "000050070400080050500200300300020047009007000000600000000035010783000600200800000",
    state: "000050470400080050500274380300128947029547063000693520000735010783412695200869734",
  },
  hiddenSingle: {
    givens: "000800407009004000008000002700050060086012570053080204000090300900230006300700100",
    state: "000800407009004600008000902792453861486912573153687294000090300900230706300700100",
  },
  beyond: {
    givens: "008000097001000000005009002200094000300050000000000038000017000010530700060040310",
    state: "428163597971005063635009102287394651306851270150000038503017000810530700760048315",
  },
  /** Решается одними naked singles (Project Euler #96, сетка 01). */
  nakedSingle: {
    givens: "003020600900305001001806400008102900700000008006708200002609500800203009005010300",
    state: "003020600900305001001806400008102900700000008006708200002609500800203009005010300",
  },
} as const;

export type FixtureName = keyof typeof HINT_FIXTURES;

/** Партия: `givens` заданы, цифры игрока — разница `state` и `givens`. */
export function playOf(name: FixtureName, patch: Partial<PlayState> = {}): PlayState {
  const f = HINT_FIXTURES[name];
  const solution = solve(f.givens);
  if (!solution) throw new Error(`fixture ${name} has no unique solution`);
  const base = createPlay({ mission: f.givens, solution: solution.join("") });
  const values = base.values.map((_, i) => (base.mission[i] ? 0 : Number(f.state[i])));
  return { ...base, values, ...patch };
}

/** Поставить цифру игрока без лога (для сценариев ошибки). */
export function withValue(play: PlayState, cell: number, digit: number): PlayState {
  const values = [...play.values];
  values[cell] = digit;
  return { ...play, values };
}
