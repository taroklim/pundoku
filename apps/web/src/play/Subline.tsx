import type { ReactNode } from "react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { NibIcon } from "./inkIcons";

interface SublineProps {
  /** «Wed 30 Sep»; пусто — часть пропускается. */
  day: string;
  /** «Medium»; `null` — пока неизвестно. */
  difficulty: string | null;
  /** Чернильный режим (PD-74): слово режима в подписи («Wed 30 Sep · Medium · ink»), без иконки. */
  ink?: boolean;
  /** PD-139: партия отмечена «с помощью» — слово в подписи рядом с датой (как слово режима чернил). */
  help?: boolean;
  /** Тихий таймер; `null` — не показывать. */
  clock?: string | null;
  /** PD-144: чип «Ink» в конце подписи партии Play (не часть склейки « · »; Today остаётся со словом режима). */
  inkChip?: boolean;
}

/**
 * Подпись дня под заголовком экрана: части разделены « · » (с пробелами по обе стороны, как текстом, а не
 * `::before` — в макете PD-69 разделитель перед словом режима терял пробел: «Medium· Ink»). Слово режима —
 * отдельный элемент `.inkmark`: чернила + Semibold, в forced-colors подчёркнуто (ink.css); по слову, а не по цвету.
 *
 * PD-144 (D-2): на экране партии подпись — ОДНА строка (резерв `--chrome` считает одну): сложность усекается многоточием,
 * время и метки не переносятся, а когда текст не помещается (крупный Dynamic Type, узкий экран) слова «с подсказкой»/«Ink» схлопываются
 * в значки (`.hm-ic`/`.chip-ic`; слово остаётся именем для скринридера и в `title`). Правила — play.css, контейнер-запрос.
 */
export function Subline({ day, difficulty, ink = false, help = false, clock = null, inkChip = false }: SublineProps) {
  const { t } = useTranslation();
  const parts: ReactNode[] = [];
  if (day) parts.push(<span key="day" className="sub-day">{day}</span>);
  if (difficulty) parts.push(<span key="diff" className="sub-diff">{difficulty}</span>);
  if (ink) {
    parts.push(
      <span key="ink" className="inkmark" data-testid="ink-mark">
        {t("ink.mode")}
      </span>,
    );
  }
  if (help) {
    parts.push(
      <span key="help" className="helpmark" data-testid="help-mark" title={t("hint.mark")}>
        <i className="hm-ic" aria-hidden="true" />
        <span className="chip-t">{t("hint.mark")}</span>
      </span>,
    );
  }
  if (clock !== null) {
    parts.push(
      <span key="clock" className="clock">
        {clock}
      </span>,
    );
  }
  return (
    <p className="subline">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 ? <span className="sep"> · </span> : null}
          {part}
        </Fragment>
      ))}
      {inkChip && (
        <span className="mode-chip" data-testid="ink-chip" title={t("ink.chip")}>
          <NibIcon className="chip-ic" />
          <span className="chip-t">{t("ink.chip")}</span>
        </span>
      )}
    </p>
  );
}
