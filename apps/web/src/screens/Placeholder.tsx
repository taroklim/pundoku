import { useTranslation } from "react-i18next";
import type { TabId } from "../shell/tabs";

/**
 * Заглушка экрана вкладки: локализованный заголовок + строка «скоро».
 * Today/Play наполняются в PD-11+; Year — экран полотна владельцем не утверждён (только заглушка).
 */
export function Placeholder({ tab }: { tab: TabId }) {
  const { t } = useTranslation();
  return (
    <>
      <header className="toolbar">
        <h1 className="title">{t(`tabs.${tab}`)}</h1>
      </header>
      <p className="subline">{t("screens.soon")}</p>
    </>
  );
}
