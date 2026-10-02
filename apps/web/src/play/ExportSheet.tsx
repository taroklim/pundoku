import { summary, timelapseFingerprint } from "@pundoku/engine";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { renderFingerprintPng, shareFingerprint } from "./fingerprint";
import type { FpCaption } from "./fingerprint";
import { formatClock } from "./format";
import { ShareIcon } from "./icons";
import type { PlayState } from "./logic";
import { timelapseOf } from "./timelapse";
import { blotCount, moveIndex } from "./timelapseModel";
import { TimelapseSheetShell } from "./TimelapseSheetShell";

/** «30 Sep 2026 · 8:14 · 51 moves · clean» — подпись под сеткой PNG (owner: `clean` либо `N blots`; правки без кляксы — `N fixes`). */
export function fingerprintCaption(
  t: TFunction,
  locale: string,
  input: { date: string; durationMs: number; moves: number; blots: number; corrections: number; clean: boolean },
): FpCaption {
  // День-месяц-год во всех языках («30 Sep 2026»): порядок задаём сами, названия месяцев берём из Intl.
  const at = new Date(`${input.date}T12:00:00`);
  const part = (o: Intl.DateTimeFormatOptions, type: Intl.DateTimeFormatPartTypes) =>
    new Intl.DateTimeFormat(locale, o).formatToParts(at).find((p) => p.type === type)?.value ?? "";
  const day = [part({ day: "numeric" }, "day"), part({ month: "short" }, "month"), part({ year: "numeric" }, "year")].join(" ");
  const tail =
    input.blots > 0
      ? t("timelapse.fpBlots", { count: input.blots })
      : input.clean
        ? t("timelapse.fpClean")
        : t("timelapse.fpCorrections", { count: input.corrections });
  return { left: "Pundoku", right: [day, formatClock(input.durationMs), t("timelapse.fpMoves", { count: input.moves }), tail].join(" · ") };
}

interface ExportSheetProps {
  play: PlayState;
  date: string;
  onClose: () => void;
}

/**
 * Экспорт отпечатка (макет PD-69 §7, решение владельца: стиль Rhythm, без выбора стиля). Предпросмотр — сам PNG
 * (`<img>` из того же Blob, что уйдёт в Share: картинка и файл не могут разойтись), всегда светлый. PNG готовится при
 * открытии, чтобы `navigator.share` вызывался прямо из жеста (iOS). «Share» — системный лист iOS; без него — скачивание.
 */
export function ExportSheet({ play, date, onClose }: ExportSheetProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? "en";
  const data = useMemo(() => {
    const mission = play.mission.join("");
    const solution = play.solution.join("");
    const tl = timelapseOf({ solved: true, mission, play }, { maxGapMs: Infinity });
    const fp = timelapseFingerprint(play.log, { mission, solution }, { maxGapMs: Infinity });
    const sum = summary(play.log);
    return { mission, fp, tl, sum };
  }, [play]);
  const caption = useMemo(
    () =>
      fingerprintCaption(t, locale, {
        date,
        durationMs: data.sum.durationMs,
        moves: data.tl ? moveIndex(data.tl.frames).count : 0,
        blots: data.tl ? blotCount(data.tl.frames) : 0,
        corrections: data.sum.corrections,
        clean: data.sum.clean,
      }),
    [t, locale, date, data],
  );

  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    renderFingerprintPng(data.fp, data.mission, caption).then(
      (b) => {
        if (alive) setBlob(b);
      },
      () => {
        if (alive) setFailed(true);
      },
    );
    return () => {
      alive = false;
    };
  }, [data, caption]);

  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);

  const share = () => {
    if (!blob) return;
    void shareFingerprint(blob, `pundoku-${date}.png`, "Pundoku").then(
      (o) => setSaved(o === "downloaded"),
      () => setFailed(true),
    );
  };

  return (
    <TimelapseSheetShell title={t("timelapse.fpTitle")} sub={t("timelapse.fpSub")} onClose={onClose} testId="export-sheet">
      <div className="tl-fp-frame">
        {url ? (
          <img className="tl-fp" src={url} width={1080} height={1350} alt={t("timelapse.fpLabel")} data-testid="fp-image" />
        ) : (
          <div className="tl-fp tl-fp-wait" aria-hidden="true" />
        )}
      </div>
      <p className="tl-note">{t("timelapse.fpRhythmSub")}</p>
      <div className="tl-share-block">
        <button type="button" className="tl-primary" data-testid="fp-share" disabled={!blob} onClick={share}>
          <ShareIcon />
          <span>{t("solved.share")}</span>
        </button>
        <p className="tl-note" role="status" aria-live="polite" data-testid="fp-status">
          {failed ? t("timelapse.fpFailed") : saved ? t("timelapse.fpSaved") : blob ? t("timelapse.fpSize") : t("timelapse.fpPreparing")}
        </p>
      </div>
    </TimelapseSheetShell>
  );
}
