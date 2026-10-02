import type { Timelapse } from "@pundoku/engine";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatClock, formatDay } from "./format";
import type { PlayState } from "./logic";
import { MiniField, ReplayField } from "./ReplayField";
import { timelapseOf } from "./timelapse";
import { LoopIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon } from "./timelapseIcons";
import type { TimelapseSpeed } from "./timelapseModel";
import { BUDGET_MS, LOOP_HOLD_MS, contactStages, firstBlotFrames, frameAt, hintTickMoves, moveIndex, playbackSchedule } from "./timelapseModel";
import { TimelapseSheetShell } from "./TimelapseSheetShell";

const SPEEDS: readonly TimelapseSpeed[] = ["slow", "normal", "fast"];

/** Reduce Motion системы — читается вживую (тумблер в Настройках меняет его без перезапуска). */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof matchMedia === "function" && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== "function") return;
    const mq = matchMedia(query);
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface TimelapseSheetProps {
  play: PlayState;
  date: string;
  difficulty: string | null;
  onClose: () => void;
}

/**
 * Таймлапс своего решения (макет PD-69 §3, решения владельца 2026-10-01). По умолчанию — контактный лист из
 * девяти этапов, без движения; анимация запускается отдельной кнопкой. Плеер: поле, «Move a of N», ползунок по
 * ходам, транспорт (повтор, ‹, ▶/⏸, ›), скорость Slow/Normal/Fast (≈60/30/15 с на партию, пауза ≤ 6 % бюджета).
 * При Reduce Motion плеер открывается пошагово: на паузе, без скорости и повтора, смена кадра — только
 * затухание (≤ 140 мс) и пояснение. Заметки не играются.
 */
