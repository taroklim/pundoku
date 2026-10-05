import type { PetMood } from "@pundoku/engine";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { petShape } from "./petGeometry";

/**
 * Клякса-питомец (PD-180, вариант A «Капля» макета PD-170): один path цвета чернил (`currentColor` ← `--ink`), глаза вырезаны
 * маской — сквозь них видна подложка карточки. Настроение читается формой (глаза + поза), не цветом. Масштабируется
 * (viewBox 48), рабочий размер 40–44 pt, нижняя граница — 24 pt. «Дыхание» — CSS (`pet.css`), амплитуда через `--mo`:
 * при «Уменьшении движения» клякса стоит. Звука и вибрации нет.
 *
 * VoiceOver: `role="img"` и имя «Blot, pleased» — украшение с подписью, смысл дублируют строки карточки.
 * На игровое поле компонент не попадает никогда (только карточка результата и лист дня Year).
 */
export function PetBlot({ mood, size = 44, decorative = false }: { mood: PetMood; size?: number; decorative?: boolean }) {
  const { t } = useTranslation();
  // useId даёт «:r1:»/««r1»» — в url(#…) берём только буквы и цифры.
  const id = `pet-m-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const shape = petShape(mood);
  const e = shape.eyes;
  return (
    <svg
      className="pet-svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : t(`pet.label.${mood}`)}
      aria-hidden={decorative ? true : undefined}
      data-mood={mood}
      data-testid="pet"
    >
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="-4" y="-4" width="56" height="56">
          <rect x="-4" y="-4" width="56" height="56" fill="#fff" />
          {e.kind === "stroke" && <path fill="none" stroke="#000" strokeWidth="2.6" strokeLinecap="round" d={e.d} />}
          {e.kind === "fill" && <path fill="#000" d={e.d} />}
          {e.kind === "circles" && (
            <>
              <circle fill="#000" cx={e.cx[0]} cy={e.cy} r={e.r} />
              <circle fill="#000" cx={e.cx[1]} cy={e.cy} r={e.r} />
            </>
          )}
        </mask>
      </defs>
      <g className={`pet-breathe${mood === "asleep" ? " asleep" : ""}`}>
        <path className="pet-ink" d={shape.body} mask={`url(#${id})`} />
        {shape.drops.map(([x, y, r], i) => (
          <circle key={i} className="pet-ink" cx={x.toFixed(2)} cy={y.toFixed(2)} r={r} />
        ))}
      </g>
    </svg>
  );
}
