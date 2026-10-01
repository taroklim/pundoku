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
 * - всё, что позже окна: перехватчик одноразовый и снимается сам.
 */
export const GHOST_CLICK_GRACE_MS = 350;
/** Страховка: если `pointerup` так и не пришёл (длинное удержание/потеря события) — снимаем перехватчик сами. */
const MAX_HOLD_MS = 10_000;

let disarmCurrent: (() => void) | null = null;

/** Вызывать из обработчика `pointerdown`, который прервал анимацию и перерисовал экран; `down` — это событие. */
export function swallowGhostClick(down: Event): void {
  disarmCurrent?.();

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
