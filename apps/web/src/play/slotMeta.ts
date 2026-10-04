import type { TFunction } from "i18next";
import type { SlotSummary } from "./daySlot";
import { formatClock } from "./format";

/** «Сложность · N cells left · 03:18» — подпись незавершённой игры (строка «Продолжить», статус режима, предупреждение шита). */
export function slotMeta(t: TFunction, s: SlotSummary): string {
  const parts: string[] = [];
  if (s.difficulty) parts.push(t(`difficulty.${s.difficulty}`));
  parts.push(t("play.hub.left", { count: s.left }));
  parts.push(formatClock(s.elapsedMs));
  return parts.join(" · ");
}
