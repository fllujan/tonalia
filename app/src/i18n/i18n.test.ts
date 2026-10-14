import { detectLanguage, initialLanguage, resources, saveLanguage } from ".";

function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as object, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

describe("i18n", () => {
  it("es and en define exactly the same keys", () => {
    expect(keys(resources.en.translation).sort()).toEqual(keys(resources.es.translation).sort());
  });

  it("has no empty strings", () => {
    for (const lng of [resources.es, resources.en]) {
      const flat = JSON.stringify(lng.translation);
      expect(flat).not.toContain('""');
    }
  });

  it("detects the language from browser tags", () => {
    expect(detectLanguage(["en-GB", "es"])).toBe("en");
    expect(detectLanguage(["es-MX"])).toBe("es");
    expect(detectLanguage(["fr-FR", "de"])).toBe("es");
  });

  it("remembers the chosen language over the system one", () => {
    localStorage.clear();
    expect(initialLanguage(["en-US"])).toBe("en");
    saveLanguage("es");
    expect(initialLanguage(["en-US"])).toBe("es");
    localStorage.setItem("tonalia.language", "fr");
    expect(initialLanguage(["en-US"])).toBe("en");
    localStorage.clear();
  });
});
