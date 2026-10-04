import type { CSSProperties } from "react";
import {
  WORDMARK_CELL,
  WORDMARK_CELLS,
  WORDMARK_DOKU,
  WORDMARK_RATIO,
  WORDMARK_RX,
  WORDMARK_SHIFT_X,
  WORDMARK_SHIFT_Y,
  WORDMARK_STROKE,
  WORDMARK_VIEW_H,
  WORDMARK_VIEW_W,
} from "./wordmarkGeometry";

/**
 * Вордмарк «Pundoku» (PD-152, макет PD-149 раунд 5, вариант A): «Pun» сложено из 23 клеток-`<rect>` (форма, не только
 * цвет, выделяет никнейм — работает в forced-colors, ч/б печати и PNG), «doku» — рисованные буквы штрихом 22. Цвета:
 * клетки — `--ink`, «doku» — графит `--doku-color` (задаётся локально там, где вордмарк стоит: в токены не входит).
 * Свет/тьма — через токены, без JS. Не локализуется: имя бренда одно на en/uk/ru.
 *
 * A11y: весь логотип — один `role="img"` с именем «Pundoku» (клетки и буквы внутри `aria-hidden`, экранный диктор их
 * не читает). `decorative` — для мест, где рядом уже есть текст с названием (тогда `aria-hidden`, без role).
 *
 * Размер по высоте: проп `height` (CSS px) либо, если он не задан, CSS-переменная `--wordmark-h` (по умолчанию 28 px).
 * Ширина — по пропорции 614:116 (28 px -> 148 px).
 */
export const WORDMARK_NAME = "Pundoku";

export interface WordmarkProps {
  /** Высота в CSS px; не задана — берётся `var(--wordmark-h, 28px)`. */
  height?: number;
  /** Имя для технологий доступности; по умолчанию — «Pundoku». */
  title?: string;
  /** Рядом уже есть текст с названием: логотип скрывается из дерева доступности. */
  decorative?: boolean;
  className?: string;
}

const COLORS = { "--pun": "var(--ink)", "--doku": "var(--doku-color, #43474f)" } as CSSProperties;
const pun: CSSProperties = { fill: "var(--pun, #3b48b0)" };
const doku: CSSProperties = { stroke: "var(--doku, #43474f)" };
const fluid: CSSProperties = { height: "var(--wordmark-h, 28px)", width: "auto", aspectRatio: `${WORDMARK_VIEW_W} / ${WORDMARK_VIEW_H}` };

export function Wordmark({ height, title = WORDMARK_NAME, decorative = false, className }: WordmarkProps) {
  const size = height === undefined ? { style: { ...COLORS, ...fluid } } : { width: Math.round(height * WORDMARK_RATIO), height, style: COLORS };
  return (
    <svg
      viewBox={`0 0 ${WORDMARK_VIEW_W} ${WORDMARK_VIEW_H}`}
      className={className ? `wordmark ${className}` : "wordmark"}
      focusable="false"
      {...size}
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": title })}
    >
      <g aria-hidden="true" transform={`translate(${WORDMARK_SHIFT_X} ${WORDMARK_SHIFT_Y})`}>
        <g style={pun} data-part="pun">
          {WORDMARK_CELLS.map((c) => (
            <rect key={`${c.letter}${c.x}-${c.y}`} x={c.x} y={c.y} width={WORDMARK_CELL} height={WORDMARK_CELL} rx={WORDMARK_RX} />
          ))}
        </g>
        <g
          style={doku}
          data-part="doku"
          fill="none"
          strokeWidth={WORDMARK_STROKE}
          strokeLinecap="butt"
          strokeLinejoin="round"
        >
          {WORDMARK_DOKU.map((l) => (
            <path key={l.letter + l.x} transform={`translate(${l.x} 0)`} d={l.d} />
          ))}
        </g>
      </g>
    </svg>
  );
}
