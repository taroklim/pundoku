/**
 * Хаб вкладки Play (PD-144, вариант C — макет design/pd144-play-c.html, утверждён владельцем 2026-10-03): одна страница,
 * сгруппированный список, без стека экранов.
 *
 * - «Продолжить» — два НЕЗАВИСИМЫХ слота: незавершённый день (тап → вкладка Today) и своя сетка (тап → доска на Play).
 *   Слот дня хаб только читает (`useDaySlot`), слот своей сетки — партия стора Play; ничто здесь не пишет в день.
 *   Нет ни одного слота — под заголовком подпись `play.hub.sub`, секции «Продолжить» нет.
 * - «Новая сетка» — сложность списком из пяти строк (`radiogroup`/`radio`), никакого нативного `select`. Подпись строки —
 *   число открытых клеток и техника ИЗ `DIFFICULTY_PROFILES` (цифры не зашиты в интерфейс).
 * - «Режим» — строка со значением (Классика/Чернила) → шит с двумя вариантами; сноска меняется с режимом.
 * - «Начать» закреплена над таб-баром. Шит «Отбросить эту сетку?» — только когда есть НЕЗАВЕРШЁННАЯ своя сетка
 *   (день этот шит никогда не вызывает: «Начать» его не затрагивает).
 * - Раздела режимов релиза 2 нет: только пустой `.hub-slot-gap` (позиция, не плашка).
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES, DIFFICULTY_PROFILES } from "@pundoku/engine";
import type { KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionSheet } from "../recovery/ActionSheet";
import type { SlotSummary } from "./daySlot";
import { useDaySlot } from "./daySlot";
import { formatClock } from "./format";
import { CalendarGlyph, CheckGlyph, GridGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import { ModeSheet } from "./ModeSheet";

/** Техника профиля сложности → ключ подписи (`play.hub.tech.*`). Неизвестная техника — без подписи техники. */
const TECH_KEY: Readonly<Record<string, string>> = { hidden_single: "singles", locked_candidates: "locked", hidden_pair: "pairs", beyond: "beyond" };

export interface PlaySetupProps {
  readonly pick: Difficulty;
  readonly ink: boolean;
  /** Незавершённая своя сетка (слот «Продолжить»); `null` — нет. */
  readonly own: SlotSummary | null;
  /** Растёт на каждый повторный тап по вкладке Play: закрыть оверлеи и прокрутить хаб наверх. */
  readonly reselect: number;
  readonly onPick: (d: Difficulty) => void;
  readonly onInk: (on: boolean) => void;
  readonly onStart: () => void;
  readonly onResume: () => void;
  readonly onOpenToday: () => void;
}

