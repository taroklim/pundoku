import type { ReactNode } from "react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

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
 */
export function Subline({ day, difficulty, ink = false, help = false, clock = null, inkChip = false }: SublineProps) {
  const { t } = useTranslation();
  const parts: ReactNode[] = [];
  if (day) parts.push(day);
  if (difficulty) parts.push(difficulty);
  if (ink) {
    parts.push(
      <span key="ink" className="inkmark" data-testid="ink-mark">
        {t("ink.mode")}
      </span>,
    );
  }
  if (help) {
    parts.push(
      <span key="help" className="helpmark" data-testid="help-mark">
        {t("hint.mark")}
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
          {i > 0 ? " · " : null}
          {part}
        </Fragment>
      ))}
      {inkChip && (
        <span className="mode-chip" data-testid="ink-chip">
          {t("ink.chip")}
        </span>
      )}
    </p>
  );
}
