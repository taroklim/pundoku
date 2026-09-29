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
