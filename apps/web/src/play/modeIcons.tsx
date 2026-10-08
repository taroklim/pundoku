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

/** Лжец — маска (макет PD-163, чернилами: сургуч зарезервирован за ошибкой/обвинением). */
export function LiarModeIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M3.8 6.6c4-2 12.4-2 16.4 0 .2 7.4-3.4 12.6-8.2 12.6S3.6 14 3.8 6.6z" />
      <path d="M7.6 10.6c.8-.7 2.2-.7 3 0M13.4 10.6c.8-.7 2.2-.7 3 0" />
      <path d="M9.4 15.2c1.6.8 3.6.8 5.2 0" />
    </svg>
  );
}

/** Мелодия — нота (макет PD-163, `I.melody`). PD-201: режим в реестре, но ещё не готов (`ready: false`) — строку хаба добавит PD-203. */
export function MelodyModeIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M9 18V5.5l10-2v12.5" />
      <circle cx="6.6" cy="18" r="2.4" />
      <circle cx="16.6" cy="16" r="2.4" />
    </svg>
  );
}

/** Фонарь — фонарь с огоньком (макет PD-163, `I.lantern`). */
export function LanternModeIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M10 3h4M12 3v2.2" />
      <path d="M9.5 5.2h5a2.5 2.5 0 0 1 2.5 2.5v8.1a2.5 2.5 0 0 1-2.5 2.5h-5A2.5 2.5 0 0 1 7 15.8V7.7a2.5 2.5 0 0 1 2.5-2.5z" />
      <path d="M12 9.2c1.4 1.4 1.4 3.2 0 4.6-1.4-1.4-1.4-3.2 0-4.6z" />
      <path d="M9 21h6" />
    </svg>
  );
}

/** PD-208: «Осмотреть доску» (пункт ⋯ партии Фонаря) — глаз. */
export function InspectIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M2.8 12c2.2-4 5.4-6 9.2-6s7 2 9.2 6c-2.2 4-5.4 6-9.2 6s-7-2-9.2-6z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

/** Глифы — четыре фигуры (макет PD-163, `I.glyphs`). */
export function GlyphsModeIcon({ className }: ModeIconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M7 3.6l3.6 6.2H3.4z" />
      <circle cx="16.8" cy="6.8" r="3.1" />
      <rect x="3.8" y="14" width="6.2" height="6.2" rx="1.2" />
      <path d="M14 17.1h6M17 14.1v6" />
    </svg>
  );
}
