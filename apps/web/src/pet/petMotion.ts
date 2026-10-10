/**
 * Движение Питомца — вариант B «Капля» (PD-223, выбор владельца 2026-10-08; реализация PD-260).
 * Источник — макет `design/pd223-pet-motion.html` (таблица `DUR`, `poseEl`, `dropsEl`) и `.md` §1–§4. Варианты A/C не переносим.
 *
 * - «arrive» — карточка результата в момент решения, один раз: капля падает, сплющивается и собирается; брызги отлетают из-под
 *   неё. Посадка = настроение: доволен — ровно, устал — оседает тяжелее, удивлён — подпрыгивает.
 * - «wake» — лист дня Year: день, который был показан «спит», закончили — при первом показе после этого, один раз.
 * - «Уснуть» в приложении не бывает (решённый день не засыпает) — не переносим.
 * - Покой — постоянное дыхание (PD-297, решение владельца 2026-10-10: вместо «3 вдоха и замирает» макета md §1). Вне экрана, в
 *   скрытой вкладке и в фоне — стоит (`PetBlot`), при Reduce Motion — покоя нет.
 * JS только ставит атрибуты и переменные; движение — CSS (`pet.css`), только transform/opacity на HTML-слоях.
 */
import type { PetMood } from "@pundoku/engine";
import { petShape } from "./petGeometry";

export type PetAct = "arrive" | "wake";

/** Покой: длительность одного вдоха (md §1: 4,2 с; «спит» — 6,5 с). Вдохи повторяются бесконечно (PD-297), значения — в `pet.css`. */
export const BREATH_MS: Readonly<Record<PetMood, number>> = { happy: 4200, tired: 4200, surprised: 4200, asleep: 6500 };

/** Задержка реакции на карточке: после входа карточки (`cardUp` 300 мс) — макет «cardUp 300 мс → задержка 300 мс». */
export const ARRIVE_DELAY_MS = 300;

/** Длительность действия, мс: [полная, при Reduce Motion] — макет `DUR.B`. При RM — короткое растворение на месте (md §3). */
export function actDuration(act: PetAct, mood: PetMood): readonly [number, number] {
  if (act === "wake") return [820, 260];
  if (mood === "tired") return [900, 220];
  if (mood === "surprised") return [860, 220];
  return [760, 220];
}

const f4 = (v: number) => v.toFixed(4);
const f2 = (v: number) => v.toFixed(2);

/**
 * «Подогнанное растворение» (макет `poseEl`): уходящая поза масштабируется к габаритам новой (`--sx/--sy`), новая растёт из
 * габаритов старой (`--isx/--isy`). Отношение габаритов тел двух поз.
 */
export function fitScale(of: PetMood, to: PetMood): { x: string; y: string } {
  const a = petShape(of);
  const b = petShape(to);
  return { x: f4(b.w / a.w), y: f4(b.h / a.h) };
}

/** Капелька: позиция/размер в px слота и векторы «откуда прилетела» (`--dx/--dy`, к центру тела × 0,8) — макет `dropsEl`. */
export interface DropBox {
  readonly left: string;
  readonly top: string;
  readonly size: string;
  readonly dx: string;
  readonly dy: string;
}

export function dropBoxes(mood: PetMood, size: number): DropBox[] {
  const u = size / 48;
  const g = petShape(mood);
  return g.drops.map(([x, y, r]) => ({
    left: `${f2((x - r) * u)}px`,
    top: `${f2((y - r) * u)}px`,
    size: `${f2(2 * r * u)}px`,
    dx: `${f2((g.cx - x) * 0.8 * u)}px`,
    dy: `${f2((g.cy - y) * 0.8 * u)}px`,
  }));
}
