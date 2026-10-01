/**
 * Чернильный режим в карточке дня (PD-74, макет PD-69 §2.5): тихий чип «Ink», строка «Blots — N» вместо «Corrections»,
 * клякса в тепловой карте — сургуч со сколотым углом. Отдельный файл: карточка общая для Today/Play/Year, в ней — только
 * вызовы этих компонентов (правки общих файлов минимальны).
 */
import type { HeatCell } from "./heat";
import { useTranslation } from "react-i18next";
import { NibIcon } from "./inkIcons";
import type { PlayState } from "./logic";
import { blotsIn } from "./logic";

/** Тихий чип режима: hairline, `--label-2`, перо 12 px; слово, не цвет. */
export function InkChip() {
  const { t } = useTranslation();
  return (
    <span className="ink-chip" data-testid="ink-chip">
      <NibIcon className="nib" />
      {t("ink.chip")}
    </span>
  );
}

/** Клетки-кляксы партии (пусто, если партия не чернильная). */
export function blotCellSet(play: PlayState): ReadonlySet<number> {
  return new Set(play.ink === true ? blotsIn(play).map((b) => b.cell) : []);
}

/** Тепловая карта: обычные клетки — чернила по порядку, подсказки — контур, кляксы — сургуч со сколотым углом (`.b`). */
export function HeatCells({ heat, blots }: { heat: readonly HeatCell[]; blots: ReadonlySet<number> }) {
  return (
    <>
      {heat.map((o, i) =>
        blots.has(i) ? (
          <i key={i} className="b" data-blot="true" />
        ) : o === null ? (
          <i key={i} className="g" />
        ) : (
          <i key={i} style={{ opacity: o }} data-o={o} />
        ),
      )}
    </>
  );
}

/** Строка «Blots — N» (вместо «Corrections»): сургуч, если кляксы были; чистая партия остаётся «clean». */
export function BlotsRow({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <div className="row" data-testid="blots-row">
      <dt>{t("ink.rowBlots")}</dt>
      <dd className={count > 0 ? "wax err" : undefined}>{count > 0 ? count : t("solved.clean")}</dd>
    </div>
  );
}

/** Строка Year «Mode · Ink · N blots» / «Ink · clean» без клякс (шит дня; как «clean» в карточке и PNG, PD-86). */
export function InkModeValueRow({ count }: { count: number }) {
  const { t } = useTranslation();
  return (
    <div className="row" data-testid="ink-mode-row">
      <dt>{t("ink.rowMode")}</dt>
      <dd>{count > 0 ? t("ink.yearValue", { count }) : t("ink.yearClean")}</dd>
    </div>
  );
}
