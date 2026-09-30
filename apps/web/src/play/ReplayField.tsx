import type { CSSProperties } from "react";
import type { TimelapseFrame } from "@pundoku/engine";
import { BOXES, BoxRules } from "./Board";

interface ReplayFieldProps {
  frames: readonly TimelapseFrame[];
  idx: number;
  /** 81 цифра заданных клеток (`0` — пусто). */
  mission: readonly number[];
  /** Клетка → индекс первого кадра с кляксой (`firstBlotFrames`). */
  blots: ReadonlyMap<number, number>;
  /** Проявлять изменение (цифра/клякса/кольцо) — `false` при перемотке. */
  animate: boolean;
  label: string;
}

/**
 * Поле таймлапса: статичная картинка кадра теми же классами, что и игровое поле (`.board/.box/.cell/.d/.ring`),
 * но без интерактива. Заметки не играются (решение владельца). Последняя поставленная клетка — кольцо выбора (M2).
 * Клякса (ink): пятно + сколотый угол остаются до конца партии; неверная цифра до замены — сургучом.
 */
export function ReplayField({ frames, idx, mission, blots, animate, label }: ReplayFieldProps) {
  const f = frames[idx]!;
  const wrong = new Set(f.wrong);
  const last = idx > 0 ? f.cell : null;
  const ring =
    last === null
      ? null
      : ({
          "--r": Math.floor(last / 9),
          "--c": last % 9,
          "--br": Math.floor(last / 27),
          "--bc": Math.floor((last % 9) / 3),
        } as CSSProperties);
  return (
    <div className="tl-board">
      <div className="board tl-field" role="img" aria-label={label} data-testid="tl-field" data-idx={idx}>
        {BOXES.map((cells, b) => (
          <div className="box" key={b}>
            {cells.map((i) => {
              const given = mission[i] ?? 0;
              const v = f.values[i] ?? 0;
              const blotted = (blots.get(i) ?? Infinity) <= idx;
              const fresh = animate && idx > 0 && i === last;
              return (
                <div className={`cell${blotted ? " blot" : ""}`} key={i} data-i={i}>
                  {blotted && <i className={`stain${fresh && idx - (blots.get(i) ?? -Infinity) <= 1 && (blots.get(i) ?? Infinity) <= idx ? " anim" : ""}`} aria-hidden="true" />}
                  {v ? (
                    <span
                      key={fresh ? `n${idx}` : "s"}
                      className={`d ${given ? "given" : "player"}${wrong.has(i) ? " err" : ""}${fresh ? " tl-in" : ""}`}
                      aria-hidden="true"
                    >
                      {v}
                    </span>
                  ) : null}
                </div>
              );
            })}
            <BoxRules />
          </div>
        ))}
        {ring && <div className={`ring${wrong.has(last!) && f.blot !== true ? " err" : ""}`} style={ring} aria-hidden="true" />}
      </div>
    </div>
  );
}

interface MiniFieldProps {
  frames: readonly TimelapseFrame[];
  idx: number;
  mission: readonly number[];
  blots: ReadonlyMap<number, number>;
}

/** Мини-поле контактного листа (макет `.mini`): подсказки — контур, заполнено — чернила, клякса — сургуч со сколотым углом. Без цифр. */
export function MiniField({ frames, idx, mission, blots }: MiniFieldProps) {
  const f = frames[idx]!;
  return (
    <div className="mini" aria-hidden="true">
      {Array.from({ length: 81 }, (_, i) => {
        const cls = (blots.get(i) ?? Infinity) <= idx ? "b" : mission[i] ? "g" : (f.values[i] ?? 0) ? "" : "e";
        return <i key={i} className={cls} />;
      })}
    </div>
  );
}
