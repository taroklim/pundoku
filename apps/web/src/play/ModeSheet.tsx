/**
 * Шит режима (PD-167, раскладка C — макет design/pd163-modes-layout.html, кадры wk-C-sheet-*): ОДИН компонент для всех
 * режимов, всё — из реестра (`modes.ts`). Сверху значок + имя режима и «Отмена», ниже предупреждение «Незаконченная сетка
 * (…) будет отброшена», если у режима есть незавершённая игра (PD-175: первым, до описания), описание режима (правило
 * читается до первого хода) и сложность списком; внизу «Начать» / «Начать новую».
 *
 * Скроллится только середина (`.sheet-scroll`): ручка, заголовок с «Отменой» и «Начать» — `flex:none` и не уезжают за край
 * (320×568, AX3, uk/ru); последний элемент прокрутки — липкая растушёвка `.scroll-fade`.
 */
import type { Difficulty } from "@pundoku/engine";
import type { RefObject } from "react";
import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModal } from "../shell/useModal";
import { useSheetSwipe } from "../shell/useSheetSwipe";
import type { SlotSummary } from "./daySlot";
import { DifficultyList } from "./DifficultyList";
import { formatClock } from "./format";
import { CalendarGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import type { ModeDef } from "./modes";
import { slotMeta } from "./slotMeta";

export interface ModeSheetProps {
  readonly mode: ModeDef;
  readonly pick: Difficulty;
  /** Незавершённая игра режима, которую «Начать новую» отбросит; `null` — отбрасывать нечего. */
  readonly discard: SlotSummary | null;
  readonly onPick: (d: Difficulty) => void;
  readonly onStart: () => void;
  readonly onClose: () => void;
  /** Куда вернуть фокус (строка режима, кнопка «⋯»). */
  readonly returnFocus?: RefObject<HTMLElement | null>;
  /**
   * PD-171: Лжец дня (medium, одинаковый у всех) — отдельная строка над сложностью: тап открывает его (новый, идущий или
   * решённый — карточку). Только у режима Лжец.
   */
  readonly daily?: {
    readonly state: { kind: "none" } | { kind: "playing"; summary: SlotSummary } | { kind: "solved"; timeMs: number };
    readonly onOpen: () => void;
  } | null;
}

export function ModeSheet({ mode, pick, discard, onPick, onStart, onClose, returnFocus, daily = null }: ModeSheetProps) {
  const { t } = useTranslation();
  const scrim = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const titleId = useId();
  const descId = useId();
  const warnId = useId();
  const diffId = useId();
  const swipe = useSheetSwipe(root, onClose);
  // PD-232 (в): Enter = основное действие, только если оно ничего не отбрасывает. «Начать» с чистого листа — фокус на нём;
  // «Начать новую» отбросит незаконченную партию (выход из партии) — фокус остаётся на безопасной «Отмене».
  useModal(scrim, root, { kind: "dialog", onClose, returnFocus, initialFocus: discard ? '[data-testid="sheet-cancel"]' : '[data-testid="sheet-start"]' });
  const { Icon } = mode;
  const name = t(`modes.${mode.textKey}.name`);

  return createPortal(
    <div ref={scrim} className="sheet-scrim" onClick={onClose} data-testid="mode-sheet-scrim">
      <section
        ref={root}
        className="mode-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={discard ? `${warnId} ${descId}` : descId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        data-testid="mode-sheet"
        data-mode={mode.id}
      >
        <div className="grabber sheet-handle" aria-hidden="true" {...swipe} />
        <div className="sh-top sheet-handle" {...swipe}>
          <h2 id={titleId} className="sh-title">
            <Icon className="sh-ic" />
            <span>{name}</span>
          </h2>
          <button type="button" className="sh-cancel" onClick={onClose} data-testid="sheet-cancel">
            {t("modes.cancel")}
          </button>
        </div>
        <div className="sheet-scroll">
          {/* PD-175: предупреждение — ПЕРВЫМ в прокрутке, над описанием: при AX3 на 320×568 описание занимает всю видимую
              середину, и предупреждение под ним уходило под прокрутку — пользователь видел «Начать новую», не видя, что
              потеряет. Первым элементом оно видно до разрушительной кнопки при любом размере текста. */}
          {discard && (
            <p id={warnId} className="sh-warn" data-testid="discard-note">
              {t("modes.discard", { meta: slotMeta(t, discard) })}
            </p>
          )}
          <p id={descId} className="sh-desc" data-testid="mode-desc">
            {t(`modes.${mode.textKey}.desc`)}
          </p>
          {daily && (
            <>
              <p className="hub-head sh-head">{t("liar.dailyHead")}</p>
              <div className="hub-card">
                <button type="button" className="hub-row two" onClick={daily.onOpen} data-testid="liar-daily" data-state={daily.state.kind}>
                  <span className="l1">
                    <CalendarGlyph className="glyph" />
                    <b>{t("liar.daily")}</b>
                  </span>
                  <span className={`l2${daily.state.kind === "playing" ? " prog" : ""}`}>
                    {daily.state.kind === "none"
                      ? t("liar.dailyNew", { difficulty: t("difficulty.medium") })
                      : daily.state.kind === "playing"
                        ? t("modes.status", { meta: slotMeta(t, daily.state.summary) })
                        : t("liar.dailyDone", { time: formatClock(daily.state.timeMs) })}
                  </span>
                  <ChevronIcon className="chev" />
                </button>
              </div>
            </>
          )}
          <p id={diffId} className="hub-head sh-head">
            {t("modes.difficulty")}
          </p>
          <DifficultyList options={mode.difficulties} pick={pick} onPick={onPick} labelledBy={diffId} />
          <div className="scroll-fade" aria-hidden="true" />
        </div>
        <button type="button" className="hub-primary" onClick={onStart} data-testid="sheet-start">
          {discard ? t("modes.startNew") : t("modes.start")}
        </button>
      </section>
    </div>,
    document.body,
  );
}
