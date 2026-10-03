import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GearIcon } from "./icons";

interface TabHeaderProps {
  /** Заголовок вкладки: `<h1 className="title">` или собственный (у Year — выбор года). */
  title: ReactNode;
  /** Контролы вкладки слева от шестерёнки (Play — сложность); необязательно. */
  actions?: ReactNode;
  /** Открыть Settings. Нет — шестерёнки нет (тесты отдельных экранов без оболочки). */
  onOpenSettings?: () => void;
  /** PD-144: контрол ПОСЛЕ шестерёнки (меню «⋯» партии Play): порядок лампочка · шестерёнка · «⋯». */
  trailing?: ReactNode;
}

/**
 * Шапка вкладки (PD-123): заголовок слева, справа — шестерёнка настроек. Одна и та же на Today, Play и Year, чтобы
 * настройки не «исчезали» при смене вкладки (HIG: действие тулбара живёт на одном месте на всех корневых экранах).
 * Цель нажатия 44 × 44 (`.gear-btn`), подпись — `settings.open`. Архивный день шапку не использует (там «‹ Year»).
 */
export function TabHeader({ title, actions, onOpenSettings, trailing }: TabHeaderProps) {
  const { t } = useTranslation();
  return (
    <header className="toolbar" data-testid="tab-header">
      {title}
      {(actions || onOpenSettings || trailing) && (
        <div className="toolbar-end">
          {actions}
          {onOpenSettings && (
            <button type="button" className="gear-btn" onClick={onOpenSettings} aria-label={t("settings.open")} data-testid="open-settings">
              <GearIcon />
            </button>
          )}
          {trailing}
        </div>
      )}
    </header>
  );
}
