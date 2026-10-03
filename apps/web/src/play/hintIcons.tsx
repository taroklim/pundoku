/* Иконки подсказки (PD-139): лампочка из макета PD-133 (контур 1.6, рамка 24, как у шестерёнки) и значки шита правила. */
const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function BulbIcon() {
  return (
    <svg {...stroke} strokeWidth={1.6} width="23" height="23">
      <path d="M9.3 18h5.4" />
      <path d="M10.2 20.7h3.6" />
      <path d="M12 3.3a5.9 5.9 0 0 0-3.4 10.7c.5.4.8 1 .8 1.6v.4h5.2v-.4c0-.6.3-1.2.8-1.6A5.9 5.9 0 0 0 12 3.3Z" />
    </svg>
  );
}

/** «Отмечено с помощью»: плашка-закладка. */
export function MarkIcon() {
  return (
    <svg {...stroke}>
      <path d="M6.5 3.8h11v16.4L12 16.6l-5.5 3.6z" />
    </svg>
  );
}

/** «Повтор не меняет»: две стрелки по кругу. */
export function RepeatIcon() {
  return (
    <svg {...stroke}>
      <path d="M4.5 11.5V10a4 4 0 0 1 4-4h10M15.5 3l3 3-3 3" />
      <path d="M19.5 12.5V14a4 4 0 0 1-4 4h-10M8.5 21l-3-3 3-3" />
    </svg>
  );
}

/** «Ничего не нашёл — не отмечено»: кружок с чертой. */
export function NoneIcon() {
  return (
    <svg {...stroke}>
      <circle cx="12" cy="12" r="8" />
      <path d="M6.4 6.4l11.2 11.2" />
    </svg>
  );
}
