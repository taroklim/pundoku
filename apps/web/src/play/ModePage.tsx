import type { Difficulty } from "@pundoku/engine";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { EDITABLE, overlayOpen } from "../shell/escapeBack";
import { useTabActive } from "../shell/tabSlide";
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
 * Ширина колонки — 480 по макету (`modeDetail(true)`); хаб вокруг — колонка 640 (PD-269, styles/desk-screens.css).
 *
 * PD-269: «Start ↩» (макет C, аудит PD-228 п. 9) — Enter запускает партию. Как у шита режима (PD-232 в): страница открылась —
 * фокус на «Start» (Enter/пробел нажимают её нативно), если «Start» ничего не отбрасывает; иначе («Start new») ни фокуса, ни
 * чипа, ни Enter — фокус остаётся, где был. Фокус ушёл со страницы на фон (клик по пустому месту) — Enter тоже «Start»; на
 * другой кнопке (сайдбар, Лжец дня, шестерёнка) Enter нажимает её, в поле ввода и при открытом шите/меню — не наш.
 */
export function ModePage({ mode, pick, discard, onPick, onStart, daily = null }: ModePageProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const diffId = useId();
  const active = useTabActive();
  const root = useRef<HTMLElement>(null);
  const start = useRef<HTMLButtonElement>(null);
  const latest = useRef(onStart);
  latest.current = onStart;
  const enter = discard === null;

  // Открыли страницу (другой режим, вернулись на вкладку) — фокус на «Start». Только пока вкладка видна: скрытая панель inert.
  useEffect(() => {
    if (!enter || !active) return;
    start.current?.focus({ preventScroll: true });
  }, [enter, active, mode.id]);

  useEffect(() => {
    if (!enter || !active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || e.isComposing || e.repeat) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest(EDITABLE) || overlayOpen()) return;
      // Фон документа, сама страница или строка сложности (у радио Enter своего действия нет) — «Start»; любая другая
      // кнопка — её собственное действие.
      const mine = el === null || el === document.body || el === document.documentElement || (root.current?.contains(el) === true && (el === root.current || el.closest('[role="radio"]') !== null));
      if (!mine) return;
      e.preventDefault();
      latest.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enter, active]);

  const { Icon } = mode;
  return (
    <section ref={root} className="mode-page" aria-labelledby={titleId} data-testid="mode-page" data-mode={mode.id}>
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
      <button
        ref={start}
        type="button"
        className="hub-primary mp-start"
        onClick={onStart}
        aria-keyshortcuts={enter ? "Enter" : undefined}
        data-testid="mode-page-start"
      >
        <span>{discard ? t("modes.startNew") : t("modes.start")}</span>
        {enter && (
          <kbd className="mp-key" aria-hidden="true" data-testid="mode-page-enter">
            ↩
          </kbd>
        )}
      </button>
    </section>
  );
}
