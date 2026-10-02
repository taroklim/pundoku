import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BulbIcon } from "./hintIcons";

interface HintButtonProps {
  open: boolean;
  /** Сколько результативных подсказок взято в этой партии/дне (озвучивается в подписи, визуально не меняет кнопку). */
  used: number;
  /** Play: «взято N» без «сегодня» — партия не привязана ко дню. */
  play?: boolean;
  onPress: () => void;
  /** id дока — для `aria-controls`, пока он открыт. */
  controls?: string;
}

/**
 * Лампочка в шапке (макет PD-133 §3): цель 44×44 слева от шестерёнки. Покой — контур `--label-2`, открыт — `--ink` на
 * `--ink-tint` (как нажатая вкладка). Подпись «Hint» / «Hint, 2 used today»; `aria-expanded` — открыт ли док.
 * После закрытия дока (кнопкой в доке, Esc) фокус возвращается сюда, если иначе он потерялся бы на `<body>`.
 */
export function HintButton({ open, used, play = false, onPress, controls }: HintButtonProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const was = useRef(open);
  useEffect(() => {
    if (was.current && !open && (!document.activeElement || document.activeElement === document.body)) ref.current?.focus({ preventScroll: true });
    was.current = open;
  }, [open]);
  const label = used > 0 ? t(play ? "hint.buttonUsedPlay" : "hint.buttonUsed", { count: used }) : t("hint.button");
  return (
    <button
      ref={ref}
      type="button"
      className={`hint-btn${open ? " on" : ""}`}
      onClick={onPress}
      aria-label={label}
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      data-testid="hint-button"
    >
      <BulbIcon />
    </button>
  );
}
