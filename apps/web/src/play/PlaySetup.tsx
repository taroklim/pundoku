/**
 * Шаг «New puzzle» экрана Play (PD-74, макет PD-69 §2.1): inset-список «Difficulty / Ink mode» + сноска + «Start».
 * Строка сложности — нативный `select` поверх строки (прозрачный, на всю её площадь): системный пикер iOS, без нового
 * контрола; строка режима открывает шит правил.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES } from "@pundoku/engine";
import type { ChangeEvent } from "react";
import { useTranslation } from "react-i18next";
import { InkModeRow, useInkChoice } from "./InkEntry";
import { ChevronIcon } from "./inkIcons";

export interface PlaySetupProps {
  difficulty: Difficulty;
  ink: boolean;
  onDifficulty: (d: Difficulty) => void;
  onInk: (on: boolean) => void;
  onStart: () => void;
}

export function PlaySetup({ difficulty, ink, onDifficulty, onInk, onStart }: PlaySetupProps) {
  const { t } = useTranslation();
  const { press, sheet } = useInkChoice(ink, onInk);
  const change = (e: ChangeEvent<HTMLSelectElement>) => onDifficulty(e.target.value as Difficulty);
  return (
    <div className="play-setup" data-testid="play-setup">
      <p className="sect-head">{t("ink.playGroup")}</p>
      <div className="ink-list inset">
        <label className="ink-row ink-row-select">
          <span className="row-t">{t("play.difficulty")}</span>
          <span className="row-v" aria-hidden="true">
            {t(`difficulty.${difficulty}`)}
          </span>
          <ChevronIcon className="chev" />
          <select className="row-select" value={difficulty} onChange={change} data-testid="setup-difficulty">
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {t(`difficulty.${d}`)}
              </option>
            ))}
          </select>
        </label>
        <InkModeRow on={ink} onPress={press} />
      </div>
      <p className="ink-foot inset">{t("ink.footPlay")}</p>
      <div className="setup-start">
        <button type="button" className="ink-primary" onClick={onStart} data-testid="setup-start">
          {t("ink.playStart")}
        </button>
      </div>
      {sheet}
    </div>
  );
}