export function PlaySetup({ pick, ink, own, reselect, onPick, onInk, onStart, onResume, onOpenToday }: PlaySetupProps) {
  const { t } = useTranslation();
  const day = useDaySlot();
  const scroll = useRef<HTMLDivElement>(null);
  const modeRow = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState(false);
  const [discard, setDiscard] = useState(false);

  // Повторный тап по вкладке Play: оверлеи закрываются первыми, на хабе — прокрутка вверх (без подтверждений).
  const seen = useRef(reselect);
  useEffect(() => {
    if (seen.current === reselect) return;
    seen.current = reselect;
    setMode(false);
    setDiscard(false);
    scroll.current?.scrollTo?.({ top: 0 });
  }, [reselect]);

  const meta = (s: SlotSummary): string => {
    const parts: string[] = [];
    if (s.difficulty) parts.push(t(`difficulty.${s.difficulty}`));
    parts.push(t("play.hub.left", { count: s.left }));
    parts.push(formatClock(s.elapsedMs));
    return parts.join(" · ");
  };

  const start = () => (own ? setDiscard(true) : onStart());

  return (
    <>
      {!day && !own && <p className="subline" data-testid="hub-sub">{t("play.hub.sub")}</p>}
      <div ref={scroll} className="hub-scroll" data-testid="hub-scroll">
        {(day || own) && (
          <section className="hub-sec" aria-labelledby="hub-cont-head" data-testid="hub-continue">
            <p id="hub-cont-head" className="hub-head">
              {t("play.hub.contHead")}
            </p>
            <div className="hub-card">
              {day && <ContinueRow kind="day" title={t("play.hub.contDay")} ink={day.ink} meta={meta(day)} onPress={onOpenToday} />}
              {own && <ContinueRow kind="own" title={t("play.hub.contFree")} ink={own.ink} meta={meta(own)} onPress={onResume} />}
            </div>
          </section>
        )}

        <section className="hub-sec">
          <p id="hub-new-head" className="hub-head">
            {t("play.newPuzzle")}
          </p>
          <DifficultyList pick={pick} onPick={onPick} />
        </section>

        <section className="hub-sec">
          <div className="hub-card">
            <button ref={modeRow} type="button" className="hub-row" aria-haspopup="dialog" onClick={() => setMode(true)} data-testid="mode-row">
              <span className="lab">{t("ink.rowMode")}</span>
              <span className="val" data-testid="mode-value">
                {ink ? t("play.hub.modeInk") : t("play.hub.modeClassic")}
              </span>
              <ChevronIcon className="chev" />
            </button>
          </div>
          <p className="hub-foot" data-testid="mode-foot">
            {ink ? t("play.hub.footInk") : t("play.hub.footClassic")}
          </p>
        </section>

        {/* Позиция раздела режимов релиза 2: ничего не нарисовано (решение владельца 2026-10-03). */}
        <div className="hub-slot-gap" aria-hidden="true" />
      </div>

      <div className="hub-bar">
        <button type="button" className="hub-primary" onClick={start} data-testid="setup-start">
          {t("play.hub.start")}
        </button>
      </div>

      {mode && <ModeSheet ink={ink} onPick={onInk} onClose={() => setMode(false)} returnFocus={modeRow} />}
      {discard && (
        <ActionSheet
          title={t("play.discardTitle")}
          message={t("play.discardMessage")}
          actionLabel={t("play.discard")}
          destructive
          cancelLabel={t("play.keepPlaying")}
          onAction={() => {
            setDiscard(false);
            onStart();
          }}
          onCancel={() => setDiscard(false)}
        />
      )}
    </>
  );
}

function ContinueRow({ kind, title, ink, meta, onPress }: { kind: "day" | "own"; title: string; ink: boolean; meta: string; onPress: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="hub-row two" onClick={onPress} data-testid={`continue-${kind}`}>
      <span className="l1">
        {kind === "day" ? <CalendarGlyph className="glyph" /> : <GridGlyph className="glyph" />}
        <b>{title}</b>
        {ink && (
          <span className="mode-chip" data-testid="continue-ink-chip">
            {t("ink.chip")}
          </span>
        )}
      </span>
      <span className="l2">{meta}</span>
      <ChevronIcon className="chev" />
    </button>
  );
}

/** Сложность списком из пяти строк: radiogroup, roving tabindex, стрелки двигают и выбирают (как у системной радиогруппы). */
function DifficultyList({ pick, onPick }: { pick: Difficulty; onPick: (d: Difficulty) => void }) {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<Difficulty, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = DIFFICULTIES.indexOf(pick);
    let next: number;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (i + 1) % DIFFICULTIES.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (i - 1 + DIFFICULTIES.length) % DIFFICULTIES.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = DIFFICULTIES.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const d = DIFFICULTIES[next] as Difficulty;
    onPick(d);
    refs.current[d]?.focus();
  };
  return (
    <div className="hub-card" role="radiogroup" aria-label={t("play.difficulty")} onKeyDown={onKeyDown} data-testid="difficulty-list">
      {DIFFICULTIES.map((d) => {
        const profile = DIFFICULTY_PROFILES[d];
        const tech = TECH_KEY[profile.technique];
        const sub = [t("play.hub.clues", { count: profile.clues }), tech ? t(`play.hub.tech.${tech}`) : null].filter(Boolean).join(" · ");
        const on = d === pick;
        return (
          <button
            key={d}
            ref={(node) => {
              refs.current[d] = node;
            }}
            type="button"
            className="hub-row diff"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onPick(d)}
            data-testid={`difficulty-${d}`}
          >
            <span className="lab">
              {t(`difficulty.${d}`)}
              <span className="sub">{sub}</span>
            </span>
            <span className="ck">
              <CheckGlyph />
            </span>
          </button>
        );
      })}
    </div>
  );
}
