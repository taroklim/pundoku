/**
 * Подсказки в карточке результата (PD-139, макет PD-133 §10): ряд «Hints — N» между «Corrections» и «Technique reached»,
 * слово «with help» в подписи дня, полая середина у клеток тепловой карты, к которым вела подсказка. Отдельный файл — как
 * `inkCard.tsx`: карточка общая для Today/Play/Year, в ней только вызовы этих компонентов.
 */
import { useTranslation } from "react-i18next";
import type { PlayState } from "./logic";

/** Клетки, к которым вела результативная подсказка (карта показывает позицию, не цифру). Пусто без подсказок. */
export function hintCellSet(play: Pick<PlayState, "hintLog">): ReadonlySet<number> {
  const out = new Set<number>();
  for (const e of play.hintLog ?? []) if (e.cell !== null) out.add(e.cell);
  return out;
}

/** Сколько подсказок взято: счётчик записи, а если его нет (запись из снапшота без `hints`) — длина журнала. */
export function hintCount(play: Pick<PlayState, "hintLog">, hints?: number): number {
  return Math.max(hints ?? 0, play.hintLog?.length ?? 0);
}

/** Ряд «Hints — N». Рисуется только при N > 0 (правило ряда «Blots»: пустое не показываем). */
export function HintsRow({ count }: { count: number }) {
  const { t } = useTranslation();
  if (count <= 0) return null;
  return (
    <div className="row" data-testid="hints-row">
      <dt>{t("solved.hints")}</dt>
      <dd>{count}</dd>
    </div>
  );
}
