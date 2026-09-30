import { heatmap, summary } from "@pundoku/engine";
import type { ReactNode, RefObject } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatClock } from "./format";
import { heatLegend, heatOpacities } from "./heat";
import { ShareIcon } from "./icons";
import { BlotsRow, blotCellSet, HeatCells, InkChip } from "./inkCard";
import type { PlayState } from "./logic";

interface ResultCardProps {
  play: PlayState;
  cardRef: RefObject<HTMLElement | null>;
  title: string;
  /** «N % solved today» — только если сервер отдал `winRate` для ЭТОЙ сетки. */
  winRate?: number | null;
  /** О каком дне «N % solved»: `today` — сегодняшняя сетка, `day` — прошлый (архивный) день: «solved that day». */
  winRateScope?: "today" | "day";
  /** Доп. кнопки под Share (Play: «New game»). */
  children?: ReactNode;
}

/**
 * Карточка результата (макет `.card`, состояние solved): «Your path» — тепловая карта порядка
 * заполнения (`heatmap(moveLog)` движка), легенда Early/Late, время, «clean»/правки, достигнутая
 * техника (`summary`), «N % solved today» и Share. Общая для Today и Play.
 */
export function ResultCard({ play, cardRef, title, winRate, winRateScope = "today", children }: ResultCardProps) {
  const { t } = useTranslation();
  const sum = useMemo(() => summary(play.log), [play.log]);
  const heat = useMemo(
    () => heatOpacities(heatmap(play.log, { mission: play.mission.join(""), solution: play.solution.join("") })),
    [play],
  );
  const legend = useMemo(() => heatLegend(), []);
  const ink = play.ink === true;
  const blots = useMemo(() => blotCellSet(play), [play]);
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
      <div className="heat" role="img" aria-label={t("result.heatLabel")} data-testid="heat">
        <HeatCells heat={heat} blots={blots} />
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
        <div className="row">
          <dt>{t("solved.technique")}</dt>
          <dd>{sum.maxTechnique ? t(`technique.${sum.maxTechnique}`) : "—"}</dd>
        </div>
      </dl>
      {winRate != null && (
        <p className="winrate" data-testid="winrate">
          {t(winRateScope === "day" ? "result.winRateDay" : "result.winRate", { percent: Math.round(winRate) })}
        </p>
      )}
      {/* TODO(отдельный тикет): Share — PNG-карточка без цифр (spoiler-free); поведение не входит
          в PD-12, кнопка из макета есть, но неактивна. */}
      <button type="button" className="share" disabled>
        <ShareIcon />
        {t("solved.share")}
      </button>
      {children}
    </section>
  );
}
