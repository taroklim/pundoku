/**
 * Чернильный режим (PD-71): правила в ОДНОМ месте. Решение владельца ещё не подтверждено —
 * смена решения = правка `INK_RULES` (и, если нужно, `inkAllows`), без поиска по коду.
 * Подробности, крайние случаи и «ВОПРОС ВЛАДЕЛЬЦУ» — `docs/pd-71-ink-rules.md` (корень продукта).
 *
 * Идея режима: цифра — чернила, назад дороги нет. Нет `undo`, нет стирания цифр, заполненная клетка
 * заблокирована. Ошибка (цифра ≠ решению) — клякса: неверная цифра остаётся в логе (`correct: false`,
 * `blot: true`), клетка блокируется, а если `autoReplaceBlot` — тут же (тот же `t`) заменяется верной
 * цифрой (`correct: true`, `blot: true`), чтобы партия всегда была завершаема.
 *
 * Лог клякс воспроизводится существующим `replay` без спец-случаев для undo: таймлапс видит пару
 * `place(wrong, blot) → place(right, blot)` в одну и ту же миллисекунду.
 */
import type { Digit, Move, MoveKind, MoveLog } from "./types.js";

export interface InkRules {
  /**
   * `true` — после кляксы клетка сама получает верную цифру (пометка `blot` на обоих ходах): партия
   * завершаема. `false` — неверная цифра остаётся в клетке навсегда, а клетка-клякса считается закрытой
   * при проверке «решено» (решено = каждая клетка верна либо клякса).
   */
  readonly autoReplaceBlot: boolean;
  /** Разрешён ли режим в архивных днях (по умолчанию нет; пока решения владельца нет — выключено). */
  readonly allowInArchive: boolean;
  /** Заметки (`note_add`/`note_remove`) в ink-партии (и стирание заметок пустой клетки). */
  readonly allowNotes: boolean;
}

export const INK_RULES: InkRules = {
  autoReplaceBlot: true,
  allowInArchive: false,
  allowNotes: true,
};

/**
 * Допустим ли ход вида `kind` в ink-партии. `filled` — в клетке уже стоит цифра игрока (любая:
 * верная или клякса). Единственный источник истины и для стора, и для `inkViolations`.
 *
 * - `undo` — никогда;
 * - `place` — только в пустую клетку (перезапись = скрытое стирание);
 * - `erase` — только пустой клетки (то есть стирание заметок); цифру стереть нельзя;
 * - заметки — в пустой клетке и если `allowNotes`.
 */
export function inkAllows(kind: MoveKind, filled: boolean, rules: InkRules = INK_RULES): boolean {
  switch (kind) {
    case "undo":
      return false;
    case "place":
      return !filled;
    case "erase":
      return !filled;
    case "note_add":
    case "note_remove":
      return rules.allowNotes && !filled;
  }
}

/** Ход — клякса (неверная цифра, оставленная в клетке) либо её авто-замена. */
export const isBlotMove = (m: Move): boolean => m.blot === true;

/** Клякса в узком смысле: сама неверная постановка (`blot` и `correct === false`). */
export const isBlotMistake = (m: Move): boolean => m.kind === "place" && m.blot === true && m.correct === false;

export interface Blot {
  readonly cell: number;
  /** Неверная цифра, оставшаяся кляксой. */
  readonly digit: Digit | undefined;
  readonly t: number;
}

/** Кляксы лога (по одной на ошибку), в порядке постановки. Пустой массив для обычной партии. */
export function blotsOf(log: MoveLog): Blot[] {
  const out: Blot[] = [];
  for (const m of log) if (isBlotMistake(m)) out.push({ cell: m.cell, digit: m.digit, t: m.t });
  return out;
}

export interface InkViolation {
  /** Индекс хода в логе. */
  readonly index: number;
  readonly rule:
    | "undo"
    | "place_on_filled"
    | "erase_filled"
    | "note_on_filled"
    | "notes_disallowed"
    | "unmarked_mistake"
    | "blot_without_replacement"
    | "unexpected_replacement";
}

/**
 * Проверка лога ink-партии на соответствие правилам: ничего из запрещённого не попало в лог.
 * Пустой результат = лог чистый. Годится для тестов, диагностики синхронизации и сверки таймлапса.
 * Заметки: разрешены только если `allowNotes` (иначе `notes_disallowed`).
 */
export function inkViolations(log: MoveLog, rules: InkRules = INK_RULES): InkViolation[] {
  const out: InkViolation[] = [];
  const filled = new Array<boolean>(81).fill(false);
  /** Клетка ждёт авто-замену сразу после кляксы. */
  let pending: number | null = null;
  log.forEach((m, index) => {
    if (pending !== null && !(m.kind === "place" && m.blot === true && m.cell === pending && m.correct !== false)) {
      out.push({ index: index - 1, rule: "blot_without_replacement" });
    }
    const wasPending = pending;
    pending = null;
    const isFilled = filled[m.cell]!;
    switch (m.kind) {
      case "undo":
        out.push({ index, rule: "undo" });
        break;
      case "place":
        if (m.blot === true && m.correct !== false && wasPending === m.cell) {
          break; // авто-замена клетки-кляксы: клетка уже заполнена кляксой — это по правилам
        }
        if (isFilled) out.push({ index, rule: "place_on_filled" });
        if (m.correct === false && m.blot !== true) out.push({ index, rule: "unmarked_mistake" });
        if (m.blot === true && m.correct !== false) out.push({ index, rule: "unexpected_replacement" });
        filled[m.cell] = true;
        if (isBlotMistake(m) && rules.autoReplaceBlot) pending = m.cell;
        break;
      case "erase":
        if (isFilled) out.push({ index, rule: "erase_filled" });
        break;
      case "note_add":
      case "note_remove":
        if (!rules.allowNotes) out.push({ index, rule: "notes_disallowed" });
        else if (isFilled) out.push({ index, rule: "note_on_filled" });
        break;
    }
  });
  if (pending !== null) out.push({ index: log.length - 1, rule: "blot_without_replacement" });
  return out;
}
