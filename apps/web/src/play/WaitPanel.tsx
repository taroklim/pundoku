import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { MARK_SMALL_CELL_SIZE } from "../brand/markPaths";
import type { WaitView } from "./waitView";

/**
 * PD-189: панель ожидания генерации на месте поля (вариант B макета PD-188, design/pd188-loading.md §4–7). Показывается всем,
 * от тумблера Питомца не зависит. Звука и вибрации нет.
 *
 * Состояния — из `useWaitView`: `wait` (текст 1), `long` (текст 2 + «Отмена»), `error` («Не удалось…» + «Повторить» /
 * «Отмена»), `out` (гаснет). Индикатор декоративный (`aria-hidden`); текст ожидания — `role="status"` (объявляется при
 * появлении панели и один раз на смене текста), ошибка — `role="alert"`.
 */
export function WaitPanel({ view, onRetry, onCancel, onFocusIn }: { view: WaitView; onRetry: () => void; onCancel: () => void; onFocusIn?: () => void }) {
  const { t } = useTranslation();
  if (view === "pre" || view === "ready") return null;
  const error = view === "error";
  const long = view === "long";
  return (
    <div className={`wait${view === "out" ? " out" : ""}`} data-state={view} data-testid="wait-panel">
      <div className="wait-grp" onFocus={onFocusIn}>
        <MarkCarry still={error} />
        {error ? (
          <p className="wait-text err" role="alert" key="e">
            {t("play.failed")}
          </p>
        ) : (
          <p className="wait-text" role="status" aria-live="polite" key="s">
            <span key={long ? "l" : "w"} className={long ? "wait-t2" : undefined}>
              {t(long ? "play.preparingLong" : "play.preparing")}
            </span>
          </p>
        )}
        {(error || long) && (
          <div className="wait-btns">
            {error && (
              <button type="button" className="wait-btn primary" onClick={onRetry} data-testid="wait-retry">
                {t("play.retry")}
              </button>
            )}
            <button type="button" className="wait-btn" onClick={onCancel} data-testid="wait-cancel">
              {t("play.cancel")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Знак P4 «Девять клеток» с «уносом» клетки (макет §5.2): 16-сеточная оптика `Mark` (клетка 3, шаг 4, начало (3,1)). Клетки
 * по очереди обходят букву — стойка снизу вверх, затем чаша по часовой — и на 216 мс уходят вверх-вправо чернилами. Порядок
 * задан столбцом/строкой решётки 3×4. `still` — ошибка: движения нет, знак серый целиком. Reduce Motion — в CSS (play.css):
 * клетки стоят, правая верхняя клетка чаши — чернилами, весь знак дышит прозрачностью.
 */
export const CARRY_ORDER: readonly (readonly [col: number, row: number])[] = [
  [0, 3],
  [0, 2],
  [0, 1],
  [0, 0],
  [1, 0],
  [2, 0],
  [2, 1],
  [2, 2],
  [1, 2],
];
/** Кадр Reduce Motion: правая верхняя клетка чаши — та, что «уносится» в D5. */
export const CARRY_STILL = "2,0";

function MarkCarry({ still }: { still: boolean }) {
  return (
    <svg className={`wait-mark${still ? " still" : ""}`} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {CARRY_ORDER.map(([c, r], i) => {
        const x = 3 + 4 * c;
        const y = 1 + 4 * r;
        const key = `${c},${r}`;
        return (
          <g key={key} className={`wm-cell${key === CARRY_STILL ? " wm-still" : ""}`} style={{ "--i": i } as CSSProperties}>
            <rect className="wm-b" x={x} y={y} width={MARK_SMALL_CELL_SIZE} height={MARK_SMALL_CELL_SIZE} />
            <rect className="wm-h" x={x} y={y} width={MARK_SMALL_CELL_SIZE} height={MARK_SMALL_CELL_SIZE} />
          </g>
        );
      })}
    </svg>
  );
}
