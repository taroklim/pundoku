/**
 * Модель лесенки подсказок (PD-139): чистые функции без DOM/React, тестируются в node.
 *
 * Движок (`nextHint`, PD-134) отдаёт шаг целиком — вместе с цифрой. UI показывает ступени по одной и НИКОГДА не печатает
 * цифру шага (решение владельца/макет PD-133: последний вывод остаётся за игроком): модель отдаёт только то, что можно
 * показать — область, технику, роли клеток. Тексты собирает `hintCopy.ts` из тех же полей, цифры шага в них не попадают.
 */
import type { GridInput, Hint, HintRegion, StepHint } from "@pundoku/engine";
import { nextHint } from "@pundoku/engine";
import { digitAt } from "./logic";
import type { PlayState } from "./logic";

/** Ступеней лесенки ровно четыре; бесплатной нет (решение 7 макета). */
export const HINT_STEPS = 4;
export type HintStep = 1 | 2 | 3 | 4;

/** Подсказка по текущей доске игрока: цифры + заданные, заметки (только чтобы не показывать сделанное), последний ход. */
export function computeHint(play: PlayState): Hint {
  const values = play.mission.map((_, i) => digitAt(play, i));
  const lastMove = play.log[play.log.length - 1];
  return nextHint({
    givens: play.mission as GridInput,
    values: values as GridInput,
    solution: play.solution as GridInput,
    notes: play.notes,
    ...(lastMove ? { lastCell: lastMove.cell } : {}),
  });
}

/** Клетка, на которую подсказка вела (для журнала): постановка шага или та, к которой ведёт вычёркивание. `null` — не называла. */
export function hintCellOf(hint: Hint): number | null {
  if (hint.kind !== "step") return null;
  return hint.placement?.cell ?? hint.leadsTo?.cell ?? null;
}

/** Клетка, которую выбираем при закрытии на ступени ≥3 (кольцо выбора переезжает туда): клетка шага, не цифра. */
export function hintFocusCell(hint: StepHint): number | null {
  return hint.placement?.cell ?? hint.cells.target[0] ?? null;
}

const SINGLES = new Set(["naked_single", "hidden_single"]);
export const isSingleHint = (hint: StepHint): boolean => SINGLES.has(hint.explanation.id);

/** Метки на поле для текущей ступени (макет PD-133, §5). */
export interface HintMarks {
  /** `wax` — ветка «ошибка» (область расхождения), иначе `ink`. */
  readonly tone: "ink" | "wax";
  readonly region: HintRegion | null;
  /** «Где происходит» — полоса у нижней кромки клетки. */
  readonly strip: ReadonlySet<number>;
  /** «Почему» — полое кольцо в верхнем левом углу клетки. */
  readonly ring: ReadonlySet<number>;
  /** Вычёркнутые кандидаты: клетка → маска (бит d = цифра d). Только там, где заметка у игрока реально есть. */
  readonly struck: ReadonlyMap<number, number>;
}

const EMPTY: ReadonlySet<number> = new Set();

/**
 * Что рисовать на поле. Ступени 1–2: область; 3: клетки шага (одиночки — «где происходит», паттерн — «почему»);
 * 4: полный разбор (свидетели/паттерн, затронутые клетки, вычёркивание в заметках игрока). Ошибка — только область.
 */
export function hintMarks(hint: Hint, step: HintStep, notes: readonly number[]): HintMarks | null {
  if (hint.kind === "none") return null;
  if (hint.kind === "mistake") return { tone: "wax", region: hint.region, strip: EMPTY, ring: EMPTY, struck: new Map() };
  const strip = new Set<number>();
  const ring = new Set<number>();
  const struck = new Map<number, number>();
  if (step >= 3) {
    if (isSingleHint(hint)) {
      for (const c of hint.cells.target) strip.add(c);
    } else {
      for (const c of hint.cells.target) ring.add(c);
    }
  }
  if (step >= 4) {
    if (isSingleHint(hint)) {
      for (const c of hint.cells.witnesses) ring.add(c);
    } else {
      for (const c of hint.cells.affected) strip.add(c);
      for (const e of hint.eliminations ?? []) {
        const present = (notes[e.cell] ?? 0) & (1 << e.digit);
        if (present) struck.set(e.cell, (struck.get(e.cell) ?? 0) | (1 << e.digit));
      }
    }
  }
  return { tone: "ink", region: hint.region, strip, ring, struck };
}

/** Клетки области (дома): индексы 0..80. */
export function regionCells(region: HintRegion): number[] {
  const out: number[] = [];
  for (let k = 0; k < 9; k++) {
    if (region.kind === "row") out.push(region.index * 9 + k);
    else if (region.kind === "col") out.push(k * 9 + region.index);
    else out.push((3 * Math.floor(region.index / 3) + Math.floor(k / 3)) * 9 + 3 * (region.index % 3) + (k % 3));
  }
  return out;
}

/** Прямоугольник области в сетке 9×9 для слоя пунктира: строка/столбец начала, размер и число зазоров между блоками. */
export function regionRect(region: HintRegion): { r: number; c: number; h: number; w: number; br: number; bc: number; gy: number; gx: number } {
  if (region.kind === "row") {
    const r = region.index;
    return { r, c: 0, h: 1, w: 9, br: Math.floor(r / 3), bc: 0, gy: 0, gx: 2 };
  }
  if (region.kind === "col") {
    const c = region.index;
    return { r: 0, c, h: 9, w: 1, br: 0, bc: Math.floor(c / 3), gy: 2, gx: 0 };
  }
  const br = Math.floor(region.index / 3);
  const bc = region.index % 3;
  return { r: br * 3, c: bc * 3, h: 3, w: 3, br, bc, gy: 0, gx: 0 };
}

/** Хвост подписи клетки: что она значит для подсказки (`null` — ничего). Хвост — последним, координаты и значение читаются первыми. */
export type HintCellRole = "witness" | "cell" | "region";

export function hintRoleOf(marks: HintMarks | null, cell: number, inRegion: ReadonlySet<number>): HintCellRole | null {
  if (!marks) return null;
  if (marks.ring.has(cell)) return "witness";
  if (marks.strip.has(cell)) return "cell";
  if (inRegion.has(cell)) return "region";
  return null;
}
