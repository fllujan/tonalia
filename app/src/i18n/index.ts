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

const STORAGE_KEY = "tonalia.language";

/** The language chosen in Settings, or else the system's. */
export function initialLanguage(candidates: readonly string[] = navigator.languages): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && (LANGUAGES as readonly string[]).includes(stored)) return stored as Language;
  } catch {
    // Storage unavailable: fall back to the system language.
  }
  return detectLanguage(candidates);
}

export function saveLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // Ignore: the choice simply won't persist.
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage(),
  fallbackLng: "es",
  interpolation: { escapeValue: false },
});

export default i18n;
