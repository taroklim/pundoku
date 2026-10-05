/**
 * Реестр режимов Play (PD-167, раскладка C из design/pd163-modes-layout.md). Один источник для хаба (строка на режим),
 * шита режима (описание + сложность + «Начать»), чипа в шапке партии и слотов незавершённых игр в хранилище.
 *
 * Добавить режим = значок (`modeIcons.tsx`) + запись здесь + тексты `modes.<id>.name|desc` в трёх локалях + экран механики.
 * Порядок записей — порядок строк на хабе (фиксированный, новые режимы — в конец, решение 5 макета PD-163).
 * В список попадают ТОЛЬКО готовые режимы (`ready`): никаких «скоро» и мёртвых кнопок.
 */
import type { Difficulty } from "@pundoku/engine";
import { DIFFICULTIES, INK_RULES } from "@pundoku/engine";
import type { ComponentType } from "react";
import { InkRuleSheet } from "./InkEntry";
import type { PlayState } from "./logic";
import { setGlyphMode, setInkMode, setMelodyMode } from "./logic";
import type { ModeIconProps } from "./modeIcons";
import { ClassicModeIcon, GlyphsModeIcon, InkModeIcon, LiarModeIcon, MelodyModeIcon } from "./modeIcons";

/** Идентификатор режима: часть ключа слота в хранилище (`playGame:<id>`) — однажды выпущенный id не переименовывать. */
export type ModeId = "classic" | "ink" | "liar" | "glyphs" | "melody";

/** Шит-подтверждение перед стартом (правило режима длиннее описания, PD-74): показывается ПОСЛЕ шита режима, не поверх. */
export type ModeRuleSheet = ComponentType<{ onStart: () => void; onCancel: () => void }>;

export interface ModeDef {
  readonly id: ModeId;
  /** Значок строки хаба, заголовка шита и чипа партии. */
  readonly Icon: ComponentType<ModeIconProps>;
  /** Тексты: `modes.<textKey>.name` (имя, чип) и `modes.<textKey>.desc` (1–2 предложения: строка хаба, шит, меню). */
  readonly textKey: string;
  /** Готов к игре: только такие режимы видны на хабе. Неготовый может жить в реестре, пока делается механика. */
  readonly ready: boolean;
  /** Допустимые сложности (список в шите режима). */
  readonly difficulties: readonly Difficulty[];
  /** Разрешён ли режим в архиве Today. Для Чернил — то же правило, что применяет архив (`INK_RULES.allowInArchive`). */
  readonly allowInArchive: boolean;
  /** Чип режима в подписи партии (Классика — без чипа, решение 9 макета PD-163). */
  readonly chip: boolean;
  /** Есть ли в режиме подсказки (лесенка PD-139). В Чернилах — нет (решение владельца); место под док не резервируется. */
  readonly hints: boolean;
  /** Настройка свежесгенерированной партии под режим (лог пуст). Нет — партия как есть. */
  readonly prepare?: (play: PlayState) => PlayState;
  /** Правило перед стартом (необратимые режимы). */
  readonly Rule?: ModeRuleSheet;
  /**
   * Источник сетки: `classic` (по умолчанию) — `generate`; `liar` — `generateLiar` (PD-171: другой тип сетки, своя партия
   * с секретом, обвинения, Лжец дня в шите режима, prefetch тяжёлых классов).
   */
  readonly grid?: "classic" | "liar";
}

export const MODES: readonly ModeDef[] = [
  {
    id: "classic",
    Icon: ClassicModeIcon,
    textKey: "classic",
    ready: true,
    difficulties: DIFFICULTIES,
    allowInArchive: true,
    chip: false,
    hints: true,
  },
  {
    id: "ink",
    Icon: InkModeIcon,
    textKey: "ink",
    ready: true,
    difficulties: DIFFICULTIES,
    allowInArchive: INK_RULES.allowInArchive,
    chip: true,
    hints: false,
    prepare: (play) => setInkMode(play, true),
    Rule: InkRuleSheet,
  },
  {
    // PD-171 (план режимов §1): другой тип сетки — одна из данных подсказок лжёт. Несовместим с Чернилами (`setInkMode`
    // отвергает ink у партии с `liar`). Лесенка подсказок есть, но включается только после поимки — место под док держим.
    id: "liar",
    Icon: LiarModeIcon,
    textKey: "liar",
    ready: true,
    difficulties: DIFFICULTIES,
    allowInArchive: false,
    chip: true,
    hints: true,
    grid: "liar",
  },
  {
    // PD-194 (план режимов §3): классическая сетка, показанная знаками набора A «Фигуры» (PD-170) — только рендер, правила,
    // лог и подсказки те же, что у Классики. Флаг `play.glyphs` ставится на старте и едет с партией (слот, таймлапс).
    id: "glyphs",
    Icon: GlyphsModeIcon,
    textKey: "glyphs",
    ready: true,
    difficulties: DIFFICULTIES,
    allowInArchive: false,
    chip: true,
    hints: true,
    prepare: (play) => setGlyphMode(play),
  },
  {
    // PD-201 (план режимов §4): классическая сетка со звуком — цифра = нота, закрытый юнит = арпеджио, решённая сетка —
    // «мелодия пути» (`melodyOf` движка, звук — `melody/audio.ts`). Пока только слот хранилища и флаг `play.melody`:
    // `ready: false` — строки на хабе нет, экран/звук в партии и кнопку на карточке добавит PD-203 (после выбора визуала).
    id: "melody",
    Icon: MelodyModeIcon,
    textKey: "melody",
    ready: false,
    difficulties: DIFFICULTIES,
    allowInArchive: false,
    chip: true,
    hints: true,
    prepare: (play) => setMelodyMode(play),
  },
];

export const DEFAULT_MODE: ModeId = "classic";

const BY_ID: ReadonlyMap<string, ModeDef> = new Map(MODES.map((m) => [m.id, m]));

export const isModeId = (v: unknown): v is ModeId => typeof v === "string" && BY_ID.has(v);

/** Описание режима по id (`DEFAULT_MODE` — для неизвестного: партия не роняет экран). */
export function modeDef(id: ModeId): ModeDef {
  return BY_ID.get(id) ?? (BY_ID.get(DEFAULT_MODE) as ModeDef);
}

/** Режимы для списка хаба: только готовые, в порядке реестра. */
export function availableModes(registry: readonly ModeDef[] = MODES): readonly ModeDef[] {
  return registry.filter((m) => m.ready);
}

/** Режим партии, записанной до PD-167 (один слот на всё): Чернила узнаются по самой партии, остальное — Классика. */
export function legacyModeOf(play: Pick<PlayState, "ink" | "glyphs" | "melody">): ModeId {
  if (play.glyphs === true) return "glyphs"; // PD-194: глифов до PD-167 не было — только на случай записи без `mode`
  if (play.melody === true) return "melody"; // PD-201: так же
  return play.ink === true ? "ink" : "classic";
}

/** Ключ слота режима в `meta` хранилища. */
export const slotKey = (id: ModeId): string => `playGame:${id}`;
