import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import uk from "./locales/uk.json";

export const SUPPORTED_LOCALES = ["en", "uk", "ru"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const resources = {
  en: { translation: en },
  uk: { translation: uk },
  ru: { translation: ru },
} as const;

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Язык системы (navigator.language / languages) → поддерживаемая локаль, иначе en. */
export function detectLocale(languages: readonly string[] = navigator.languages ?? [navigator.language]): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0] ?? "";
    if (isLocale(base)) return base;
  }
  return "en";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLocale(),
  fallbackLng: "en",
  supportedLngs: SUPPORTED_LOCALES,
  interpolation: { escapeValue: false },
});

export default i18n;
