import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { HELP_BLOCKS, type HelpBlockId } from "./blocks";

/** Метки года в справке: класс метки (как в легенде Year) и ключ названия/пояснения. «Late» выглядит как «Missed» (контур): год хранит его пропуском. */
const YEAR_ROWS = [
  { id: "solved", mark: "is-solved", name: "year.legend.solved" },
  { id: "fixes", mark: "is-solved has-corr", name: "year.legend.corrections" },
  { id: "help", mark: "is-solved has-help", name: "year.legend.help" },
  { id: "late", mark: "is-missed", name: "help.year.lateName" },
  { id: "unfinished", mark: "is-unfinished", name: "year.legend.unfinished" },
  { id: "missed", mark: "is-missed", name: "year.legend.missed" },
] as const;

/** События, по которым понятно, что человек сам прокручивает: подравнивание блока прекращается. */
const USER_SCROLL = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="19" height="19">
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

interface HelpScreenProps {
  /** Блок, к которому прокрутить (ссылка «What's this?» на карточке дня); `null` — с начала. */
  block: HelpBlockId | null;
  /** Подпись кнопки «‹ …» (куда вернёт) и её озвучка. */
  backName: string;
  backLabel: string;
  onBack: () => void;
}

/**
 * «How Pundoku works» (PD-120): справка о четырёх собственных вещах продукта — Grid ∞, Fixes, «Technique reached»,
 * метки Year — и подписи счётчиков. Шесть блоков по 2–3 строки, без картинок и туториала поверх игры: это место, куда
 * заглядывают сами (HIG onboarding.md: объяснение, которое можно найти позже, в Settings). Push-экран с «‹ Назад».
 * Тексты — правда по движку (`help.*` в i18n); число «30–60» для Grid ∞ измерено, см. README.
 */
export function HelpScreen({ block, backName, backLabel, onBack }: HelpScreenProps) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);

  // Ссылка из карточки: прокрутить к блоку и поставить на него фокус (скринридер читает заголовок блока); иначе — на h1.
  // Отступ сверху даёт `scroll-margin-top` у `.help-head` (кольцо фокуса и заголовок не срезаются краем области прокрутки).
  useEffect(() => {
    const el = root.current;
    const target = block ? el?.querySelector<HTMLElement>(`#help-h-${block}`) : el?.querySelector<HTMLElement>("h1");
    if (!el || !target) return;
    target.focus({ preventScroll: true });
    if (!block) return;
    const align = () => target.scrollIntoView?.({ block: "start" }); // в jsdom метода нет
    align();
    // Прокрутка первого кадра считает по ещё не осевшей раскладке: (1) панель входит с подъёмом 6 px (`.panel.enter`, M10) — без
    // повтора после animationend блок оставался на 6 px выше, чем надо (заголовок и кольцо фокуса срезались); (2) WebKit
    // перекладывает текст уже после первой прокрутки (hyphens: auto / смена lang). Пока раскладка оседает (≤ 2 с), подравниваем,
    // но стоит человеку самому тронуть прокрутку — отпускаем.
    if (typeof ResizeObserver === "undefined") return;
    const scroller = el.closest(".scroll") ?? el;
    const panel = el.closest(".panel");
    const ro = new ResizeObserver(align);
    const onPanelAnim = (e: Event) => e.target === panel && align();
    const stop = () => {
      ro.disconnect();
      clearTimeout(timer);
      panel?.removeEventListener("animationend", onPanelAnim);
      for (const ev of USER_SCROLL) scroller.removeEventListener(ev, stop);
    };
    const timer = setTimeout(stop, 2000);
    ro.observe(el);
    panel?.addEventListener("animationend", onPanelAnim);
    for (const ev of USER_SCROLL) scroller.addEventListener(ev, stop, { passive: true });
    return stop;
  }, [block]);

  return (
    <div className="settings help" ref={root} data-testid="help-screen">
      <header className="settings-navbar">
        <button type="button" className="settings-back" onClick={onBack} aria-label={backLabel} data-testid="help-back">
          <BackIcon />
          <span>{backName}</span>
        </button>
      </header>
      <h1 className="settings-large" tabIndex={-1}>
        {t("help.title")}
      </h1>

      {HELP_BLOCKS.map((id) => (
        <section key={id} className="settings-sec help-sec" aria-labelledby={`help-h-${id}`} data-testid={`help-${id}`}>
          <h2 className="settings-head help-head" id={`help-h-${id}`} tabIndex={-1}>
            {t(`help.${id}.title`)}
          </h2>
          <div className="settings-card help-card">
            {id === "grid" && (
              <>
                <p>{t("help.grid.p1")}</p>
                <p>{t("help.grid.p2", { enough: t("today.gridSolvable") })}</p>
                <p>{t("help.grid.p3")}</p>
              </>
            )}
            {id === "fixes" && (
              <>
                <p>{t("help.fixes.p1")}</p>
                <p>{t("help.fixes.p2")}</p>
              </>
            )}
            {id === "technique" && (
              <>
                <p>{t("help.technique.p1")}</p>
                <p>{t("help.technique.p2")}</p>
                <p>{t("help.technique.p3")}</p>
              </>
            )}
            {id === "hints" && (
              <>
                <p>{t("help.hints.p1")}</p>
                <p>{t("help.hints.p2")}</p>
                <p>{t("help.hints.p3")}</p>
              </>
            )}
            {id === "year" && (
              <>
                <p>{t("help.year.lead")}</p>
                <dl className="help-marks">
                  {YEAR_ROWS.map((r) => (
                    <div key={r.id} className="help-mark">
                      <dt>
                        <i className={`ymark ${r.mark}`} aria-hidden="true" />
                        {t(r.name)}
                      </dt>
                      <dd>{t(`help.year.${r.id}`)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {id === "counter" && (
              <>
                <p>{t("help.counter.p1")}</p>
                <p>{t("help.counter.p2")}</p>
              </>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
