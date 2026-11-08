/**
 * Сложность списком строк (PD-144, с PD-167 — в шите режима): radiogroup, roving tabindex, стрелки двигают и выбирают (как
 * у системной радиогруппы). Подпись строки — число открытых клеток и техника ИЗ `DIFFICULTY_PROFILES` (цифры не зашиты в
 * интерфейс). Набор сложностей — из реестра режима (`ModeDef.difficulties`).
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTY_PROFILES } from "@pundoku/engine";
import type { KeyboardEvent } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNoXWing } from "../settings/prefs";
import { hiddenByNoXWing, playableDifficulties } from "./difficulties";
import { CheckGlyph } from "./hubIcons";

/** Техника профиля сложности → ключ подписи (`play.hub.tech.*`). Неизвестная техника — без подписи техники. */
const TECH_KEY: Readonly<Record<string, string>> = { hidden_single: "singles", locked_candidates: "locked", hidden_pair: "pairs", swordfish: "fish", beyond: "beyond" };

export interface DifficultyListProps {
  readonly options: readonly Difficulty[];
  readonly pick: Difficulty;
  readonly onPick: (d: Difficulty) => void;
  readonly labelledBy?: string;
}

/**
 * PD-305: при «Без X-Wing» (по умолчанию вкл) классы с рыбами скрыты (`play/difficulties.ts`), под списком — строка, почему и где
 * включить. `pick` вызывающий уже привёл к допустимому (`PlayStore.pickFor`).
 */
export function DifficultyList({ options: all, pick, onPick, labelledBy }: DifficultyListProps) {
  const { t } = useTranslation();
  const noXWing = useNoXWing();
  const options = playableDifficulties(all, noXWing);
  const hidden = hiddenByNoXWing(all, noXWing);
  const refs = useRef<Partial<Record<Difficulty, HTMLButtonElement | null>>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = options.indexOf(pick);
    let next: number;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = (i + 1) % options.length;
        break;
      case "ArrowUp":
      case "ArrowLeft":
        next = (i - 1 + options.length) % options.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = options.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const d = options[next] as Difficulty;
    onPick(d);
    refs.current[d]?.focus();
  };
  return (
    <>
      <div
        className="hub-card"
        role="radiogroup"
        aria-label={labelledBy ? undefined : t("play.difficulty")}
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
        data-testid="difficulty-list"
      >
        {options.map((d) => {
          const profile = DIFFICULTY_PROFILES[d];
          const tech = TECH_KEY[profile.technique];
          const sub = [t("play.hub.clues", { count: profile.clues }), tech ? t(`play.hub.tech.${tech}`) : null].filter(Boolean).join(" · ");
          const on = d === pick;
          return (
            <button
              key={d}
              ref={(node) => {
                refs.current[d] = node;
              }}
              type="button"
              className="hub-row diff"
              role="radio"
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              onClick={() => onPick(d)}
              data-testid={`difficulty-${d}`}
            >
              <span className="lab">
                {t(`difficulty.${d}`)}
                <span className="sub">{sub}</span>
              </span>
              <span className="ck">
                <CheckGlyph />
              </span>
            </button>
          );
        })}
      </div>
      {hidden && (
        <p className="hub-foot diff-foot" data-testid="difficulty-noxwing-note">
          {t("play.hub.noXWingNote")}
        </p>
      )}
    </>
  );
}
