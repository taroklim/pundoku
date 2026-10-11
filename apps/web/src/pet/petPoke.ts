/**
 * PD-298: реакция Питомца на тап — вариант A «Плюх» (макет `design/pd296-pet-places.html`, md §1; выбор владельца 2026-10-11).
 * Чистая логика без React: порог «тап, а не жест», анти-спам (реакция не перезапускается, усталость в окне 5 с).
 *
 * - Тап — `pointerup` на той же зоне при сдвиге < 8 px и времени < 500 мс. `preventDefault` не вызывается, указатель не
 *   захватывается: прокрутка, свайп листа, жест «назад» с края, начатые на кляксе, работают как раньше.
 * - Тап во время реакции (любой кляксы на экране) игнорируется: без перезапуска, без очереди.
 * - Усталость: тапы в окне 5 с — 1–3-й полная амплитуда, 4–6-й половина, с 7-го только мигание брызг (как при Reduce Motion).
 *   5 с тишины — снова полная. Счётчиков, наград и «пасхалок» нет (геймификация запрещена).
 * - Настроение тапом не меняется; звука и вибрации нет.
 */

/** Длительность «Плюха», мс: [полная, при Reduce Motion] (макет: `--dp-full: 440ms; --dp-rm: 200ms`). */
export const POKE_MS: readonly [full: number, rm: number] = [440, 200];
/** Окно усталости, мс. */
export const POKE_WINDOW_MS = 5000;
/** Порог «тап, а не жест»: сдвиг (px) и время (мс). */
export const TAP_SLOP_PX = 8;
export const TAP_MAX_MS = 500;

/** Амплитуда реакции по номеру тапа в окне: 1–3 → 1, 4–6 → ½, 7+ → 0 (только мигание брызг). */
export function pokeAmp(n: number): 1 | 0.5 | 0 {
  return n <= 3 ? 1 : n <= 6 ? 0.5 : 0;
}

export interface PointerMark {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly t: number;
}

/** Отпускание `up` после нажатия `down` — это тап (тот же указатель, сдвиг < 8 px, < 500 мс), а не прокрутка/свайп. */
export function isTap(down: PointerMark | null, up: PointerMark): boolean {
  if (!down || down.id !== up.id) return false;
  return Math.hypot(up.x - down.x, up.y - down.y) < TAP_SLOP_PX && up.t - down.t < TAP_MAX_MS;
}

/**
 * Общий на приложение журнал тапов (на экране за раз одна вкладка/экран, поэтому «на экран» = «на приложение»): усталость
 * не обходится тапами по соседним превью в Настройках, а «во время реакции» значит — пока реагирует любая клякса.
 */
const taps: number[] = [];
const running = new Set<symbol>();

/**
 * Начать реакцию: `null` — тап проглочен (уже идёт реакция); иначе амплитуда. `token` — кто реагирует (снимается `pokeEnd`).
 */
export function pokeStart(token: symbol, now: number): 1 | 0.5 | 0 | null {
  if (running.size > 0) return null;
  while (taps.length > 0 && now - (taps[0] as number) >= POKE_WINDOW_MS) taps.shift();
  taps.push(now);
  running.add(token);
  return pokeAmp(taps.length);
}

/** Реакция закончилась (или её владелец размонтирован). */
export function pokeEnd(token: symbol): void {
  running.delete(token);
}

/** Тесты: забыть тапы и идущие реакции. */
export function resetPokes(): void {
  taps.length = 0;
  running.clear();
}
