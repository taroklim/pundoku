/**
 * PD-295: скрытая диагностика (технический экран для владельца, не продуктовая функция). Не в навигации, не в таб-баре и не
 * в сайдбаре; тексты — en без i18n (технический экран). Включается:
 *  - адресом `#/diag` (Safari, dev) — флаг ставится до загрузки приложения, адрес сменяется на `#/year`;
 *  - в установленной PWA (адресной строки нет) — 7 быстрых тапов по строке версии в Settings → About: флаг + перезагрузка на Year.
 * Выключается кнопкой «diag off» на самой панели или теми же 7 тапами. Флаг — localStorage (`pundoku.diag`), как прочие
 * локальные предпочтения устройства (settings/prefs.ts).
 */
export const DIAG_KEY = "pundoku.diag";
export const DIAG_HASH = "#/diag";
/** Тапов по строке версии, чтобы переключить диагностику, и окно, в которое они должны уложиться. */
export const DIAG_TAPS = 7;
export const DIAG_TAP_WINDOW_MS = 4000;

export function diagEnabled(): boolean {
  try {
    return localStorage.getItem(DIAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDiag(on: boolean): void {
  try {
    if (on) localStorage.setItem(DIAG_KEY, "1");
    else localStorage.removeItem(DIAG_KEY);
  } catch {
    // приватный режим без localStorage — диагностика просто не включится
  }
}

/** Адрес `#/diag[...]`: включить флаг и уйти на Year (маршрута `diag` у приложения нет). Возвращает true, если адрес был такой. */
export function consumeDiagHash(loc: Pick<Location, "hash"> = window.location, history: Pick<History, "replaceState"> = window.history): boolean {
  if (!loc.hash.startsWith(DIAG_HASH)) return false;
  setDiag(true);
  history.replaceState(null, "", "#/year");
  return true;
}

let taps: number[] = [];
/**
 * Тап по строке версии в Settings: `DIAG_TAPS` тапов за `DIAG_TAP_WINDOW_MS` переключают диагностику и перезагружают приложение
 * (аудит слушателей ставится только до загрузки кода приложения). Возвращает новое состояние флага, если переключили, иначе null.
 */
export function diagTap(now: number = Date.now(), reload: (hash: string) => void = reloadTo): boolean | null {
  taps = [...taps.filter((t) => now - t < DIAG_TAP_WINDOW_MS), now];
  if (taps.length < DIAG_TAPS) return null;
  taps = [];
  const on = !diagEnabled();
  setDiag(on);
  reload(on ? "#/year" : window.location.hash);
  return on;
}

function reloadTo(hash: string): void {
  window.history.replaceState(null, "", hash);
  window.location.reload();
}

/** Только для тестов. */
export function resetDiagTaps(): void {
  taps = [];
}
