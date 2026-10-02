/* Иконки вкладок — дословно из макета design/pd7-board-variants.html (таб-бар). */
import type { TabId } from "./tabs";

const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function TabIcon({ tab }: { tab: TabId }) {
  switch (tab) {
    case "today":
      return (
        <svg {...stroke}>
          <rect x="3.5" y="4.8" width="17" height="15.4" rx="3.4" />
          <path d="M3.5 9.2h17M8 3.2v2.8M16 3.2v2.8" />
          <circle cx="12" cy="14.7" r="1.9" fill="currentColor" stroke="none" />
        </svg>
      );
    case "play":
      return (
        <svg {...stroke}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="3.4" />
          <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
        </svg>
      );
    case "year":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
          {[5.2, 10.2, 15.2].map((y) => (
            <g key={y}>
              <rect x="3.2" y={y} width="3.6" height="3.6" rx="1" />
              <rect x="8.6" y={y} width="3.6" height="3.6" rx="1" />
              <rect x="14" y={y} width="3.6" height="3.6" rx="1" />
              <rect x="19.4" y={y} width="1.4" height="3.6" rx=".7" />
            </g>
          ))}
        </svg>
      );
  }
}

/* Шестерёнка настроек (PD-113): зубчатое колесо с отверстием — 8 зубьев, 24-box, штрих 1,7 как у иконок вкладок.
   Форма — собственная (ориентир — силуэт `gearshape`, ассеты Apple не копировались). Раньше здесь было «солнце». */
export const GEAR_PATH =
  "M10.38 4.98 L10.6 2.6 L13.4 2.6 L13.62 4.98 A7.2 7.2 0 0 1 15.82 5.89 L17.65 4.36 L19.64 6.35 L18.11 8.18 A7.2 7.2 0 0 1 19.02 10.38 L21.4 10.6 L21.4 13.4 L19.02 13.62 A7.2 7.2 0 0 1 18.11 15.82 L19.64 17.65 L17.65 19.64 L15.82 18.11 A7.2 7.2 0 0 1 13.62 19.02 L13.4 21.4 L10.6 21.4 L10.38 19.02 A7.2 7.2 0 0 1 8.18 18.11 L6.35 19.64 L4.36 17.65 L5.89 15.82 A7.2 7.2 0 0 1 4.98 13.62 L2.6 13.4 L2.6 10.6 L4.98 10.38 A7.2 7.2 0 0 1 5.89 8.18 L4.36 6.35 L6.35 4.36 L8.18 5.89 A7.2 7.2 0 0 1 10.38 4.98 Z";

export function GearIcon() {
  return (
    <svg {...stroke}>
      <path d={GEAR_PATH} />
      <circle cx="12" cy="12" r="2.9" />
    </svg>
  );
}