export function TimelapseSheet({ play, date, difficulty, onClose }: TimelapseSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const reduced = useReducedMotion();
  const tl: Timelapse | null = useMemo(
    () => timelapseOf({ solved: true, mission: play.mission.join(""), play }, { maxGapMs: Infinity }),
    [play],
  );
  const frames = tl?.frames ?? [];
  const n = Math.max(0, frames.length - 1);
  const blots = useMemo(() => firstBlotFrames(frames), [frames]);
  // Счёт и скраббер — в ходах игрока, не в кадрах (PD-80): пара «клякса → замена» — один ход.
  const moves = useMemo(() => moveIndex(frames), [frames]);
  const ticks = useMemo(() => hintTickMoves(frames, play.hintLog), [frames, play.hintLog]);
  const helped = Math.max(play.hintLog?.length ?? 0, 0);
  const stages = useMemo(() => contactStages(moves.count).map((m) => moves.frameOf[m]!), [moves]);

  const [mode, setMode] = useState<"contact" | "player">("contact");
  const [idx, setIdx] = useState(0);
  const moveNow = moves.moveNo[idx] ?? 0;
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState<TimelapseSpeed>("normal");
  const [animate, setAnimate] = useState(false);
  const idxRef = useRef(0);
  const step = reduced;
  // В пошаговом режиме скорость и повтор скрыты — играем обычным темпом и без повтора.
  const effSpeed: TimelapseSpeed = step ? "normal" : speed;
  const effLoop = step ? false : loop;
  const sched = useMemo(() => playbackSchedule(frames, BUDGET_MS[effSpeed]), [frames, effSpeed]);

  const go = useCallback((i: number, anim: boolean) => {
    idxRef.current = i;
    setIdx(i);
    setAnimate(anim);
  }, []);

  // Reduce Motion включили на ходу — остановиться (пошаговый режим не анимирует сам).
  useEffect(() => {
    if (reduced) setPlaying(false);
  }, [reduced]);

  useEffect(() => {
    if (!playing || mode !== "player") return;
    let raf = 0;
    let base = sched.offsets[idxRef.current] ?? 0;
    let t0 = performance.now();
    let holdUntil = 0;
    const tick = (now: number) => {
      if (holdUntil) {
        if (now >= holdUntil) {
          holdUntil = 0;
          base = 0;
          t0 = now;
          go(0, false);
        }
        raf = requestAnimationFrame(tick);
        return;
      }
      const el = base + (now - t0);
      const want = frameAt(sched.offsets, el);
      if (want !== idxRef.current) go(want, true);
      if (want >= n) {
        if (effLoop) {
          holdUntil = now + LOOP_HOLD_MS;
          raf = requestAnimationFrame(tick);
        } else {
          setPlaying(false);
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, mode, sched, n, effLoop, go]);

  if (tl === null || n === 0) return null;

  const dayLine = [formatDay(new Date(`${date}T12:00:00`), locale), difficulty ? t(`difficulty.${difficulty}`) : null, formatClock(tl.sourceDurationMs), helped > 0 ? t("timelapse.hints", { count: helped }) : null]
    .filter(Boolean)
    .join(" · ");

  // M11 (решение владельца 2026-10-01): плеер НЕ стартует сам — открывается на паузе на первом кадре,
  // проигрывание запускает только кнопка ▶. Так и при обычном движении, и при Reduce Motion.
  const start = () => {
    setMode("player");
    go(0, false);
    setPlaying(false);
  };
  const toggle = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (idxRef.current >= n) go(0, false);
    setPlaying(true);
  };
  const stepBy = (d: number) => {
    setPlaying(false);
    const next = (moves.moveNo[idxRef.current] ?? 0) + d;
    if (next >= 0 && next <= moves.count) go(moves.frameOf[next]!, true);
  };

  return (
    <TimelapseSheetShell title={t("timelapse.title")} sub={dayLine} onClose={onClose} testId="timelapse-sheet">
      {mode === "contact" ? (
        <div data-testid="tl-contact">
          <div className="tl-contact" role="group" aria-label={t("timelapse.contactNote")}>
            {stages.map((s) => (
              <figure key={s}>
                <MiniField frames={frames} idx={s} mission={play.mission} blots={blots} />
                <figcaption>{formatClock(frames[s]!.t)}</figcaption>
              </figure>
            ))}
          </div>
          <p className="tl-note">{t("timelapse.contactNote")}</p>
          <div className="tl-actions">
            <button type="button" className="tl-start" data-testid="tl-start" onClick={start}>
              <PlayIcon outline />
              <span>{t("timelapse.startPlayer")}</span>
            </button>
          </div>
        </div>
      ) : (
        <div data-testid="tl-player" data-step={step ? "true" : "false"}>
          <ReplayField frames={frames} idx={idx} mission={play.mission} blots={blots} animate={animate} label={t("timelapse.boardLabel")} />
          <div className="tl-meta">
            <span role="status" aria-live={playing ? "off" : "polite"} data-testid="tl-move">
              {t("timelapse.moveOf", { a: moveNow, b: moves.count })}
            </span>
            <span className="mono" data-testid="tl-clock">
              {formatClock(frames[idx]!.t)} / {formatClock(tl.sourceDurationMs)}
            </span>
          </div>
          <div className="tl-scrub-wrap">
            {moves.count > 0 && ticks.length > 0 && (
              <div className="tl-ticks" aria-hidden="true" data-testid="tl-ticks">
                {ticks.map((m) => (
                  <i key={m} data-move={m} style={{ ["--f" as string]: m / moves.count }} />
                ))}
              </div>
            )}
            <input
              type="range"
              className="tl-scrub"
              min={0}
              max={moves.count}
              step={1}
              value={moveNow}
              aria-label={t("timelapse.scrub")}
              data-testid="tl-scrub"
              onChange={(e) => {
                setPlaying(false);
                go(moves.frameOf[Number(e.target.value)] ?? 0, false);
              }}
            />
          </div>
          <div className="tl-transport">
            {!step && (
              <button type="button" className="tbtn" aria-pressed={loop} aria-label={t("timelapse.repeat")} data-testid="tl-loop" onClick={() => setLoop((v) => !v)}>
                <LoopIcon />
              </button>
            )}
            <button type="button" className="tbtn" aria-label={t("timelapse.prev")} aria-disabled={moveNow <= 0} data-testid="tl-prev" onClick={() => stepBy(-1)}>
              <PrevIcon />
            </button>
            <button type="button" className="tbtn big" aria-label={playing ? t("timelapse.pause") : t("timelapse.play")} data-testid="tl-play" onClick={toggle}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" className="tbtn" aria-label={t("timelapse.next")} aria-disabled={moveNow >= moves.count} data-testid="tl-next" onClick={() => stepBy(1)}>
              <NextIcon />
            </button>
            {!step && (
              <div className="tl-seg" role="group" aria-label={t("timelapse.speed")} data-testid="tl-speed">
                {SPEEDS.map((s) => (
                  <button key={s} type="button" aria-pressed={speed === s} data-speed={s} onClick={() => setSpeed(s)}>
                    {t(`timelapse.${s}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="tl-note" data-testid="tl-note">
            {step ? t("timelapse.stepNote") : t("timelapse.rhythm")}
          </p>
          <div className="tl-actions">
            <button
              type="button"
              className="tl-quiet"
              data-testid="tl-back"
              onClick={() => {
                setPlaying(false);
                setMode("contact");
              }}
            >
              {t("timelapse.backToStages")}
            </button>
          </div>
        </div>
      )}
    </TimelapseSheetShell>
  );
}
