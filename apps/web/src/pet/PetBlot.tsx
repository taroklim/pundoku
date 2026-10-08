import type { PetMood } from "@pundoku/engine";
import type { CSSProperties } from "react";
import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { motionReduced, useTabActive } from "../shell/tabSlide";
import { petShape } from "./petGeometry";
import type { PetAct } from "./petMotion";
import { actDuration, dropBoxes, fitScale } from "./petMotion";

/**
 * Клякса-питомец (PD-180, рисунок — вариант A «Капля» макета PD-170; движение — вариант B «Капля» макета PD-223, PD-260).
 *
 * Слои (макет PD-223 §9): `.pet` (HTML, размер слота, не анимируется; role="img") › `.breath` (покой) › `.pose.from/.to`
 * (статичный SVG позы: тело цвета чернил, глаза вырезаны маской — сквозь них видна подложка) + `.drops.from/.to > .drop`
 * (капельки — HTML-кружки вне `.breath`: лежат на бумаге, не «дышат»). Анимируются ТОЛЬКО transform/opacity HTML-обёрток:
 * в WebKit это композитные слои, SVG с маской растрируется один раз. JS только ставит атрибуты/переменные.
 *
 * Поведение:
 * - `act="arrive"` — реакция на решённый день (карточка результата, один раз, после входа карточки); `act="wake"` — «спит →
 *   настроение» в листе дня Year (один раз). Без `act` — только покой.
 * - Покой — 3 вдоха и замирает. Вкладка скрыта / приложение в фоне — клякса стоит (ни одной анимации); вернулись — покой
 *   запускается заново (ремаунт), действие повторно не играет.
 * - Reduce Motion (`--mo: 0`): покоя нет, действие — короткое растворение на месте (амплитуды × `--mo` в `pet.css`).
 *
 * VoiceOver: `role="img"` и имя «Blot, pleased» — украшение с подписью, смысл дублируют строки карточки. Движение ничего не
 * объявляет. На игровое поле компонент не попадает никогда (только карточка результата, лист дня Year и превью в Настройках).
 */
export function PetBlot({
  mood,
  size = 44,
  decorative = false,
  act,
  actDelay = 0,
}: {
  mood: PetMood;
  size?: number;
  decorative?: boolean;
  /** Действие при показе (один раз на монтаж). `wake` осмыслен только для настроения, отличного от «спит». */
  act?: PetAct;
  /** Задержка действия, мс (карточка: после её входа). */
  actDelay?: number;
}) {
  const { t } = useTranslation();
  // useId даёт «:r1:»/««r1»» — в url(#…) берём только буквы и цифры.
  const id = `pet-m-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const { live, run } = useLiveRun();
  // Первый запуск — с действием; после возврата на экран — только покой. Скрыта — клякса стоит (без анимаций и без «from»).
  const action = live && run === 0 && act && !(act === "wake" && mood === "asleep") ? act : undefined;
  const from: PetMood | null = action === "wake" ? "asleep" : null;
  // Reduce Motion читается на каждый запуск (`--mo`, tokens.css — единственное место, где читается системная настройка).
  const reduced = useMemo(() => motionReduced(), [run]);

  const style: Record<string, string> = { width: `${size}px`, height: `${size}px`, "--u": `${(size / 48).toFixed(4)}px` };
  if (action) {
    const [full, rm] = actDuration(action, mood);
    style["--d-full"] = `${full}ms`;
    style["--d-rm"] = `${rm}ms`;
    style["--act-delay"] = `${actDelay}ms`;
  }

  return (
    <span
      key={`${run}-${mood}`}
      className="pet"
      data-v="B"
      data-mood={mood}
      data-act={action}
      data-idle={live && !reduced ? "" : undefined}
      data-still={live ? undefined : ""}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : t(`pet.label.${mood}`)}
      aria-hidden={decorative ? true : undefined}
      style={style as CSSProperties}
      data-testid="pet"
    >
      <span className="breath">
        {from && <Pose id={`${id}f`} mood={from} role="from" other={mood} />}
        <Pose id={`${id}t`} mood={mood} role="to" other={from} />
      </span>
      {from && <Drops mood={from} role="from" size={size} />}
      <Drops mood={mood} role="to" size={size} />
    </span>
  );
}

/** Поза-настроение: статичный SVG (тело + прорези глаз маской). `other` — парная поза перехода (масштаб «подгонки»). */
function Pose({ id, mood, role, other }: { id: string; mood: PetMood; role: "from" | "to"; other: PetMood | null }) {
  const shape = petShape(mood);
  const e = shape.eyes;
  let style: Record<string, string> | undefined;
  if (other) {
    const k = fitScale(mood, other);
    style = role === "from" ? { "--sx": k.x, "--sy": k.y } : { "--isx": k.x, "--isy": k.y };
  }
  return (
    <span className={`pose ${role}`} style={style as CSSProperties | undefined} data-mood={mood}>
      <svg className="pet-svg" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
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
        <path className="pet-ink" d={shape.body} mask={`url(#${id})`} />
      </svg>
    </span>
  );
}

function Drops({ mood, role, size }: { mood: PetMood; role: "from" | "to"; size: number }) {
  return (
    <span className={`drops ${role}`}>
      {dropBoxes(mood, size).map((d, i) => (
        <span
          key={i}
          className="drop"
          style={{ left: d.left, top: d.top, width: d.size, height: d.size, "--dx": d.dx, "--dy": d.dy } as CSSProperties}
        />
      ))}
    </span>
  );
}

/**
 * Клякса «живёт», только пока её видно: вкладка на экране (`TabActiveContext`) и документ не скрыт (приложение не в фоне).
 * `run` растёт при каждом возвращении — ремаунт заново запускает покой (это не цикл: 3 вдоха и снова стоит).
 */
function useLiveRun(): { live: boolean; run: number } {
  const tabActive = useTabActive();
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  const live = tabActive && visible;
  // Производное состояние от предыдущего рендера (паттерн React «storing information from previous renders»), без эффекта.
  const [seen, setSeen] = useState({ live, run: 0 });
  let cur = seen;
  if (seen.live !== live) {
    cur = { live, run: live ? seen.run + 1 : seen.run };
    setSeen(cur);
  }
  return { live, run: cur.run };
}
