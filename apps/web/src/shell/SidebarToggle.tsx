import { useTranslation } from "react-i18next";
import { SIDEBAR_ID, useDeskLayout, useSidebarView } from "./desk";

/** Значок «боковая панель» (макет pd229, `I.sidebar`): рамка окна с полосой слева. Штрих 1.7, как у значков вкладок. */
function SidebarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

/**
 * Кнопка «Скрыть/Показать боковую панель» — первая в тулбаре (шапке) экрана, в левом верхнем углу контента, в обоих состояниях
 * (макет C, `tb()`). PD-267: живёт в самой шапке (TabHeader, навбар Settings/справки), а не поверх неё.
 */
export function SidebarToggle({ hidden, onToggle, overlay = false }: { hidden: boolean; onToggle: () => void; overlay?: boolean }) {
  const { t } = useTranslation();
  const label = t(hidden ? "desk.showSidebar" : "desk.hideSidebar");
  return (
    <button
      type="button"
      className="side-toggle"
      aria-label={label}
      title={label}
      aria-controls={SIDEBAR_ID}
      // PD-268: на компакте сайдбар — всплывающая панель поверх контента: кнопка её раскрывает.
      aria-expanded={overlay ? !hidden : undefined}
      onClick={onToggle}
      data-testid="sidebar-toggle"
    >
      <SidebarIcon />
    </button>
  );
}

/**
 * PD-267: кнопка сайдбара для шапки экрана — только в раскладке C; на телефоне ничего не рисует (DOM прежний). PD-268: на компакте
 * она показывает сайдбар поверх контента (не запоминается), в полной раскладке — прячет/показывает его (запоминается).
 */
export function DeskSidebarToggle() {
  const desk = useDeskLayout();
  const { hidden, compact, toggle } = useSidebarView();
  return desk ? <SidebarToggle hidden={hidden} onToggle={toggle} overlay={compact} /> : null;
}
