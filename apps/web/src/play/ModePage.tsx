import type { Difficulty } from "@pundoku/engine";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import type { SlotSummary } from "./daySlot";
import { DifficultyList } from "./DifficultyList";
import { formatClock } from "./format";
import { CalendarGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import type { ModeDef } from "./modes";
import { slotMeta } from "./slotMeta";

export interface ModePageProps {
  readonly mode: ModeDef;
  readonly pick: Difficulty;
  /** Незавершённая игра режима, которую «Начать новую» отбросит (обычно её нет: режим с партией открывается сразу). */
  readonly discard: SlotSummary | null;
  readonly onPick: (d: Difficulty) => void;
  readonly onStart: () => void;
  /** Лжец дня — строка над сложностью, только у режима Лжец (как в шите режима). */
  readonly daily?: {
    readonly state: { kind: "none" } | { kind: "playing"; summary: SlotSummary } | { kind: "solved"; timeMs: number };
    readonly onOpen: () => void;
  } | null;
}

/**
 * PD-266: страница режима — хаб Play в раскладке C «Сайдбар» (design/pd229-desktop.html, `modeDetail(true)`): режим, выбранный
 * в сайдбаре, без незаконченной партии открывается не шитом, а страницей на месте хаба. Содержимое — то же, что у шита режима
 * (`ModeSheet`, PD-167): значок и имя, предупреждение об отбрасывании (если вдруг есть что отбрасывать), описание, Лжец дня,
 * сложность списком и «Начать». Модальности, «Отмены» и жеста закрытия нет — уходят сайдбаром.
 *
 * Ширина колонки — 480 по макету; шкалу ширин всего хаба (640) и чип клавиши «↩» добавляют PD-269 / PD-267.
 */
export function ModePage({ mode, pick, discard, onPick, onStart, daily = null }: ModePageProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const diffId = useId();
  const { Icon } = mode;
  return (
    <section className="mode-page" aria-labelledby={titleId} data-testid="mode-page" data-mode={mode.id}>
      <h2 id={titleId} className="mp-title">
        <Icon className="mp-ic" />
        <span>{t(`modes.${mode.textKey}.name`)}</span>
      </h2>
      {discard && (
        <p className="mp-warn" data-testid="discard-note">
          {t("modes.discard", { meta: slotMeta(t, discard) })}
        </p>
      )}
      <p className="mp-desc" data-testid="mode-desc">
        {t(`modes.${mode.textKey}.desc`)}
      </p>
      {daily && (
        <>
          <p className="hub-head mp-head">{t("liar.dailyHead")}</p>
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
      <p id={diffId} className="hub-head mp-head">
        {t("modes.difficulty")}
      </p>
      <DifficultyList options={mode.difficulties} pick={pick} onPick={onPick} labelledBy={diffId} />
      <button type="button" className="hub-primary mp-start" onClick={onStart} data-testid="mode-page-start">
        {discard ? t("modes.startNew") : t("modes.start")}
      </button>
    </section>
  );
}
