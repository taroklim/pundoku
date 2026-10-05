/**
 * Лжец в карточке результата и в Year (PD-171, план режимов §1.2): «ход обвинения» (сколько цифр поставлено до поимки), с первого
 * ли обвинения, неверные обвинения, время поимки и сравнение с собой («твой средний ход обвинения — N»: серверной статистики нет).
 * Отдельный файл, как `inkCard.tsx`: карточка общая для Today/Play/Year, в ней — только вызовы этих компонентов.
 */
import { useTranslation } from "react-i18next";
import { formatClock } from "./format";
import type { LiarInfo } from "./savedPlay";

/** Строки «Лжец пойман — ход 29», «Обвинения — с первого раза / 2 неверных», «Пойман на — 4:12». */
export function LiarRows({ info }: { info: LiarInfo }) {
  const { t } = useTranslation();
  if (!info.caught) return null;
  return (
    <>
      <div className="row" data-testid="liar-move-row">
        <dt>{t("liar.rowMove")}</dt>
        <dd>{info.catchPlacement ?? "—"}</dd>
      </div>
      <div className="row" data-testid="liar-accuse-row">
        <dt>{t("liar.rowAccusations")}</dt>
        <dd className={info.firstTry ? undefined : "err"}>{info.firstTry ? t("liar.firstTry") : t("liar.wrong", { count: info.wrongAccusations })}</dd>
      </div>
      {info.catchT !== null && (
        <div className="row" data-testid="liar-time-row">
          <dt>{t("liar.rowCaughtAt")}</dt>
          <dd className="mono">{formatClock(info.catchT)}</dd>
        </div>
      )}
    </>
  );
}

/** Сравнение с собой под строками: «Твой средний ход обвинения — 31 (4 партии)»; первая поимка — «сравнить пока не с чем». */
export function LiarCompare({ info, average }: { info: LiarInfo; average: { avg: number; games: number } | null }) {
  const { t } = useTranslation();
  if (!info.caught) return null;
  return (
    <p className="winrate liar-compare" data-testid="liar-compare">
      {average ? t("liar.compare", { avg: average.avg, count: average.games }) : t("liar.compareFirst")}
    </p>
  );
}

/** Строка шита дня Year: «Лжец дня — пойман, ход 29 · с первого раза». */
export function LiarYearRow({ info }: { info: LiarInfo }) {
  const { t } = useTranslation();
  const value = info.caught
    ? [t("liar.yearCaught", { move: info.catchPlacement ?? "—" }), info.firstTry ? t("liar.firstTry") : t("liar.wrong", { count: info.wrongAccusations })].join(" · ")
    : t("liar.yearNotCaught");
  return (
    <div className="row" data-testid="liar-year-row">
      <dt>{t("liar.yearRow")}</dt>
      <dd>{value}</dd>
    </div>
  );
}
