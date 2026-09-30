import type { ReactNode } from "react";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ExportSheet } from "./ExportSheet";
import type { PlayState } from "./logic";
import { hasTimelapse } from "./timelapse";
import { PlayIcon } from "./timelapseIcons";
import { TimelapseSheet } from "./TimelapseSheet";

export type TimelapseSheetKind = "player" | "export";

/**
 * Состояние входа в Таймлапс для карточки решённого дня (Today, архив, Year): есть ли у дня цельный лог
 * (`hasTimelapse`), какой шит открыт и сами шиты. `play === null` или `date === null` — входа нет вовсе (Play).
 * Вернувшийся `sheets` нужно отрисовать в разметке карточки. `difficulty` — ключ сложности либо `null`.
 */
export function useTimelapseEntry(play: PlayState | null, date: string | null, difficulty: string | null) {
  const enabled = play !== null && date !== null;
  const available = useMemo(
    () => (play !== null && date !== null ? hasTimelapse({ solved: true, mission: play.mission.join(""), play }) : false),
    [play, date],
  );
  const [open, setOpen] = useState<TimelapseSheetKind | null>(null);
  const close = useCallback(() => setOpen(null), []);
  let sheets: ReactNode = null;
  if (play && date && available && open === "player") sheets = <TimelapseSheet play={play} date={date} difficulty={difficulty} onClose={close} />;
  if (play && date && available && open === "export") sheets = <ExportSheet play={play} date={date} onClose={close} />;
  return { enabled, available, open: setOpen, sheets };
}

/**
 * Строка входа: либо тонированная кнопка «Watch your solve», либо тихая строка, что повтор недоступен (ходы не
 * сохранились). Ни отсутствующей, ни серой кнопки (решение владельца 2026-10-01).
 */
export function WatchRow({ available, onWatch }: { available: boolean; onWatch: () => void }) {
  const { t } = useTranslation();
  if (!available) {
    return (
      <p className="tl-nolog" data-testid="tl-nolog">
        {t("timelapse.none")}
      </p>
    );
  }
  return (
    <button type="button" className="tl-watch" data-testid="tl-watch" onClick={onWatch}>
      <PlayIcon outline />
      <span>{t("timelapse.watch")}</span>
    </button>
  );
}
