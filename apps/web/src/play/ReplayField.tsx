import type { CSSProperties } from "react";
import type { TimelapseFrame } from "@pundoku/engine";
import { BOXES, BoxRules } from "./Board";
import { Glyph } from "./glyphs";
import type { LiarTimelapseLayer } from "./liar";

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
  /** PD-171: слой обвинений Лжеца — до поимки в клетке ложная цифра, после — истинная с зачёркнутой ложью; печати оправданных. */
  liar?: LiarTimelapseLayer | null;
  /** PD-194: партия режима Глифы — знаки вместо цифр, как на игровом поле (дано залитым, ваше контуром). */
  glyphs?: boolean;
}

/**
 * Поле таймлапса: статичная картинка кадра теми же классами, что и игровое поле (`.board/.box/.cell/.d/.ring`),
 * но без интерактива. Заметки не играются (решение владельца). Последняя поставленная клетка — кольцо выбора (M2).
 * Клякса (ink): пятно + сколотый угол остаются до конца партии; неверная цифра до замены — сургучом.
 */
export function ReplayField({ frames, idx, mission, blots, animate, label, liar = null, glyphs = false }: ReplayFieldProps) {
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
              const blotted = (blots.get(i) ?? Infinity) <= idx;
              const fresh = animate && idx > 0 && i === last;
              // Лжец: клетка лжеца до кадра поимки показывает ложную цифру; после — истинную, ложь зачёркнута в углу.
              const isLiar = liar !== null && liar.cell === i;
              const caughtNow = isLiar && liar.catchFrame !== null && liar.catchFrame <= idx;
              const v = isLiar && !caughtNow ? liar.lie : (f.values[i] ?? 0);
              const acquitted = liar !== null && (liar.acquitted.get(i) ?? Infinity) <= idx;
              return (
                <div className={`cell${blotted ? " blot" : ""}${caughtNow ? " caught" : ""}${acquitted ? " acquitted" : ""}`} key={i} data-i={i}>
                  {(caughtNow || acquitted) && <i className="seal" aria-hidden="true" />}
                  {caughtNow && (
                    <span className="lie" aria-hidden="true">
                      {liar.lie}
                    </span>
                  )}
                  {blotted && <i className={`stain${fresh && idx - (blots.get(i) ?? -Infinity) <= 1 && (blots.get(i) ?? Infinity) <= idx ? " anim" : ""}`} aria-hidden="true" />}
                  {v ? (
                    <span
                      key={fresh ? `n${idx}` : "s"}
                      className={`d ${given ? "given" : "player"}${glyphs ? " gd" : ""}${wrong.has(i) ? " err" : ""}${fresh ? " tl-in" : ""}`}
                      aria-hidden="true"
                    >
                      {glyphs ? <Glyph digit={v} kind={given ? "given" : "placed"} /> : v}
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
