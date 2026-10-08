import { useTranslation } from "react-i18next";
import { InspectIcon, LanternModeIcon } from "./modeIcons";

/**
 * PD-210: строка статуса Фонаря вместо «осталось N» (макет PD-209 §2 п. 5, §5, §6, §7):
 *
 * - `dark` — нет выбранной клетки (свет пуст): «Коснитесь клетки — загорятся её строка, столбец и блок» / «Коснитесь клетки»;
 * - `hold` — осмотр удержанием: «Осмотр доски — отпустите палец, чтобы вернуться» / «Осмотр»;
 * - `menu` — осмотр из ⋯: «Осмотр доски» + кнопка «Готово» (44 pt); тап по полю тоже завершает (Board).
 *
 * Форма — по месту в зазоре, как строка Мелодии (PD-206): зазор — size-контейнер (его размер не зависит от строки, поле не
 * прыгает), полная форма — только если ширина гарантирует одну/две строки и высота их держит, иначе короткая в одну строку;
 * AX3 — короткая всегда, а у `menu` при AX3 остаются значок и «Готово» (иначе на 320 pt uk «Огляд» + «Готово» не входят).
 * Полный текст — всегда доступное имя (clip-path, не display:none). Пороги — styles/lantern.css (тест держит их вместе).
 */
export type LanternStatusKind = "dark" | "hold" | "menu";

export function LanternStatus({ kind, onDone }: { kind: LanternStatusKind; onDone: () => void }) {
  const { t } = useTranslation();
  const Icon = kind === "dark" ? LanternModeIcon : InspectIcon;
  return (
    <div className={`status lantern-status ls-${kind}`} data-testid="lantern-status" data-kind={kind}>
      <Icon className="ls-ic" />
      <span className="ls-long">{t(`lantern.status.${kind}`)}</span>
      <span className="ls-short" aria-hidden="true">
        {t(`lantern.status.${kind}Short`)}
      </span>
      {kind === "menu" && (
        <button type="button" className="ls-done" onClick={onDone} data-testid="inspect-done">
          {t("lantern.done")}
        </button>
      )}
    </div>
  );
}
