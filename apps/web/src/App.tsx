import { useTranslation } from "react-i18next";
import { SUPPORTED_LOCALES } from "./i18n";

/**
 * PD-0: оболочка без экранов. Макет Today/таб-бар — на утверждении у владельца,
 * компоненты сетки/панели/таб-бара появятся отдельными тикетами.
 */
export function App() {
  const { t, i18n } = useTranslation();
  return (
    <main style={{ flex: 1, display: "grid", placeItems: "center", gap: 16 }}>
      <h1>{t("app.name")}</h1>
      <label style={{ fontSize: 16 }}>
        {t("settings.language")}:{" "}
        <select
          style={{ fontSize: 16 }}
          value={i18n.resolvedLanguage}
          onChange={(event) => void i18n.changeLanguage(event.target.value)}
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {locale}
            </option>
          ))}
        </select>
      </label>
    </main>
  );
}
