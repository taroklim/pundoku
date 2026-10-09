import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { GearIcon } from "./icons";
import { DeskSidebarToggle } from "./SidebarToggle";

interface TabHeaderProps {
  /** Заголовок вкладки: `<h1 className="title">` или собственный (у Year — выбор года). */
  title: ReactNode;
  /** Контролы вкладки слева от шестерёнки (Play — сложность); необязательно. */
  actions?: ReactNode;
  /** Открыть Settings. Нет — шестерёнки нет (тесты отдельных экранов без оболочки). */
  onOpenSettings?: () => void;
  /** PD-144: контрол ПОСЛЕ шестерёнки (меню «⋯» партии Play): порядок лампочка · шестерёнка · «⋯». */
  trailing?: ReactNode;
  /**
   * PD-267: тулбар партии десктопа C (макет pd229 C, `tb()`): заголовок и под ним подпись партии одним блоком, высота 52 px.
   * Передаётся ТОЛЬКО в раскладке с сайдбаром — на телефоне подпись остаётся отдельной строкой под шапкой (DOM прежний).
   */
  sub?: ReactNode;
  /** PD-267: элемент перед заголовком тулбара партии («‹ Year» архивного дня); только вместе с `sub`. */
  lead?: ReactNode;
}

/**
 * Шапка вкладки (PD-123): заголовок слева, справа — шестерёнка настроек. Одна и та же на Today, Play и Year, чтобы
 * настройки не «исчезали» при смене вкладки (HIG: действие тулбара живёт на одном месте на всех корневых экранах).
 * Цель нажатия 44 × 44 (`.gear-btn`), подпись — `settings.open`. Архивный день шапку не использует (там «‹ Year»).
 * PD-267: в раскладке с сайдбаром первая в шапке — кнопка сайдбара (`DeskSidebarToggle`, на телефоне её нет).
 */
export function TabHeader({ title, actions, onOpenSettings, trailing, sub, lead }: TabHeaderProps) {
  const { t } = useTranslation();
  const desk = sub !== undefined;
  return (
    <header className={desk ? "toolbar desk-tb" : "toolbar"} data-testid="tab-header">
      <DeskSidebarToggle />
      {desk && lead}
      {desk ? (
        <div className="desk-tt">
          {title}
          {sub}
        </div>
      ) : (
        title
      )}
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
