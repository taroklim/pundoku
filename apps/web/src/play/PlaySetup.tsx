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
 *   «Новая сетка…» (шит с предупреждением).
 * - Под списком — сноска «Свои игры не попадают в ваш год».
 */
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LONG_PRESS_MS } from "./controls";
import type { SlotSummary } from "./daySlot";
import { useDaySlot } from "./daySlot";
import { CalendarGlyph } from "./hubIcons";
import { ChevronIcon } from "./inkIcons";
import { LiarModeIcon } from "./modeIcons";
import type { ModeDef, ModeId } from "./modes";
import { ModeMenu } from "./ModeMenu";
import { slotMeta } from "./slotMeta";

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
}

/** Сдвиг пальца, после которого долгое нажатие считается прокруткой, а не нажатием. */
const MOVE_SLOP_PX = 10;

interface MenuState {
  readonly mode: ModeDef;
  readonly row: HTMLButtonElement;
  readonly anchor: { top: number; bottom: number; left: number; width: number; height: number };
}

export function PlaySetup({ modes, slots, reselect, onOpenMode, onNewInMode, onOpenToday, liarDay = null, onOpenLiarDay }: PlaySetupProps) {
  const { t } = useTranslation();
  const day = useDaySlot();
  const scroll = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRow = useRef<HTMLElement | null>(null);
  menuRow.current = menu?.row ?? null;

  // Повторный тап по вкладке Play: оверлеи закрываются первыми, на хабе — прокрутка вверх (без подтверждений).
  const seen = useRef(reselect);
  useEffect(() => {
    if (seen.current === reselect) return;
    seen.current = reselect;
    setMenu(null);
    scroll.current?.scrollTo?.({ top: 0 });
  }, [reselect]);

  const openMenu = (mode: ModeDef, row: HTMLButtonElement) => {
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
              <ModeRow
                key={m.id}
                mode={m}
                slot={slots[m.id] ?? null}
                onPress={(row) => onOpenMode(m.id, row)}
                onLongPress={(row) => openMenu(m, row)}
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
          onClose={() => setMenu(null)}
          returnFocus={menuRow}
        />
      )}
    </>
  );
}

/** Содержимое строки режима: значок · имя · описание или статус незавершённой игры · шеврон. */
function ModeRowBody({ mode, slot }: { mode: ModeDef; slot: SlotSummary | null }) {
  const { t } = useTranslation();
  const { Icon } = mode;
  return (
    <>
      <span className="mg">
        <Icon />
      </span>
      <span className="lab">
        <span className="l1">
          <b>{t(`modes.${mode.textKey}.name`)}</b>
        </span>
        {slot ? (
          <span className="sub prog" data-testid={`mode-status-${mode.id}`}>
            <span className="dot" aria-hidden="true" />
            {t("modes.status", { meta: slotMeta(t, slot) })}
          </span>
        ) : (
          <span className="sub" data-testid={`mode-desc-${mode.id}`}>
            {/* PD-210: у режима с длинным правилом в строке списка — первое предложение (`list`), целиком — в шите. */}
            {t([`modes.${mode.textKey}.list`, `modes.${mode.textKey}.desc`])}
          </span>
        )}
      </span>
      <ChevronIcon className="chev" />
    </>
  );
}

/**
 * Строка режима. Тап — `onPress`; долгое нажатие (≥ `LONG_PRESS_MS` без сдвига пальца), правая кнопка мыши или клавиша
 * контекстного меню — `onLongPress`; тап, закончивший долгое нажатие, `onPress` не вызывает. Системные выноска и лупа iOS
 * на строке подавлены в CSS (`-webkit-touch-callout`, `user-select`).
 */
function ModeRow({ mode, slot, onPress, onLongPress }: { mode: ModeDef; slot: SlotSummary | null; onPress: (row: HTMLButtonElement) => void; onLongPress: (row: HTMLButtonElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  /** Когда долгое нажатие открыло меню: хвост этого жеста (click, contextmenu) — не новый тап. */
  const firedAt = useRef<number | null>(null);
  const stop = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => stop, []);

  const open = () => {
    firedAt.current = Date.now();
    if (ref.current) onLongPress(ref.current);
  };

  return (
    <button
      ref={ref}
      type="button"
      className="hub-row mode"
      onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
        stop();
        firedAt.current = null;
        if (e.button !== 0) return;
        press.current = {
          timer: window.setTimeout(() => {
            press.current = null;
            open();
          }, LONG_PRESS_MS),
          x: e.clientX,
          y: e.clientY,
        };
      }}
      onPointerMove={(e) => {
        const p = press.current;
        if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP_PX) stop(); // это прокрутка, а не нажатие
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onContextMenu={(e: ReactMouseEvent) => {
        // iOS/Android отдают долгий тап и как contextmenu; мышь — правой кнопкой; клавиатура — клавишей меню/Shift+F10.
        e.preventDefault();
        stop();
        if (firedAt.current !== null && Date.now() - firedAt.current < 1500) return; // меню уже открыто таймером
        open();
      }}
      onClick={(e) => {
        const tail = firedAt.current !== null && e.detail !== 0;
        firedAt.current = null;
        if (tail) return; // тап, закончивший долгое нажатие
        if (ref.current) onPress(ref.current);
      }}
      data-testid={`mode-${mode.id}`}
    >
      <ModeRowBody mode={mode} slot={slot} />
    </button>
  );
}
