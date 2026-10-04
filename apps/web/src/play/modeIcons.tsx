/* Значки режимов (PD-167) — контуры дословно из макета design/pd163-modes-layout.html (штрих 1.7, рамка 24, цвет «чернила»).
   Новый режим = значок здесь + запись в реестре `modes.ts`. */
const line = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export interface ModeIconProps {
  readonly className?: string;
}

/** Классика — сетка 3×3. */
export function ClassicModeIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M5.5 3.5h13a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2z" />
      <path d="M9.2 3.5v17M14.8 3.5v17M3.5 9.2h17M3.5 14.8h17" />
    </svg>
  );
}

/** Чернила — перо. */
export function InkModeIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M12 2.8l5.2 6.4L12 21 6.8 9.2z" />
      <path d="M12 21v-8.2" />
      <circle cx="12" cy="11" r="1.5" />
    </svg>
  );
}
