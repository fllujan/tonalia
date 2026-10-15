// Interface languages (SPEC 0.6, 11.5): one JSON file per language in this folder, found at
// build time, so adding a translation is adding a file (docs/translating.md). Spanish and
// English are complete; a key a community translation lacks is shown in English.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

type Translation = Record<string, unknown> & { language?: { name?: string } };

const files = import.meta.glob<{ default: Translation }>("./*.json", { eager: true });

/** Language code → its texts, from the files present (`./es.json` → "es"). */
export function loadTranslations(
  found: Record<string, { default: Translation }>,
): Record<string, Translation> {
  return Object.fromEntries(
    Object.entries(found).map(([path, mod]) => [path.replace(/^.*\/|\.json$/g, ""), mod.default]),
  );
}

const translations = loadTranslations(files);

/** Spanish and English first (the complete ones), then the rest by their own name. */
export function orderLanguages(available: Record<string, Translation>): string[] {
  const name = (code: string) => available[code]?.language?.name ?? code;
  const rank = (code: string) => (code === "es" ? 0 : code === "en" ? 1 : 2);
  return Object.keys(available).sort((a, b) => rank(a) - rank(b) || name(a).localeCompare(name(b)));
}

export const LANGUAGES: readonly string[] = orderLanguages(translations);
export type Language = string;

/** A language's own name ("Español", "English"), as its file writes it. */
export function languageName(code: string): string {
  return translations[code]?.language?.name ?? code;
}

export const resources = Object.fromEntries(
  Object.entries(translations).map(([code, translation]) => [code, { translation }]),
);

/** The first system language Tonalia has: the exact tag (pt-BR), then its base (pt). */
export function detectLanguage(
  candidates: readonly string[] = navigator.languages,
  available: readonly string[] = LANGUAGES,
): Language {
  const byLower = new Map(available.map((code) => [code.toLowerCase(), code]));
  for (const tag of candidates) {
    const lower = tag.toLowerCase();
    const found = byLower.get(lower) ?? byLower.get(lower.split("-")[0] ?? "");
    if (found) return found;
  }
  return "es";
}

const STORAGE_KEY = "tonalia.language";

/** The language chosen in Settings, or else the system's. */
export function initialLanguage(
  candidates: readonly string[] = navigator.languages,
  available: readonly string[] = LANGUAGES,
): Language {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && available.includes(stored)) return stored;
  } catch {
    // Storage unavailable: fall back to the system language.
  }
  return detectLanguage(candidates, available);
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
  // Key by key: a text a translation does not have yet is shown in English.
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
