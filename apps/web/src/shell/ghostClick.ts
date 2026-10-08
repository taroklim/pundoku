/**
 * Защита от «призрачного клика» после прерывания анимации тапом (PD-94, QA PD-91).
 *
 * Финал (Play и Today) прерывается на `pointerdown` и сразу перерисовывает экран: под пальцем оказывается карточка
 * результата. `pointerup`/`click` ТОГО ЖЕ касания попадают уже в новый элемент — тап в позиции кнопки «New game» запускал
 * новую партию, тап в позиции кнопок таймлапса/шаринга открывал лист. Прерывающее касание должно только прерывать.
 *
 * Решение: на время этого одного касания (от `pointerdown` до `pointerup` + `GHOST_CLICK_GRACE_MS`) перехватываем
 * `click` в capture-фазе на `window` и гасим его (`preventDefault` + `stopImmediatePropagation`). Не трогаем:
 * - клики без касания указателем — с клавиатуры (Enter/Space) и от VoiceOver/Switch Control приходят с `detail === 0`;
 * - любое следующее касание: новый `pointerdown` снимает перехватчик (обычные тапы после паузы работают);
 * - всё, что позже окна: перехватчик одноразовый и снимается сам;
 * - касание ДРУГОЙ вкладки таб-бара (PD-221): он под пальцем не перерисовывается, его click — не призрак, а выбор вкладки.
 *   Раньше тап по вкладке во время финала только прерывал финал, а вкладка не менялась («тап потерялся»).
 *
 * Касание УЖЕ ВЫБРАННОЙ вкладки (PD-239, QA PD-222) — гасим, как любой хвост: иначе его click — «повторный тап», и на Play
 * это уход на хаб (PD-144) вместо карточки результата. Прерывающее касание только досрочно завершает финал.
 */
export const GHOST_CLICK_GRACE_MS = 350;
/** Страховка: если `pointerup` так и не пришёл (длинное удержание/потеря события) — снимаем перехватчик сами. */
const MAX_HOLD_MS = 10_000;

let disarmCurrent: (() => void) | null = null;

/** Касание пришлось на таб-бар, но не на выбранную вкладку (её click — выбор другой вкладки, не хвост прерывания). */
function touchesOtherTab(down: Event): boolean {
  if (!(down.target instanceof Element) || !down.target.closest('[role="tablist"]')) return false;
  return down.target.closest('[role="tab"]')?.getAttribute("aria-selected") !== "true";
}

/** Вызывать из обработчика `pointerdown`, который прервал анимацию и перерисовал экран; `down` — это событие. */
export function swallowGhostClick(down: Event): void {
  disarmCurrent?.();
  if (touchesOtherTab(down)) return;

  let timer = 0;
  const disarm = () => {
    window.clearTimeout(timer);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("pointerdown", onNextDown, true);
    window.removeEventListener("pointerup", onRelease, true);
    window.removeEventListener("pointercancel", onRelease, true);
    if (disarmCurrent === disarm) disarmCurrent = null;
  };
  function onClick(e: MouseEvent) {
    if (e.detail === 0) return; // клавиатура / вспомогательные технологии — не блокируем
    e.preventDefault();
    e.stopImmediatePropagation();
    disarm();
  }
  function onNextDown(e: Event) {
    if (e !== down) disarm(); // новое касание — это уже осознанный тап, не хвост прерывающего
  }
  function onRelease() {
    window.clearTimeout(timer);
    timer = window.setTimeout(disarm, GHOST_CLICK_GRACE_MS);
  }

  window.addEventListener("click", onClick, true);
  window.addEventListener("pointerdown", onNextDown, true);
  window.addEventListener("pointerup", onRelease, true);
  window.addEventListener("pointercancel", onRelease, true);
  timer = window.setTimeout(disarm, MAX_HOLD_MS);
  disarmCurrent = disarm;
}
