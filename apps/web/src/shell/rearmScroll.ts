/**
 * PD-295: «перевзвести» касательную прокрутку панели после того, как она стала видимой.
 *
 * Дефект владельца (iPhone 16, установленная PWA): пустой Год выше экрана на ~45 px, а палец его не прокручивает; Today и
 * Settings прокручиваются. Отличие Year: его панель — в стопке вкладок (`.tab-pane`), и прокручиваемой она становится НЕ в покое:
 * первый показ — посреди слайда (transform + will-change, PD-161), год из IndexedDB приходит посреди слайда, и только тогда
 * содержимое перерастает панель (до загрузки — раскладка «полного» года, она помещается); повторные показы — из
 * `visibility: hidden` (неактивная панель, экран поверх стопки, подсмотр жеста «назад»), а смена visibility раскладку не
 * трогает. В iOS WebKit касательную прокрутку ведёт отдельный нативный слой прокрутки, который движок заводит по итогам
 * раскладки видимого контейнера; Settings (новый слой при каждом открытии) и Today (выше экрана с первого кадра) этих переходов
 * не проходят. Playwright (webkit/chromium) нативную касательную прокрутку iOS не воспроизводит — проверить можно только на
 * устройстве (#/diag).
 *
 * Меры: короткое переключение `overflow-y: hidden` → прежнее значение с принудительной раскладкой между ними — у видимой
 * панели в покое движок заново решает, прокручиваемая ли она, и заводит слой прокрутки. Позиция прокрутки сохраняется.
 * Зовётся движком вкладок (`tabSlide.ts`) по концу перехода/возврата и после подсмотра жеста «назад»; панель без
 * прокручиваемого содержимого или с `overflow: hidden` (хаб Play, партия) не трогается.
 */
let rearmCount = 0;
/** Сколько раз панель перевзведена за сессию — для #/diag. */
export const rearmTotal = (): number => rearmCount;

export function rearmScroll(el: HTMLElement | null | undefined): boolean {
  if (!el || typeof getComputedStyle !== "function") return false;
  const oy = getComputedStyle(el).overflowY;
  if (oy !== "auto" && oy !== "scroll") return false;
  if (el.scrollHeight - el.clientHeight < 1) return false;
  const top = el.scrollTop;
  const inline = el.style.overflowY;
  el.style.overflowY = "hidden";
  void el.offsetHeight; // раскладка с выключенной прокруткой: прежнее решение движка сбрасывается
  el.style.overflowY = inline;
  void el.offsetHeight; // и снова — уже видимая, в покое
  if (el.scrollTop !== top) el.scrollTop = top;
  rearmCount += 1;
  return true;
}
