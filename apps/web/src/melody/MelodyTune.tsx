/**
 * «♪ Сыграть мелодию» на карточке решённой партии Мелодии (PD-203, макет PD-202 §4, вариант A — решение владельца).
 *
 * Кнопка — под картой пути. Нажали: карта пути гаснет и проявляется заново в порядке ходов вместе с нотами (`onStep`),
 * текущая клетка — в кольце; кнопка становится «■ Остановить». Конец мелодии — кнопка возвращается, карта целиком.
 * VoiceOver: live-region «Играет мелодия» / «Остановлено», имя кнопки меняется вместе с текстом.
 *
 * Звук запущен явно — пункт «Звук» партии на него не действует (макет §2 п. 11). Ядро своё, создаётся в обработчике нажатия
 * (это и есть жест разблокировки), закрывается при размонтировании. Один источник звука за раз: старт глушит хвост
 * партии; открыли таймлапс, ушли с экрана, свернули PWA — стоп без автопродолжения.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MelodyModeIcon } from "../play/modeIcons";
import type { PlayState } from "../play/logic";
import type { MelodyAudio, PathPlayback } from "./audio";
import { makeMelodyAudio } from "./factory";
import { silenceGameAudio } from "./game";
import { StopIcon } from "./icons";
import { cardTuneOf } from "./tune";

/** Проявление карты под ноты: показанные клетки и текущая (`-1` — ещё ни одной). `null` — мелодия не играет. */
export interface HeatReveal {
  readonly shown: ReadonlySet<number>;
  readonly cur: number;
}

/** Живые проигрывания карточки — чтобы таймлапс мог их остановить («один источник звука за раз»). */
const playing = new Set<() => void>();
export function stopCardTunes(): void {
  [...playing].forEach((stop) => stop());
}

export function useCardTune(play: PlayState) {
  const tune = useMemo(() => (play.melody === true ? cardTuneOf(play) : null), [play]);
  const [reveal, setReveal] = useState<HeatReveal | null>(null);
  const [live, setLive] = useState("");
  const audio = useRef<MelodyAudio | null>(null);
  const pb = useRef<PathPlayback | null>(null);

  const stop = useCallback((announce = true) => {
    const p = pb.current;
    if (p === null) return;
    pb.current = null;
    p.stop();
    setReveal(null);
    if (announce) setLive("stopped");
  }, []);

  useEffect(() => {
    const s = () => stop();
    playing.add(s);
    const onHide = () => {
      if (document.visibilityState === "hidden") stop();
    };
    const onPageHide = () => stop();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      playing.delete(s);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", onPageHide);
      pb.current?.stop();
      pb.current = null;
      audio.current?.dispose();
      audio.current = null;
    };
  }, [stop]);

  const toggle = () => {
    if (tune === null) return;
    if (pb.current !== null) {
      stop();
      return;
    }
    silenceGameAudio();
    if (audio.current === null) audio.current = makeMelodyAudio();
    audio.current.unlock(); // обработчик нажатия — жест
    const shown = new Set<number>();
    setReveal({ shown, cur: -1 });
    setLive("playing");
    const p = audio.current.playPath(tune, {
      onStep: (e) => {
        shown.add(e.cell);
        setReveal({ shown: new Set(shown), cur: e.cell });
      },
      onEnd: () => {
        if (pb.current !== p) return;
        pb.current = null;
        // Последняя нота ещё звучит — карта целиком, кнопка возвращается.
        setReveal(null);
        setLive("stopped");
      },
    });
    pb.current = p;
  };

  return { available: tune !== null, playing: reveal !== null, reveal, live, toggle, stop };
}

/** Кнопка под картой пути + live-region. */
export function TuneButton({ playing, live, onToggle }: { playing: boolean; live: string; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <>
      <button type="button" className="tune" onClick={onToggle} data-testid="melody-tune" data-playing={playing ? "true" : "false"}>
        {playing ? <StopIcon /> : <MelodyModeIcon />}
        <span>{playing ? t("melody.stop") : t("melody.tune")}</span>
      </button>
      <p className="sr-only" role="status" aria-live="polite" data-testid="melody-live">
        {live === "playing" ? t("melody.livePlaying") : live === "stopped" ? t("melody.liveStopped") : ""}
      </p>
    </>
  );
}
