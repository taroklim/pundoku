import { useEffect, useState } from "react";
import { useTabActive } from "../shell/tabSlide";

/**
 * Клякса «на экране»: её вкладка активна (`TabActiveContext`) и документ не скрыт (приложение не в фоне). Скрытую кляксу
 * не видно: она стоит без анимаций (`PetBlot`) и её настроение не считается показанным (`useWakeOnce`).
 */
export function usePetLive(): boolean {
  const tabActive = useTabActive();
  const [visible, setVisible] = useState(() => typeof document === "undefined" || document.visibilityState !== "hidden");
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);
  return tabActive && visible;
}

/**
 * PD-297: клякса в пределах экрана (IntersectionObserver, корень — окно: учитывается и обрезка прокручиваемыми предками —
 * карточка результата, лист дня Year, Настройки). Ушла за край — `PetBlot` ставит дыханию паузу (`animation-play-state`), без
 * ремаунта: вернулась — вдох продолжается с того же места. Пока наблюдатель не ответил (и там, где его нет) — считаем видимой.
 */
export function usePetOnScreen(): [(el: Element | null) => void, boolean] {
  const [el, setEl] = useState<Element | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (last) setOnScreen(last.isIntersecting);
    });
    io.observe(el);
    return () => {
      io.disconnect();
      setOnScreen(true);
    };
  }, [el]);
  return [setEl, onScreen];
}
