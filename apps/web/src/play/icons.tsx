/* Иконки действий — дословно из макета design/pd7-board-variants.html (панель Notes/Undo/Erase, Share). */
const stroke = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

export function NotesIcon() {
  return (
    <svg {...stroke}>
      <path d="M4.5 19.5l4.2-1.1 9.6-9.6a1.9 1.9 0 0 0 0-2.7l-1.4-1.4a1.9 1.9 0 0 0-2.7 0l-9.6 9.6z" />
      <path d="M14.2 5.9l3.9 3.9" />
    </svg>
  );
}

export function UndoIcon() {
  return (
    <svg {...stroke}>
      <path d="M9.2 7.2H15a4.4 4.4 0 1 1 0 8.8H8.2" />
      <path d="M11.8 4.2 8.8 7.2l3 3" />
    </svg>
  );
}

export function EraseIcon() {
  return (
    <svg {...stroke}>
      <path d="M8.4 18.2 5 14.8a1.9 1.9 0 0 1 0-2.7l6.9-6.9a1.9 1.9 0 0 1 2.7 0l4 4a1.9 1.9 0 0 1 0 2.7l-6.3 6.3z" />
      <path d="M20 19.6H10" />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg {...stroke} strokeWidth={1.9}>
      <path d="M12 3.4v10.2" />
      <path d="m8.6 6.8 3.4-3.4 3.4 3.4" />
      <path d="M5.6 12.6v5.2a2.2 2.2 0 0 0 2.2 2.2h8.4a2.2 2.2 0 0 0 2.2-2.2v-5.2" />
    </svg>
  );
}
