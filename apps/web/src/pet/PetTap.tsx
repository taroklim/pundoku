import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { motionReduced } from "../shell/tabSlide";
import type { PointerMark } from "./petPoke";
import { POKE_MS, isTap, pokeEnd, pokeStart } from "./petPoke";

/** Идущая реакция: номер (новый тап — новый номер) и амплитуда (усталость, `petPoke.ts`). */
export interface PokeState {
  readonly seq: number;
  readonly amp: 1 | 0.5 | 0;
}

interface PokeCtx {
  readonly poke: PokeState | null;
  /** Клякса доиграла «Плюх» (`animationend`). */
  readonly end: () => void;
  /** Клякса сейчас занята действием («прилёт»/«проснуться») — тап игнорируется (md §1: «Во время прилёта тап игнорируется»). */
  readonly busy: { current: boolean };
}

const PokeContext = createContext<PokeCtx | null>(null);

/** Для `PetBlot`: реакция зоны, внутри которой стоит клякса (`null` — клякса не в зоне нажатия, на тап не отвечает). */
export function usePetPoke(): PokeCtx | null {
  return useContext(PokeContext);
}

export interface PetTapProps {
  /** Клякса (`PetBlot`). Одна на зону. */
  readonly children: ReactNode;
  /**
   * Класс зоны вдобавок к `pet-hit` (зона ≥ 44×44, `pet.css`): `pet-slot` карточки, `pet-head` шапки и т.д. Свой размер/место
   * задаёт место, минимальные 44×44, `touch-action: manipulation` и отсутствие подсветки тапа — `pet-hit`.
   */
  readonly className?: string;
  readonly testId?: string;
  /** Тап не реагирует (например, PNG-превью — там клякса не живая). */
  readonly disabled?: boolean;
  readonly style?: CSSProperties;
  /** `hidden` у зоны (место решило, что кляксе не хватает места): зона и клякса не рисуются. */
  readonly hidden?: boolean;
  readonly zoneRef?: (el: HTMLElement | null) => void;
}

/**
 * PD-298: зона нажатия вокруг кляксы — реакция A «Плюх» на тап (макет PD-296 §1). Переиспользуемая: карточка результата,
 * шапка Today, ожидание генерации, Настройки, «не загрузилось»; Year (места 4/5, лист дня) подключает её так же (PD-299).
 *
 * Не кнопка и не в порядке фокуса: Питомец остаётся украшением `role="img"` (md §1 «Доступность»), VoiceOver слышит то же, что
 * раньше; у тапа нет функции — пользователь VoiceOver/клавиатуры ничего не теряет. Указатель не захватывается, `preventDefault`
 * нет: прокрутка, свайп листа и жест «назад», начатые на кляксе, идут как раньше (тап — только `pointerup` рядом и быстро).
 */
export function PetTap({ children, className, testId, disabled = false, style, hidden, zoneRef }: PetTapProps) {
  const [poke, setPoke] = useState<PokeState | null>(null);
  const token = useRef(Symbol("pet-poke")).current;
  const down = useRef<PointerMark | null>(null);
  const busy = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  const end = useCallback(() => {
    window.clearTimeout(timer.current);
    pokeEnd(token);
    setPoke(null);
  }, [token]);

  // Размонтировали посреди реакции — реакция не должна навсегда «занять» экран.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      pokeEnd(token);
    },
    [token],
  );

  const mark = (e: ReactPointerEvent): PointerMark => ({ id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp || performance.now() });
  const onPointerDown = (e: ReactPointerEvent) => {
    down.current = e.isPrimary === false ? null : mark(e);
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const d = down.current;
    down.current = null;
    if (disabled || busy.current || !isTap(d, mark(e))) return;
    const amp = pokeStart(token, performance.now());
    if (amp === null) return; // идёт реакция — без перезапуска и очереди
    setPoke((p) => ({ seq: (p?.seq ?? 0) + 1, amp }));
    // Подстраховка, если `animationend` не придёт (клякса скрыта/без анимаций): реакция не держит экран дольше своей длины.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(end, (motionReduced() ? POKE_MS[1] : POKE_MS[0]) + 160);
  };
  const onPointerCancel = () => {
    down.current = null; // прокрутка/свайп забрали касание
  };

  const ctx = useMemo<PokeCtx>(() => ({ poke, end, busy }), [poke, end]);
  return (
    <span
      ref={zoneRef}
      className={`pet-hit${className ? ` ${className}` : ""}`}
      style={style}
      hidden={hidden}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <PokeContext.Provider value={ctx}>{children}</PokeContext.Provider>
    </span>
  );
}
