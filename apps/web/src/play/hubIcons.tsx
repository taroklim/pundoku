/* Иконки хаба Play и меню «⋯» (PD-144) — контуры дословно из макета design/pd144-play-c.html (штрих 1.5–1.6, рамка 24). */
const line = (strokeWidth: number) =>
  ({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  }) as const;

/** «⋯» — три точки кнопки «Ещё» в шапке. */
export function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5.5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="18.5" cy="12" r="1.9" />
    </svg>
  );
}

/** Календарь — строка «Головоломка дня» в «Продолжить». */
export function CalendarGlyph({ className }: { className?: string }) {
  return (
    <svg {...line(1.5)} className={className}>
      <rect x="3.5" y="4.5" width="17" height="16" rx="3" />
      <path d="M3.5 9h17M8 3v3M16 3v3" />
    </svg>
  );
}

/** Сетка — строка «Своя сетка» в «Продолжить» и пункт «Заполнить кандидатами». */
export function GridGlyph({ className }: { className?: string }) {
  return (
    <svg {...line(1.6)} className={className}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
      <path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" />
    </svg>
  );
}

/** Сетка с плюсом — пункт «Новая сетка». */
export function NewGridGlyph({ className }: { className?: string }) {
  return (
    <svg {...line(1.6)} className={className}>
      <rect x="3.5" y="3.5" width="12" height="12" rx="2.6" />
      <path d="M7.5 3.5v12M11.5 3.5v12M3.5 7.5h12M3.5 11.5h12" />
      <path d="M18.5 14.5v7M15 18h7" />
    </svg>
  );
}

/** Галочка выбранной строки (сложность, режим). */
export function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg {...line(2.2)} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
