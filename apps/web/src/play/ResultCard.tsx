import { heatmap, summary } from "@pundoku/engine";
import type { ReactNode, RefObject } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { HelpBlockId } from "../help/blocks";
import { formatClock } from "./format";
import { heatLegend, heatOpacities } from "./heat";
import { ShareIcon } from "./icons";
import { hintCellSet, hintCount, HintsRow } from "./hintCard";
import { BlotsRow, blotCellSet, HeatCells, InkChip } from "./inkCard";
import type { PlayState } from "./logic";
import { WatchRow, useTimelapseEntry } from "./TimelapseEntry";

interface ResultCardProps {
  play: PlayState;
  cardRef: RefObject<HTMLElement | null>;
  title: string;
  /** «N % solved today» — только если сервер отдал `winRate` для ЭТОЙ сетки. */
  winRate?: number | null;
  /** О каком дне «N % solved»: `today` — сегодняшняя сетка, `day` — прошлый (архивный) день: «solved that day». */
  winRateScope?: "today" | "day";
  /**
   * Таймлапс дня (PD-75): дата `YYYY-MM-DD` и ключ сложности. Задан — на карточке «Watch your solve» (главная кнопка) и
   * Share под ней (тонированная; открывает экспорт отпечатка); если ходы не сохранились — тихая строка и без Share.
   */
  timelapse?: { date: string; difficulty: string | null };
  /** PD-139: счётчик подсказок записи (если он есть); иначе считается по журналу партии. */
  hints?: number;
  /** «What's this?» у строки «Technique reached» (PD-120): открывает справку на нужном блоке. Нет — ссылки нет. */
  onOpenHelp?: (block: HelpBlockId) => void;
  /** Доп. кнопки под Share (Play: «New game»). */
  children?: ReactNode;
}

/**
 * Карточка результата (макет `.card`, состояние solved): «Your path» — тепловая карта порядка
 * заполнения (`heatmap(moveLog)` движка), легенда Early/Late, время, «clean»/правки, достигнутая
 * техника (`summary`), «N % solved today» и Share. Общая для Today и Play.
 */
export function ResultCard({ play, cardRef, title, winRate, winRateScope = "today", timelapse, hints, onOpenHelp, children }: ResultCardProps) {
  const { t } = useTranslation();
  const tl = useTimelapseEntry(play, timelapse?.date ?? null, timelapse?.difficulty ?? null);
  const sum = useMemo(() => summary(play.log), [play.log]);
  const heat = useMemo(
    () => heatOpacities(heatmap(play.log, { mission: play.mission.join(""), solution: play.solution.join("") })),
    [play],
  );
  const legend = useMemo(() => heatLegend(), []);
  const ink = play.ink === true;
  const blots = useMemo(() => blotCellSet(play), [play]);
  const hinted = useMemo(() => hintCellSet(play), [play]);
  const helped = hintCount(play, hints);
  return (
    <section className="card" ref={cardRef} tabIndex={-1} aria-labelledby="result-title" data-testid="result-card">
      <h2 id="result-title" className={ink ? "ink-h2" : undefined}>
        {title}
        {ink && <InkChip />}
      </h2>
      <p className="sub">
        {t("result.pathSub")}
        {ink && ` ${t("ink.cardSub")}`}
      </p>
      <div
        className={`heat${tl.available ? " tl-tap" : ""}`}
        role="img"
        aria-label={t("result.heatLabel")}
        data-testid="heat"
        onClick={tl.available ? () => tl.open("player") : undefined}
      >
        <HeatCells heat={heat} blots={blots} hinted={hinted} />
      </div>
      <div className="legend">
        <span>{t("result.early")}</span>
        <span className="bar" aria-hidden="true">
          {legend.map((o, i) => (
            <i key={i} style={{ opacity: o }} />
          ))}
        </span>
        <span>{t("result.late")}</span>
      </div>
      <dl className="rows">
        <div className="row">
          <dt>{t("solved.time")}</dt>
          <dd className="mono">{formatClock(sum.durationMs)}</dd>
        </div>
        {ink ? (
          <BlotsRow count={blots.size} />
        ) : (
          <div className="row">
            <dt>{t("solved.corrections")}</dt>
            <dd>{sum.clean ? t("solved.clean") : sum.corrections}</dd>
          </div>
        )}
        <HintsRow count={helped} />
        <div className="row">
          <dt>{t("solved.technique")}</dt>
          <dd>
            {sum.maxTechnique ? t(`technique.${sum.maxTechnique}`) : "—"}
            {onOpenHelp && (
              <button
                type="button"
                className="help-link inline"
                onClick={() => onOpenHelp("technique")}
                aria-label={`${t("help.whatsThis")} ${t("solved.technique")}`}
                data-testid="technique-help"
              >
                {t("help.whatsThis")}
              </button>
            )}
          </dd>
        </div>
      </dl>
      {winRate != null && (
        <p className="winrate" data-testid="winrate">
          {t(winRateScope === "day" ? "result.winRateDay" : "result.winRate", { percent: Math.round(winRate) })}
        </p>
      )}
      {tl.enabled && <WatchRow available={tl.available} onWatch={() => tl.open("player")} />}
      {/* Share — PNG-отпечаток без цифр (PD-75), вторичное действие (PD-129): главное на карточке — «Watch your solve».
          Нет цельного лога — нечем делиться, и кнопки нет вовсе (не серая: мёртвая кнопка путает; у дня без лога
          вместо Watch — тихая строка). */}
      {tl.available && (
        <button type="button" className="share" data-testid="share" onClick={() => tl.open("export")}>
          <ShareIcon />
          {t("solved.share")}
        </button>
      )}
      {children}
      {tl.sheets}
    </section>
  );
}
