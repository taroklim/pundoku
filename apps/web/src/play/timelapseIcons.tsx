/* Иконки Таймлапса — дословно из макета design/pd69-ink-timelapse.html (символы i-play/i-pause/i-prev/i-next/i-loop). */
const line = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.9,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

const solid = {
  viewBox: "0 0 24 24",
  fill: "currentColor",
  stroke: "currentColor",
  strokeWidth: 1.2,
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function PlayIcon({ outline = false }: { outline?: boolean }) {
  return (
    <svg {...(outline ? line : solid)}>
      <path d="M8 5.4 18.4 12 8 18.6z" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg {...line} strokeWidth={2.6}>
      <path d="M9 5.4v13.2M15 5.4v13.2" />
    </svg>
  );
}

export function PrevIcon() {
  return (
    <svg {...solid}>
      <path d="M15.4 5.4 7.6 12l7.8 6.6zM17.6 5.4v13.2" />
    </svg>
  );
}

export function NextIcon() {
  return (
    <svg {...solid}>
      <path d="M8.6 5.4 16.4 12 8.6 18.6zM6.4 5.4v13.2" />
    </svg>
  );
}

export function LoopIcon() {
  return (
    <svg {...line}>
      <path d="M4.6 11.2A5.4 5.4 0 0 1 10 6h9.4" />
      <path d="m16.6 3.2 2.8 2.8-2.8 2.8" />
      <path d="M19.4 12.8A5.4 5.4 0 0 1 14 18H4.6" />
      <path d="m7.4 20.8-2.8-2.8 2.8-2.8" />
    </svg>
  );
}
