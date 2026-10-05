/* Значки Мелодии (PD-203) — контуры дословно из макета design/pd202-melody.html (`melodyOff`, `speaker`, `speakerOff`, `check`,
   `stop`), штрих и рамка — как у значков режимов (modeIcons.tsx). */
const line = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

interface IconProps {
  readonly className?: string;
}

/** Нота, перечёркнутая — чип «Мелодия · без звука». */
export function MelodyOffIcon({ className }: IconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M9 18V5.5l10-2v12.5" />
      <circle cx="6.6" cy="18" r="2.4" />
      <circle cx="16.6" cy="16" r="2.4" />
      <path d="M3.5 3.5l17 17" />
    </svg>
  );
}

/** Динамик — пункт «Звук» в меню ⋯, кнопка звука в таймлапсе (вкл). */
export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M4 9.3h3.3L12 5.2v13.6l-4.7-4.1H4z" />
      <path d="M15.4 9.2a4 4 0 0 1 0 5.6M18 6.6a7.6 7.6 0 0 1 0 10.8" />
    </svg>
  );
}

/** Динамик выключен — кнопка звука в таймлапсе (выкл). */
export function SpeakerOffIcon({ className }: IconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M4 9.3h3.3L12 5.2v13.6l-4.7-4.1H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </svg>
  );
}

/** Галочка пункта-переключателя меню. */
export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...line} className={className}>
      <path d="M4.5 12.5l4.6 4.6L19.5 6.8" />
    </svg>
  );
}

/** Квадрат «Остановить». */
export function StopIcon({ className }: IconProps) {
  return (
    <svg {...line} className={className}>
      <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}
