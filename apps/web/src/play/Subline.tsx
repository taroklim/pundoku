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
  /** Тихий таймер; `null` — не показывать. */
  clock?: string | null;
}

/**
 * Подпись дня под заголовком экрана: части разделены « · » (с пробелами по обе стороны, как текстом, а не
 * `::before` — в макете PD-69 разделитель перед словом режима терял пробел: «Medium· Ink»). Слово режима —
 * отдельный элемент `.inkmark`: чернила + Semibold, в forced-colors подчёркнуто (ink.css); по слову, а не по цвету.
 */
export function Subline({ day, difficulty, ink = false, clock = null }: SublineProps) {
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
    </p>
  );
}
