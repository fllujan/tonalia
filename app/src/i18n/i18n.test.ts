import i18next from "i18next";
import {
  detectLanguage,
  initialLanguage,
  LANGUAGES,
  languageName,
  loadTranslations,
  orderLanguages,
  resources,
  saveLanguage,
} from ".";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("es and en define exactly the same keys", () => {
    const en = resources.en?.translation ?? {};
    const es = resources.es?.translation ?? {};
    expect(keys(en).sort()).toEqual(keys(es).sort());
  });

  it("has no empty strings", () => {
    for (const lng of Object.values(resources)) {
      const flat = JSON.stringify(lng.translation);
      expect(flat).not.toContain('""');
    }
  });

  it("lists the language files present, each by its own name", () => {
    expect(LANGUAGES).toEqual(["es", "en"]);
    expect(languageName("es")).toBe("Español");
    expect(languageName("en")).toBe("English");
    const found = loadTranslations({
      "./pt-BR.json": { default: { language: { name: "Português (Brasil)" } } },
      "./en.json": { default: { language: { name: "English" } } },
      "./de.json": { default: { language: { name: "Deutsch" } } },
      "./es.json": { default: { language: { name: "Español" } } },
    });
    expect(orderLanguages(found)).toEqual(["es", "en", "de", "pt-BR"]);
  });

  it("detects the language from system tags", () => {
    expect(detectLanguage(["en-GB", "es"])).toBe("en");
    expect(detectLanguage(["es-MX"])).toBe("es");
    expect(detectLanguage(["fr-FR", "de"])).toBe("es");
    const available = ["es", "en", "pt", "pt-BR"];
    expect(detectLanguage(["pt-BR"], available)).toBe("pt-BR");
    expect(detectLanguage(["pt-PT"], available)).toBe("pt");
    expect(detectLanguage(["fr-FR", "pt-br"], available)).toBe("pt-BR");
  });

  it("remembers the chosen language over the system one", () => {
    localStorage.clear();
    expect(initialLanguage(["en-US"])).toBe("en");
    saveLanguage("es");
    expect(initialLanguage(["en-US"])).toBe("es");
    localStorage.setItem("tonalia.language", "fr");
    expect(initialLanguage(["en-US"])).toBe("en"); // no fr.json: the system language
    expect(initialLanguage(["en-US"], ["es", "en", "fr"])).toBe("fr");
    localStorage.clear();
  });

  it("shows English for the keys a translation does not have yet", async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      resources: {
        ...resources,
        fr: { translation: { nav: { library: "Bibliothèque" } } },
      },
      lng: "fr",
      fallbackLng: "en",
    });
    expect(i18n.t("nav.library")).toBe("Bibliothèque");
    expect(i18n.t("footer")).toBe(resources.en?.translation.footer);
  });
});
