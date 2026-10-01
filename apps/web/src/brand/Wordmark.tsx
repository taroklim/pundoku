import type { CSSProperties } from "react";

/**
 * Вордмарк «Pundoku» (d5-wordmark.svg, PD-102): «Pun» — чернилами (`--ink`, цвет унесённой клетки),
 * «doku» — графитом (`--doku-color`, задаётся локально там, где вордмарк стоит: в токены графит не входит).
 * Буквы нарисованы штрихом 22 на канве 588×116, шрифта нет — масштабируется без потерь, без анимации.
 * Декоративный по умолчанию (`aria-hidden`); `title` — если вордмарк стоит без текстового дубля.
 */
const RATIO = 588 / 116;

export interface WordmarkProps {
  /** Высота в CSS px; ширина по пропорции 588:116 (28 px -> 142 px). */
  height: number;
  title?: string;
  className?: string;
}

const COLORS = { "--pun": "var(--ink)", "--doku": "var(--doku-color, #43474f)" } as CSSProperties;
const pun: CSSProperties = { stroke: "var(--pun, #3b48b0)" };
const doku: CSSProperties = { stroke: "var(--doku, #43474f)" };

export function Wordmark({ height, title, className }: WordmarkProps) {
  return (
    <svg
      viewBox="0 0 588 116"
      width={Math.round(height * RATIO)}
      height={height}
      className={className}
      style={COLORS}
      focusable="false"
      {...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true })}
    >
      <g transform="translate(2 -94)" fill="none" strokeWidth="22" strokeLinecap="butt" strokeLinejoin="round">
        <g style={pun}>
          <path d="M11 96V200M11 107H40A26 26 0 0 1 40 159H11" />
          <path transform="translate(83 0)" d="M11 124V167A23 22 0 0 0 57 167M57 124V200" />
          <path transform="translate(165 0)" d="M11 200V157A23 22 0 0 1 57 157V200" />
        </g>
        <g style={doku}>
          <path transform="translate(247 0)" d="M11 162A28 27 0 0 1 67 162A28 27 0 0 1 11 162M67 96V200" />
          <path transform="translate(339 0)" d="M11 162A28 27 0 0 1 67 162A28 27 0 0 1 11 162" />
          <path transform="translate(431 0)" d="M11 96V200M58 124L26 168L62 200" />
          <path transform="translate(516 0)" d="M11 124V167A23 22 0 0 0 57 167M57 124V200" />
        </g>
      </g>
    </svg>
  );
}
