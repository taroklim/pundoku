/* Иконки Чернильного режима (PD-74) — дословно из макета design/pd69-ink-timelapse.html (`#i-nib`, `#i-chev`,
   `#i-warn`, `#i-lock`); тот же штриховой язык, что у иконок действий (1.8 px, рамка 24). Отдельный файл — чтобы
   не сталкиваться с правками `icons.tsx` в параллельных ветках. */
const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Перо — знак режима (единственный нарисованный знак; в строке входа и в чипе карточки). */
export function NibIcon({ className }: { className?: string }) {
  return (
    <svg {...stroke} className={className}>
      <path d="M6 18.4 8.1 12 15.4 4.7a1.6 1.6 0 0 1 2.3 0l1.6 1.6a1.6 1.6 0 0 1 0 2.3L12 15.9zM8.1 12l3.9 3.9M5 21h6" />
    </svg>
  );
}

export function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg {...stroke} strokeWidth={2.2} className={className}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg {...stroke}>
      <path d="M12 4.2 21 19.4H3z" />
      <path d="M12 9.6v4.6M12 16.8v.1" />
    </svg>
  );
}

export function LockIcon() {
  return (
    <svg {...stroke}>
      <rect x="5.4" y="10.6" width="13.2" height="9.4" rx="2.4" />
      <path d="M8.4 10.6V8a3.6 3.6 0 0 1 7.2 0v2.6" />
    </svg>
  );
}
