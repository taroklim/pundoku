import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES, summary } from "@pundoku/engine";
import type { ChangeEvent, KeyboardEvent, RefObject } from "react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Board } from "./Board";
import { formatClock, formatDay } from "./format";
import { EraseIcon, NotesIcon, ShareIcon, UndoIcon } from "./icons";
import { cellsLeft, remaining } from "./logic";
import { playStore } from "./store";

const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Тихий таймер: перечитывает часы хранилища; ставится на паузу самим хранилищем. */
function useClock(): string {
  const [text, setText] = useState(() => formatClock(playStore.getElapsedMs()));
  useEffect(() => {
    const tick = () => setText(formatClock(playStore.getElapsedMs()));
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, []);
  return text;
}

/** Ключевые пороги остатка для озвучки: каждые 10 клеток и последние пять. */
const isMilestone = (left: number): boolean => left > 0 && (left % 10 === 0 || left <= 5);

/**
 * Объявление «N cells left» для скринридера — не на каждую цифру: только на порогах
 * (кратно 10 и последние 5), с debounce 600 мс и без повтора уже озвученного значения.
 * Возвращает текст для live-региона.
 */
function useCellsLeftAnnouncement(left: number, active: boolean, startedAt: number): string {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const last = useRef<number | null>(null);
  useEffect(() => {
    // Новая партия — сбрасываем, чтобы пороги озвучивались заново.
    last.current = null;
    setText("");
  }, [startedAt]);
  useEffect(() => {
    if (!active || !isMilestone(left) || last.current === left) return;
    const id = window.setTimeout(() => {
      last.current = left;
      setText(t("play.cellsLeft", { count: left }));
    }, 600);
    return () => window.clearTimeout(id);
  }, [left, active, t]);
  return text;
}

/**
 * Экран Play (PD-11): подпись дня с тихим таймером → поле B Boxes → строка статуса «N cells left»
 * → панель 1–9 в один ряд с остатками → Notes / Undo / Erase. Партия локальная, на движке.
 */
export function PlayScreen() {
  const { t, i18n } = useTranslation();
  const snap = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
  const clock = useClock();
  const { phase, play, difficulty } = snap;

  useEffect(() => {
    playStore.ensureStarted();
    playStore.setTabActive(true);
    return () => playStore.setTabActive(false);
  }, []);

  // «Решено»: сначала данные гаснут до 60 % (240 мс), затем карточка (см. макет, M5-прелюдия).
  const [cardShown, setCardShown] = useState(false);
  useEffect(() => {
    if (phase !== "solved") {
      setCardShown(false);
      return;
    }
    const id = window.setTimeout(() => setCardShown(true), prefersReducedMotion() ? 140 : 240);
    return () => window.clearTimeout(id);
  }, [phase]);

  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (cardShown) cardRef.current?.focus({ preventScroll: true });
  }, [cardShown]);

  const locale = i18n.resolvedLanguage ?? "en";
  const interactive = phase === "playing" && play !== null;
  const left = play ? cellsLeft(play) : 81;
  const rem = play ? remaining(play) : null;
  const announcement = useCellsLeftAnnouncement(left, interactive, snap.startedOn.getTime());

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("select, input, textarea")) return;
    if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ") {
      e.preventDefault();
      playStore.undo();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    // По e.code, а не e.key: Shift+1 даёт «!», Alt+1 на Mac — спецсимвол.
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m) {
      e.preventDefault();
      // Shift/Alt — временно противоположный режим (цифра ↔ заметка), пока клавиша зажата.
      playStore.input(Number(m[1]), e.shiftKey || e.altKey);
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      playStore.erase();
    } else if (e.code === "KeyN" && !e.altKey && !e.shiftKey) {
      playStore.toggleNotesMode();
    }
  };

  const onDifficulty = (e: ChangeEvent<HTMLSelectElement>) => {
    playStore.newGame(e.target.value as Difficulty);
  };

  const dayLabel = formatDay(snap.startedOn, locale);
  const diffLabel = t(`difficulty.${difficulty}`);
  const showClock = phase === "playing" || phase === "solved";
  const canUndo = interactive && (play?.undoStack.length ?? 0) > 0;

  return (
    <div className="play" onKeyDown={onKeyDown}>
      {/* Live-регион для скринридера: «N cells left» только на порогах (см. хук выше). */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      <header className="toolbar">
        <h1 className="title">{t("tabs.play")}</h1>
        {/* ПРОВИЗОРНО (PD-11): выбор сложности — минимальный нативный контрол, которого нет в
            утверждённом макете; владелец его не утверждал. Смена сложности начинает новую партию. */}
        <select
          className="difficulty"
          aria-label={t("play.difficulty")}
          value={difficulty}
          onChange={onDifficulty}
        >
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>
              {t(`difficulty.${d}`)}
            </option>
          ))}
        </select>
      </header>
      <p className="subline">
        {dayLabel} · {diffLabel}
        {showClock && (
          <>
            {" · "}
            <span className="clock">{clock}</span>
          </>
        )}
      </p>

      {phase === "solved" && cardShown ? (
        <SolvedCard cardRef={cardRef} />
      ) : (
        <>
          <Board snap={snap} store={playStore} dim={phase === "solved"} />

          {/* Свободное место — МЕЖДУ полем и панелью (макет, находка 1); в зазоре — статус. */}
          <div className="gap">
            {phase === "loading" && (
              <p className="status" role="status">
                {t("play.preparing")}
              </p>
            )}
            {phase === "error" && (
              <p className="status" role="alert">
                {t("play.failed")}{" "}
                <button type="button" className="link" onClick={() => playStore.newGame()}>
                  {t("play.retry")}
                </button>
              </p>
            )}
            {(phase === "playing" || phase === "solved") && (
              <p className="status">{t("play.cellsLeft", { count: left })}</p>
            )}
          </div>

          <div className="pad-wrap">
            <div className="pad" role="group" aria-label={t("pad.label")}>
              {DIGITS.map((d) => {
                const n = rem ? Math.max(0, rem[d] as number) : 9;
                return (
                  <button
                    key={d}
                    type="button"
                    className={`key${rem && n === 0 ? " done" : ""}`}
                    aria-label={t("pad.key", { digit: d, n })}
                    disabled={!interactive}
                    onClick={() => playStore.input(d)}
                  >
                    <span className="kd" aria-hidden="true">
                      {d}
                    </span>
                    <span className="kr" aria-hidden="true">
                      {rem ? n : ""}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="actions">
              <button
                type="button"
                className="act"
                aria-pressed={snap.notesMode}
                disabled={!interactive}
                onClick={() => playStore.toggleNotesMode()}
              >
                <NotesIcon />
                <span>{t("actions.notes")}</span>
              </button>
              <button
                type="button"
                className="act"
                aria-disabled={!canUndo}
                onClick={() => playStore.undo()}
              >
                <UndoIcon />
                <span>{t("actions.undo")}</span>
              </button>
              <button type="button" className="act" disabled={!interactive} onClick={() => playStore.erase()}>
                <EraseIcon />
                <span>{t("actions.erase")}</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Карточка «решено» (макет B-light-solved). В PD-11 — только то, что есть в макете и уже
 * считается по логу ходов: время, правки, техника. Тепловая карта пути и «% решивших сегодня» —
 * PD-12; Share (PNG без цифр) — PD-12, до тех пор кнопка неактивна.
 */
function SolvedCard({ cardRef }: { cardRef: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const snap = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
  const log = snap.play?.log ?? [];
  const sum = summary(log);
  return (
    <section className="card" ref={cardRef} tabIndex={-1} aria-labelledby="solved-title">
      <h2 id="solved-title">{t("solved.title")}</h2>
      {/* TODO(PD-12): «Your path» — тепловая карта (engine.heatmap) + легенда Early/Late. */}
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
      {/* TODO(PD-12): «N % solved today» (win_rate) — нужны данные сервера. */}
      {/* TODO(PD-12): Share — PNG-карточка без цифр; пока кнопка неактивна. */}
      <button type="button" className="share" disabled>
        <ShareIcon />
        {t("solved.share")}
      </button>
      {/* ПРОВИЗОРНО (PD-11): «New game» — минимум, чтобы из «решено» можно было выйти; в макете нет. */}
      <button type="button" className="newgame" onClick={() => playStore.newGame()}>
        {t("solved.newGame")}
      </button>
    </section>
  );
}
