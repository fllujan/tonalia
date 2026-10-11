import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import es from "./es.json";

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const resources = { es: { translation: es }, en: { translation: en } } as const;

export function detectLanguage(candidates: readonly string[] = navigator.languages): Language {
  for (const tag of candidates) {
    const base = tag.toLowerCase().split("-")[0];
    if (base === "es" || base === "en") return base;
  }
  return "es";
}

void i18n.use(initReactI18next).init({
  resources,
  lng: detectLanguage(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

export default i18n;
