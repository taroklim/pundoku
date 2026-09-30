import { heatmap, summary } from "@pundoku/engine";
import type { ReactNode, RefObject } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatClock } from "./format";
import { heatLegend, heatOpacities } from "./heat";
import { ShareIcon } from "./icons";
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
   * Таймлапс дня (PD-75): дата `YYYY-MM-DD` и ключ сложности. Задан — над Share появляется «Watch your solve» (или
   * тихая строка, если ходы не сохранились), Share открывает экспорт отпечатка. Не задан (Play) — карточка как раньше.
   */
  timelapse?: { date: string; difficulty: string | null };
  /** Доп. кнопки под Share (Play: «New game»). */
  children?: ReactNode;
}

/**
 * Карточка результата (макет `.card`, состояние solved): «Your path» — тепловая карта порядка
 * заполнения (`heatmap(moveLog)` движка), легенда Early/Late, время, «clean»/правки, достигнутая
 * техника (`summary`), «N % solved today» и Share. Общая для Today и Play.
 */
export function ResultCard({ play, cardRef, title, winRate, winRateScope = "today", timelapse, children }: ResultCardProps) {
  const { t } = useTranslation();
  const tl = useTimelapseEntry(play, timelapse?.date ?? null, timelapse?.difficulty ?? null);
  const sum = useMemo(() => summary(play.log), [play.log]);
  const heat = useMemo(
    () => heatOpacities(heatmap(play.log, { mission: play.mission.join(""), solution: play.solution.join("") })),
    [play],
  );
  const legend = useMemo(() => heatLegend(), []);
  return (
    <section className="card" ref={cardRef} tabIndex={-1} aria-labelledby="result-title" data-testid="result-card">
      <h2 id="result-title">{title}</h2>
      <p className="sub">{t("result.pathSub")}</p>
      <div
        className={`heat${tl.available ? " tl-tap" : ""}`}
        role="img"
        aria-label={t("result.heatLabel")}
        data-testid="heat"
        onClick={tl.available ? () => tl.open("player") : undefined}
      >
        {heat.map((o, i) =>
          o === null ? <i key={i} className="g" /> : <i key={i} style={{ opacity: o }} data-o={o} />,
        )}
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
        <div className="row">
          <dt>{t("solved.corrections")}</dt>
          <dd>{sum.clean ? t("solved.clean") : sum.corrections}</dd>
        </div>
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
      {tl.enabled && <WatchRow available={tl.available} onWatch={() => tl.open("player")} />}
      {/* Share — PNG-отпечаток без цифр (PD-75): доступен там, где есть цельный лог (Today/архив); в Play и у дней
          без лога — как раньше, неактивен. */}
      <button type="button" className="share" disabled={!tl.available} onClick={() => tl.open("export")}>
        <ShareIcon />
        {t("solved.share")}
      </button>
      {children}
      {tl.sheets}
    </section>
  );
}
