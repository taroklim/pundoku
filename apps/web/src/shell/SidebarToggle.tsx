import { useTranslation } from "react-i18next";
import { deskStore, SIDEBAR_ID, useDeskLayout, useDeskState } from "./desk";

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
export function SidebarToggle({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const label = t(hidden ? "desk.showSidebar" : "desk.hideSidebar");
  return (
    <button type="button" className="side-toggle" aria-label={label} title={label} aria-controls={SIDEBAR_ID} onClick={onToggle} data-testid="sidebar-toggle">
      <SidebarIcon />
    </button>
  );
}

/** PD-267: кнопка сайдбара для шапки экрана — только в раскладке с сайдбаром; на телефоне и компакте ничего не рисует (DOM прежний). */
export function DeskSidebarToggle() {
  const desk = useDeskLayout();
  const { hidden } = useDeskState();
  return desk ? <SidebarToggle hidden={hidden} onToggle={deskStore.toggleHidden} /> : null;
}
