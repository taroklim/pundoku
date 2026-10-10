import type { KeyboardEvent } from "react";
import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Wordmark } from "../brand/Wordmark";
import { cellsLeft } from "../play/logic";
import type { ModeId } from "../play/modes";
import { availableModes } from "../play/modes";
import { playStore } from "../play/store";
import type { PlayScreenSnapshot } from "../play/store";
import { dayStore } from "../today/dayStore";
import { SIDEBAR_ID, useDeskState } from "./desk";
import { TabIcon } from "./icons";
import type { TabId } from "./tabs";

/** Что выделено в сайдбаре: раздел, режим Play (второй уровень) или ничего (Settings, справка). */
export type SidebarItem = TabId | ModeId | null;

export { SIDEBAR_ID };

/**
 * Выбранный пункт: на Play — режим партии на доске (Лжец дня — это режим Лжец), страница режима или сам Play (хаб, восстановление).
 */
export function currentItem(section: TabId | null, play: Pick<PlayScreenSnapshot, "hub" | "mode" | "restoring">, modePage: ModeId | null): SidebarItem {
  if (section !== "play") return section;
  if (play.restoring === true) return "play";
  if (!play.hub) return play.mode;
  return modePage ?? "play";
}

interface SidebarProps {
  /** Раздел на экране; `null` — открыт Settings или справка (ни один пункт не выбран, макет §2). Архив — раздел Year. */
  readonly section: TabId | null;
  /** Скрыт кнопкой: остаётся в DOM (`hidden`), чтобы `aria-controls` кнопки указывал на него. */
  readonly hidden: boolean;
  readonly onSelectTab: (tab: TabId) => void;
  readonly onSelectMode: (mode: ModeId) => void;
}

/**
 * PD-266: сайдбар десктопа C (design/pd229-desktop.html, `sidebar()`; md §3 C). Плавающая стеклянная панель слева: вордмарк,
 * Today (с остатком клеток идущего дня), Play и его режимы вторым уровнем, Year. Это та же навигация, что таб-бар телефона,
 * плюс режимы в один клик. Выбор — `aria-current="page"`; стрелки ↑/↓ (Home/End) ходят по пунктам, Enter/пробел выбирают.
 *
 * Стекло — единственное в этой раскладке (таб-бар скрыт), с непрозрачным фолбэком `--glass-solid` (styles/desk.css).
 */
export function Sidebar({ section, hidden, onSelectTab, onSelectMode }: SidebarProps) {
  const { t } = useTranslation();
  const day = useSyncExternalStore(dayStore.subscribe, dayStore.getSnapshot);
  const play = useSyncExternalStore(playStore.subscribe, playStore.getSnapshot);
  const { modePage } = useDeskState();
  // Слоты перечитываются при каждом изменении стора Play (подписка выше) — статус «не закончена» у режимов.
  const slots = playStore.slots();
  const current = currentItem(section, play, modePage);
  const todayLeft = day.phase === "playing" && day.play !== null ? cellsLeft(day.play) : null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button.side-it")];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (e.key) {
      case "ArrowDown":
        next = at < 0 ? 0 : Math.min(items.length - 1, at + 1);
        break;
      case "ArrowUp":
        next = at < 0 ? 0 : Math.max(0, at - 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    items[next]?.focus();
  };

  const tabItem = (id: TabId, meta?: string | null) => (
    <button
      type="button"
      className="side-it"
      aria-current={current === id ? "page" : undefined}
      onClick={() => onSelectTab(id)}
      data-testid={`side-${id}`}
    >
      <TabIcon tab={id} />
      <span className="side-lab">{t(`tabs.${id}`)}</span>
      {meta && <span className="side-meta">{meta}</span>}
    </button>
  );

  return (
    <nav id={SIDEBAR_ID} className="sidebar" aria-label={t("tabs.label")} hidden={hidden} onKeyDown={onKeyDown} data-testid="sidebar">
      <div className="side-brand">
        <Wordmark height={22} />
      </div>
      {tabItem("today", todayLeft !== null ? t("play.cellsLeftShort", { count: todayLeft }) : null)}
      {tabItem("play")}
      <ul className="side-sub" aria-label={t("modes.head")}>
        {availableModes().map((m) => {
          const { Icon } = m;
          return (
            <li key={m.id}>
              <button
                type="button"
                className="side-it subi"
                aria-current={current === m.id ? "page" : undefined}
                onClick={() => onSelectMode(m.id)}
                data-testid={`side-mode-${m.id}`}
              >
                <Icon />
                <span className="side-lab">{t(`modes.${m.textKey}.name`)}</span>
                {slots[m.id] && <span className="side-meta">{t("desk.inProgress")}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="side-gap" aria-hidden="true" />
      {tabItem("year")}
    </nav>
  );
}
