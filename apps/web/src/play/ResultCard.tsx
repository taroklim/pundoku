import { heatmap, petMood, summary } from "@pundoku/engine";
import type { ReactNode, RefObject } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { HelpBlockId } from "../help/blocks";
import { TuneButton, useCardTune } from "../melody/MelodyTune";
import { PetBlot } from "../pet/PetBlot";
import { petDayOfPlay } from "../pet/petDay";
import { ARRIVE_DELAY_MS } from "../pet/petMotion";
import { usePetEnabled } from "../settings/prefs";
import { formatClock } from "./format";
import { heatLegend, heatOpacities } from "./heat";
import { ShareIcon } from "./icons";
import { hintCellSet, hintCount, HintsRow } from "./hintCard";
import { BlotsRow, blotCellSet, HeatCells, InkChip } from "./inkCard";
import { LiarCompare, LiarRows } from "./liarCard";
import type { PlayState } from "./logic";
import type { LiarInfo } from "./savedPlay";
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
  /** PD-171: партия Лжеца — метрики поимки и сравнение с собой (средний ход обвинения по другим партиям). */
  liar?: { readonly info: LiarInfo; readonly average: { avg: number; games: number } | null } | null;
  /** PD-180: время партии — личный рекорд своей сложности (для «удивлён»). Считает экран, у которого есть история (Today). */
  personalBest?: boolean;
  /**
   * PD-260: партию решили только что (переход «играю → решено» на этом экране) — клякса один раз «приземляется» после входа
   * карточки (макет PD-223 B). Повторное открытие, загрузка решённого дня, победа с другого устройства — только покой.
   */
  solvedNow?: boolean;
}

/**
 * Карточка результата (макет `.card`, состояние solved): «Your path» — тепловая карта порядка
 * заполнения (`heatmap(moveLog)` движка), легенда Early/Late, время, «clean»/правки, достигнутая
 * техника (`summary`), «N % solved today» и Share. Общая для Today и Play.
 */
export function ResultCard({ play, cardRef, title, winRate, winRateScope = "today", timelapse, hints, onOpenHelp, children, liar = null, personalBest = false, solvedNow = false }: ResultCardProps) {
  const { t } = useTranslation();
  const tl = useTimelapseEntry(play, timelapse?.date ?? null, timelapse?.difficulty ?? null);
  // PD-203: партия Мелодии — «♪ Сыграть мелодию» под картой пути (вариант A); мелодии нет (лог урезан) — кнопки нет.
  const tune = useCardTune(play);
  const openTl = (kind: "player" | "export") => {
    tune.stop(false); // один источник звука за раз: таймлапс сам решает, звучать ли
    tl.open(kind);
  };
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
  // PD-180: питомец-клякса (тумблер в Настройках, выкл по умолчанию). Настроение выводится из партии, не хранится.
  const petOn = usePetEnabled();
  const mood = useMemo(
    () => (petOn ? petMood(petDayOfPlay(play, true, { hints, liar: liar?.info ?? null, personalBest })) : null),
    [petOn, play, hints, liar, personalBest],
  );
  return (
    <section className={`card${mood ? " has-pet" : ""}`} ref={cardRef} tabIndex={-1} aria-labelledby="result-title" data-testid="result-card">
      <h2 id="result-title" className={ink ? "ink-h2" : undefined}>
        {title}
        {ink && <InkChip />}
      </h2>
      <p className="sub">
        {t("result.pathSub")}
        {ink && ` ${t("ink.cardSub")}`}
      </p>
      {/* Клякса стоит в правом верхнем углу (absolute), а в DOM — после заголовка: VoiceOver сначала читает «Solved». */}
      {mood && (
        <div className="pet-slot" data-testid="pet-card">
          <PetBlot mood={mood} size={44} act={solvedNow ? "arrive" : undefined} actDelay={ARRIVE_DELAY_MS} />
        </div>
      )}
      <div
        className={`heat${tl.available ? " tl-tap" : ""}${tune.reveal ? " revealing" : ""}`}
        role="img"
        aria-label={t("result.heatLabel")}
        data-testid="heat"
        onClick={tl.available ? () => openTl("player") : undefined}
      >
        <HeatCells heat={heat} blots={blots} hinted={hinted} reveal={tune.reveal} />
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
      {tune.available && <TuneButton playing={tune.playing} live={tune.live} onToggle={tune.toggle} />}
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
        {liar && <LiarRows info={liar.info} />}
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
      {liar && <LiarCompare info={liar.info} average={liar.average} />}
      {winRate != null && (
        <p className="winrate" data-testid="winrate">
          {t(winRateScope === "day" ? "result.winRateDay" : "result.winRate", { percent: Math.round(winRate) })}
        </p>
      )}
      {tl.enabled && <WatchRow available={tl.available} onWatch={() => openTl("player")} />}
      {/* Share — PNG-отпечаток без цифр (PD-75), вторичное действие (PD-129): главное на карточке — «Watch your solve».
          Нет цельного лога — нечем делиться, и кнопки нет вовсе (не серая: мёртвая кнопка путает; у дня без лога
          вместо Watch — тихая строка). */}
      {tl.available && (
        <button type="button" className="share" data-testid="share" onClick={() => openTl("export")}>
          <ShareIcon />
          {t("solved.share")}
        </button>
      )}
      {children}
      {tl.sheets}
    </section>
  );
}
