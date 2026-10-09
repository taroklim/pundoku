/**
 * PD-251 (решение владельца): туман Фонаря появляется и уходит постепенно — кроссфейд двух слоёв клетки, чёткого («clear»: своя
 * цифра / сетка заметок) и размытого («fog»: та же цифра под blur / пятно заметок PD-230). Анимируется только opacity слоя
 * (styles/lantern.css), радиус blur не меняется никогда.
 *
 * Здесь — учёт «призрака»: слоя прежнего вида, который ещё гаснет после смены света клетки. У клетки не больше двух слоёв
 * (текущий + призрак), призрак живёт не дольше перехода (`FOG_FADE_MS` + запас) и убирается из DOM.
 *
 * Правило против утечек:
 *   1. Чёткий слой монтируется ТОЛЬКО в клетке, которая сейчас в свете (lit) или в осмотре (peek). Клетка, выходящая на свет,
 *      показывает цифру не раньше, чем стала светлой: до этого чёткого слоя у неё нет вовсе.
 *   2. В клетке тени чёткий слой может быть только призраком: клетка была в свете меньше `FOG_FADE_MS` назад (цифра только что
 *      была видна), его прозрачность лишь убывает (ease-out — быстрее, чем проявляется туман), и через `FOG_FADE_MS` + запас
 *      его нет в DOM. Содержимое любого слоя aria-hidden, подпись клетки — как раньше («в тени» без цифры).
 *   3. Призрак рисует только то, что было видно в момент смены: если содержимое клетки изменилось (цифра/заметки — undo,
 *      Fill candidates), призрак снимается сразу.
 *   4. Reduce Motion — призраков нет, смена мгновенная (как до PD-251).
 */

export type Light = "lit" | "shadow" | "peek" | null;
export type Veil = "clear" | "fog";

/** Слой прежнего вида клетки, гаснущий после смены света. `peek`/`err` — вид чёткого слоя в момент смены (осмотр b, ошибка). */
export interface FogGhost {
  veil: Veil;
  peek: boolean;
  err: boolean;
  /** Date.now(), после которого призрак убирается из DOM. */
  until: number;
}

export interface FadeTrack {
  light: readonly Light[];
  /** Содержимое клетки: value·1024 + маска заметок; 0 — пусто или подсказка (не меняется светом). */
  sig: readonly number[];
  wrong: readonly boolean[];
  ghost: readonly (FogGhost | null)[];
}

/** Длительность кроссфейда (мс) — та же, что `--lantern-ms` в styles/lantern.css. */
export const FOG_FADE_MS = 200;
/** Запас до удаления призрака: переход идёт на compositor по времени, таймер главного потока может опоздать. */
export const FOG_GHOST_SLACK_MS = 60;

export const veilOf = (l: Light): Veil | null => (l === null ? null : l === "shadow" ? "fog" : "clear");

/**
 * Следующее состояние учёта по текущему свету/содержимому клеток. Идемпотентна: повторный вызов с тем же входом возвращает те же
 * призраки (те же объекты — `memo` клеток не перерисовывает). `motion` зовётся лениво, только если свет какой-то клетки сменился.
 */
export function stepFade(
  prev: FadeTrack | null,
  light: readonly Light[],
  sig: readonly number[],
  wrong: readonly boolean[],
  now: number,
  motion: () => boolean,
): FadeTrack {
  let moving: boolean | undefined;
  const ghost = light.map((l, i): FogGhost | null => {
    const cv = veilOf(l);
    if (!prev || cv === null || sig[i] === 0 || prev.sig[i] !== sig[i]) return null;
    const pv = veilOf(prev.light[i] ?? null);
    if (pv !== null && pv !== cv) {
      moving ??= motion();
      if (!moving) return null;
      return { veil: pv, peek: prev.light[i] === "peek", err: prev.wrong[i] === true, until: now + FOG_FADE_MS + FOG_GHOST_SLACK_MS };
    }
    const g = prev.ghost[i] ?? null;
    return g && g.until > now ? g : null;
  });
  return { light, sig, wrong, ghost };
}

/** Ближайший момент, когда какой-то призрак пора убрать (null — призраков нет). */
export function nextExpiry(track: FadeTrack): number | null {
  let min: number | null = null;
  for (const g of track.ghost) if (g && (min === null || g.until < min)) min = g.until;
  return min;
}

/** Reduce Motion: тот же запрос, что в tokens.css (`--mo: 0`). Нет matchMedia — движение есть (как useSheetSwipe). */
export const fogMotion = (): boolean => !(typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
