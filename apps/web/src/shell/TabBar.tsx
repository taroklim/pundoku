import type { KeyboardEvent, Ref } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { TabIcon } from "./icons";
import type { TabId } from "./tabs";
import { TAB_IDS } from "./tabs";

export const tabDomId = (tab: TabId) => `tab-${tab}`;
export const panelDomId = (tab: TabId) => `panel-${tab}`;

interface TabBarProps {
  active: TabId;
  onSelect: (tab: TabId) => void;
  /**
   * PD-175: нажатие вкладки (pointerdown, до click) — движок слайда заранее рисует экран-цель за краем. Только мышь/трекпад
   * (`prewarmsOn`), не касание — PD-276.
   */
  onPrewarm?: (tab: TabId) => void;
  /** PD-161: пилюля выбранной вкладки — отдельный слой, её двигает движок перехода (`tabSlide.ts`). */
  pillRef?: Ref<HTMLSpanElement>;
}

/**
 * PD-276: прогрев по нажатию — только для мыши/трекпада. На iPhone (касание, а также Apple Pencil — `pen`) он съедал первый
 * тап: WebKit iOS между touchstart и синтетическим click следит за страницей (ContentChangeObserver) и, если за это время
 * что-то кликабельное стало из скрытого видимым, считает тап «наведением» (показ меню по hover) и click не шлёт вовсе.
 * Прогрев как раз снимает `visibility: hidden` с панели-цели (в ней кнопки), пусть и за краем экрана — кадрирование по
 * вьюпорту появилось только в WebKit trunk 2026-09-30 (bug 325690), в iOS его нет. Второй тап проходил, потому что панель
 * уже прогрета (до WARM_MS) и ничего не меняется. Исправление — не прогревать на касании вообще; у мыши этой эвристики нет.
 */
export const prewarmsOn = (pointerType: string): boolean => pointerType === "mouse";

/** Таб-бар: role=tablist, roving tabindex, стрелки влево/вправо (+ Home/End), автоактивация. */
export function TabBar({ active, onSelect, onPrewarm, pillRef }: TabBarProps) {
  const { t } = useTranslation();
  const refs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = TAB_IDS.indexOf(active);
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % TAB_IDS.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + TAB_IDS.length) % TAB_IDS.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = TAB_IDS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const id = TAB_IDS[next] as TabId;
    onSelect(id);
    refs.current[id]?.focus();
  };

  return (
    <div className="tabbar" role="tablist" aria-label={t("tabs.label")} onKeyDown={onKeyDown}>
      {/* Фон выбранной вкладки — пилюля (макет PD-158): переезжает transform'ом вместе со слайдом экрана. */}
      <span ref={pillRef} className="tab-pill" aria-hidden="true" />
      {TAB_IDS.map((id) => (
        <button
          key={id}
          ref={(node) => {
            refs.current[id] = node;
          }}
          id={tabDomId(id)}
          className="tab"
          type="button"
          role="tab"
          aria-selected={id === active}
          aria-controls={panelDomId(id)}
          tabIndex={id === active ? 0 : -1}
          onPointerDown={
            onPrewarm && id !== active
              ? (e) => {
                  if (prewarmsOn(e.pointerType)) onPrewarm(id);
                }
              : undefined
          }
          onClick={() => onSelect(id)}
        >
          <TabIcon tab={id} />
          <span className="lab">{t(`tabs.${id}`)}</span>
        </button>
      ))}
    </div>
  );
}
