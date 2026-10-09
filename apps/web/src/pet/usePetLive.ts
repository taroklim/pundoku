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
