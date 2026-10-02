/**
 * Тексты ступеней лесенки подсказок (PD-139). Чистые функции от `t` и подсказки движка, без React.
 *
 * Правило макета PD-133: цифра шага (`placement.digit`, `params.digit/digits`, цифры вычёркиваний) в текст НЕ попадает ни на
 * одной ступени. Шаблоны получают только области, номера строк/столбцов и число свидетелей; тест
 * (`hintCopy.test.ts`) подменяет все цифры шага и требует неизменных строк. Названия областей — предложная форма с
 * предлогом внутри («in row 6», «у рядку 6»): предлог зависит от языка и падежа, поэтому он в строке, а не в коде.
 */
import type { TFunction } from "i18next";
import type { Hint, HintRegion, MistakeHint, StepHint } from "@pundoku/engine";
import type { HintStep } from "./hintModel";
import { isSingleHint } from "./hintModel";

/** Строка ключа меток: какая метка на поле что значит (док показывает только те, что сейчас есть на поле). */
export interface HintKeyItem {
  readonly kind: "region" | "where" | "why";
  readonly label: string;
}

export interface HintStepCopy {
  readonly title: string;
  readonly body: string;
  readonly key: readonly HintKeyItem[];
  /** Подвал для ветки «ничего не нашёл» (вместо подвала с меткой). */
  readonly foot?: string;
}

export const capFirst = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** «in row 6» / «in the top-left box»: область с предлогом, со строчной буквы. */
export function regionIn(t: TFunction, r: HintRegion): string {
  const n = r.index + 1;
  return r.kind === "box" ? t(`hint.regionIn.box.${n}`) : t(`hint.regionIn.${r.kind}`, { n });
}

const rowOf = (cell: number): number => Math.floor(cell / 9) + 1;
const colOf = (cell: number): number => (cell % 9) + 1;

function step1(t: TFunction, hint: StepHint | MistakeHint): { title: string; body: string } {
  const r = hint.region;
  const n = r.index + 1;
  const title = r.kind === "box" ? t("hint.s1.box", { box: t(`hint.box.${n}`) }) : t(`hint.s1.${r.kind}`, { n });
  return { title, body: t("hint.s1.body") };
}

function stepCopy(t: TFunction, hint: StepHint, step: HintStep): HintStepCopy {
  const region: HintKeyItem = { kind: "region", label: t("hint.keyRegion") };
  const where: HintKeyItem = { kind: "where", label: t("hint.keyWhere") };
  const why: HintKeyItem = { kind: "why", label: t("hint.keyWhy") };
  const id = hint.explanation.id;
  const single = isSingleHint(hint);

  if (step === 1) return { ...step1(t, hint), key: [region] };
  if (step === 2) return { title: t(`technique.${hint.technique}`), body: t(`hint.s2.${id}`), key: [region] };

  if (step === 3) {
    const targets = [...hint.cells.target].sort((a, b) => a - b);
    if (single) {
      const c = targets[0] ?? 0;
      return { title: t("hint.s3.cell", { r: rowOf(c), c: colOf(c) }), body: t("hint.s3.cellBody"), key: [region, where] };
    }
    if (hint.explanation.id === "locked_pointing" || hint.explanation.id === "locked_claiming") {
      const p = hint.explanation.params;
      return {
        title: t("hint.s3.locked", { Source: capFirst(regionIn(t, p.source)), target: regionIn(t, p.target) }),
        body: t("hint.s3.lockedBody"),
        key: [region, why],
      };
    }
    const [a = 0, b = 0] = targets;
    return {
      title: t("hint.s3.pair", { r1: rowOf(a), c1: colOf(a), r2: rowOf(b), c2: colOf(b) }),
      body: t("hint.s3.pairBody"),
      key: [region, why],
    };
  }

  // Ступень 4: разбор. Подзаголовок — «Why that cell» для одиночки, «Why those cells» для паттерна.
  const title = t(single ? "hint.s4.titleOne" : "hint.s4.titleMany");
  const key = [region, why, where];
  const assumed = hint.assumes.length > 0;
  let body: string;
  switch (hint.explanation.id) {
    case "naked_single":
      body = t(assumed ? "hint.s4.naked_single_assumed" : "hint.s4.naked_single");
      break;
    case "hidden_single":
      body = t("hint.s4.hidden_single", { count: Math.max(1, hint.cells.witnesses.length), Region: capFirst(regionIn(t, hint.explanation.params.region)) });
      break;
    case "locked_pointing":
    case "locked_claiming": {
      const p = hint.explanation.params;
      body = t("hint.s4.locked", { Source: capFirst(regionIn(t, p.source)), target: regionIn(t, p.target) });
      break;
    }
    case "naked_pair":
    case "hidden_pair": {
      const inRegion = regionIn(t, hint.explanation.params.region);
      body = t(`hint.s4.${hint.explanation.id}`, { region: inRegion, Region: capFirst(inRegion) });
      break;
    }
    default:
      body = "";
  }
  if (assumed && hint.explanation.id !== "naked_single") body = `${body} ${t("hint.s4.assumes")}`;
  return { title, body, key };
}

function mistakeCopy(t: TFunction, hint: MistakeHint): HintStepCopy {
  const region = regionIn(t, hint.region);
  const body = hint.explanation.id === "mistake_conflict" ? t("hint.bad.dup", { region }) : t("hint.bad.generic", { region });
  return { title: t("hint.bad.title"), body, key: [{ kind: "region", label: t("hint.bad.key") }] };
}

/**
 * Текст ступени `step` для подсказки; ветка ошибки и «ничего не нашёл» от ступени не зависят. `play` — Play (партия, не день):
 * подвал ветки «ничего не нашёл» говорит «игра», а не «день».
 */
export function hintStepCopy(t: TFunction, hint: Hint, step: HintStep, play = false): HintStepCopy {
  if (hint.kind === "mistake") return mistakeCopy(t, hint);
  if (hint.kind === "none") return { title: t("hint.none.title"), body: t("hint.none.body"), key: [], foot: t(play ? "hint.none.footPlay" : "hint.none.foot") };
  return stepCopy(t, hint, step);
}
