/**
 * Хаб вкладки Play — раскладка C (PD-167; макет design/pd163-modes-layout.html, выбран владельцем): одна страница,
 * сгруппированный список, без стека экранов и без закреплённой «Начать».
 *
 * - «Продолжить» — ТОЛЬКО незавершённый день (тап → вкладка Today). Слот дня хаб только читает (`useDaySlot`). Нет дня — нет
 *   и секции. Игры режимов живут в строках своих режимов (вторая дверь в ту же игру не нужна).
 * - «Режимы» — строка на каждый ГОТОВЫЙ режим реестра (`modes.ts`), порядок фиксированный: значок, имя, описание в 1–2
 *   строки; есть незавершённая игра режима — вместо описания статус «● Не закончена · Сложно · осталось 47 · 03:18».
 *   Тап: есть игра — она открывается; нет — шит режима (описание + сложность + «Начать»), его открывает экран.
 * - Долгое нажатие / правая кнопка / клавиша меню на строке — контекстное меню режима (`ModeMenu`): описание, «Продолжить»,
 *   «Новая сетка…» (шит с предупреждением), PD-225 — «Удалить сетку».
 * - PD-225: строка с незавершённой игрой свайпается справа налево — «Удалить» (`SwipeRow`, design/pd224-swipe-gestures.md).
 *   Строки «Продолжить» (игры дня) не свайпаются.
 * - Под списком — сноска «Свои игры не попадают в ваш год».
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SlotSummary } from "./daySlot";
import { useDaySlot } from "./daySlot";
import { CalendarGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import { LiarModeIcon } from "./modeIcons";
import type { ModeDef, ModeId } from "./modes";
import { ModeMenu } from "./ModeMenu";
import { slotMeta } from "./slotMeta";
import { ModeRowBody, SwipeRow, useSwipeHub } from "./SwipeRow";

export interface PlaySetupProps {
  /** Строки списка — готовые режимы реестра (`availableModes()`), в их порядке. */
  readonly modes: readonly ModeDef[];
  /** Незавершённые игры по режимам. */
  readonly slots: Partial<Record<ModeId, SlotSummary>>;
  /** Растёт на каждый повторный тап по вкладке Play: закрыть оверлеи и прокрутить хаб наверх. */
  readonly reselect: number;
  /** Тап по строке режима (`opener` — строка, на неё вернётся фокус). */
  readonly onOpenMode: (mode: ModeId, opener: HTMLElement) => void;
  /** «Новая сетка…» из контекстного меню: шит режима (при незавершённой игре — с предупреждением). */
  readonly onNewInMode: (mode: ModeId, opener: HTMLElement) => void;
  readonly onOpenToday: () => void;
  /** PD-171: незаконченный Лжец дня (тоже «игра дня») — вторая строка «Продолжить»; `null` — нет. */
  readonly liarDay?: SlotSummary | null;
  readonly onOpenLiarDay?: () => void;
  /** PD-225: удалить незаконченную игру режима (свайп, «Удалить», пункт меню). `kbd` — путь клавиатуры/AT. */
  readonly onDeleteMode?: (mode: ModeId, kbd: boolean) => void;
  /** PD-225: открылось контекстное меню строки (экран убирает тост отмены: меню/шиты выше него). */
  readonly onMenuOpen?: () => void;
}

interface MenuState {
  readonly mode: ModeDef;
  readonly row: HTMLButtonElement;
  readonly anchor: { top: number; bottom: number; left: number; width: number; height: number };
}

export function PlaySetup({ modes, slots, reselect, onOpenMode, onNewInMode, onOpenToday, liarDay = null, onOpenLiarDay, onDeleteMode, onMenuOpen }: PlaySetupProps) {
  const { t } = useTranslation();
  const day = useDaySlot();
  const scroll = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRow = useRef<HTMLElement | null>(null);
  menuRow.current = menu?.row ?? null;
  const swipe = useSwipeHub(scroll);

  // Повторный тап по вкладке Play: оверлеи закрываются первыми, на хабе — прокрутка вверх (без подтверждений).
  const seen = useRef(reselect);
  useEffect(() => {
    if (seen.current === reselect) return;
    seen.current = reselect;
    setMenu(null);
    swipe.closeOpen(false);
    scroll.current?.scrollTo?.({ top: 0 });
  }, [reselect]);

  const openMenu = (mode: ModeDef, row: HTMLButtonElement) => {
    swipe.closeOpen(false);
    onMenuOpen?.();
    const r = row.getBoundingClientRect();
    setMenu({ mode, row, anchor: { top: r.top, bottom: r.bottom, left: r.left, width: r.width, height: r.height } });
  };

  return (
    <>
      <div ref={scroll} className="hub-scroll" data-testid="hub-scroll">
        {(day || liarDay) && (
          <section className="hub-sec" aria-labelledby="hub-cont-head" data-testid="hub-continue">
            <p id="hub-cont-head" className="hub-head">
              {t("play.hub.contHead")}
            </p>
            <div className="hub-card">
              {day && (
                <button type="button" className="hub-row two" onClick={onOpenToday} data-testid="continue-day">
                  <span className="l1">
                    <CalendarGlyph className="glyph" />
                    <b>{t("play.hub.contDay")}</b>
                    {day.ink && (
                      <span className="mode-chip" data-testid="continue-ink-chip">
                        {t("ink.chip")}
                      </span>
                    )}
                  </span>
                  <span className="l2">{slotMeta(t, day)}</span>
                  <ChevronIcon className="chev" />
                </button>
              )}
              {liarDay && (
                <button type="button" className="hub-row two" onClick={() => onOpenLiarDay?.()} data-testid="continue-liar-day">
                  <span className="l1">
                    <LiarModeIcon className="glyph" />
                    <b>{t("liar.daily")}</b>
                  </span>
                  <span className="l2">{slotMeta(t, liarDay)}</span>
                  <ChevronIcon className="chev" />
                </button>
              )}
            </div>
          </section>
        )}

        <section className="hub-sec" aria-labelledby="hub-modes-head" data-testid="hub-modes">
          <p id="hub-modes-head" className="hub-head">
            {t("modes.head")}
          </p>
          <div className="hub-card">
            {modes.map((m) => (
              <SwipeRow
                key={m.id}
                mode={m}
                slot={slots[m.id] ?? null}
                hub={swipe}
                onPress={(row) => onOpenMode(m.id, row)}
                onLongPress={(row) => openMenu(m, row)}
                onDelete={(kbd) => onDeleteMode?.(m.id, kbd)}
              />
            ))}
          </div>
          <p className="hub-foot" data-testid="hub-foot">
            {t("modes.foot")}
          </p>
        </section>
      </div>

      {menu && (
        <ModeMenu
          mode={menu.mode}
          anchor={menu.anchor}
          preview={
            // Та же разметка, что у строки (`.hub-row.mode`): без неё копия в портале теряет стили строки (огромный значок/шеврон).
            <div className="hub-row mode" data-testid="ctx-preview">
              <ModeRowBody mode={menu.mode} slot={slots[menu.mode.id] ?? null} />
            </div>
          }
          canContinue={slots[menu.mode.id] !== undefined}
          onContinue={() => onOpenMode(menu.mode.id, menu.row)}
          onNew={() => onNewInMode(menu.mode.id, menu.row)}
          onDelete={onDeleteMode ? (kbd) => onDeleteMode(menu.mode.id, kbd) : undefined}
          onClose={() => setMenu(null)}
          returnFocus={menuRow}
        />
      )}
    </>
  );
}
