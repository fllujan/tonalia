// Community translations (SPEC 11.5): what `pnpm i18n:check` (and the CI) reports.
import { checkLanguages } from "../../scripts/check-i18n.mjs";
import en from "./en.json";
import es from "./es.json";

const EN = {
  title: "Library",
  count_one: "{{count}} track",
  count_other: "{{count}} tracks",
  nav: { export: "Export to {{program}}" },
};

describe("i18n:check", () => {
  it("passes the real files", () => {
    const report = checkLanguages({ es, en });
    expect(report.errors).toEqual([]);
  });

  it("requires es and en to be complete and equal", () => {
    const report = checkLanguages({ en: EN, es: { ...EN, title: "Biblioteca", extra: "x" } });
    expect(report.errors).toContain("es: extra key «extra»");
    const missing = checkLanguages({ en: EN, es: { title: "Biblioteca" } });
    expect(missing.errors).toContain("es: missing key «nav.export»");
  });

  it("lets a community language miss keys (English fills them) but says which", () => {
    const report = checkLanguages({
      en: EN,
      es: EN,
      fr: {
        title: "Bibliothèque",
        count_one: "{{count}} morceau",
        count_other: "{{count}} morceaux",
      },
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual(["fr: 1 key missing, English is shown instead: nav.export"]);
  });

  it("rejects extra keys, empty texts and changed placeholders", () => {
    const report = checkLanguages({
      en: EN,
      es: EN,
      de: {
        title: "",
        tiitle: "Bibliothek",
        count_other: "{{n}} Titel",
        nav: { export: "Nach {{program}} exportieren" },
      },
    });
    expect(report.errors).toEqual([
      "de: empty text «title»",
      "de: extra key «tiitle»",
      "de: «count_other» must use {{count}}, not {{n}}",
    ]);
  });

  it("follows each language's plural forms", () => {
    // Polish has one / few / many / other; Japanese only other.
    const report = checkLanguages({
      en: EN,
      es: EN,
      pl: {
        title: "Biblioteka",
        count_one: "{{count}} utwór",
        count_few: "{{count}} utwory",
        count_many: "{{count}} utworów",
        count_other: "{{count}} utworu",
        nav: { export: "Eksportuj do {{program}}" },
      },
      ja: {
        title: "ライブラリ",
        count_other: "{{count}} 曲",
        nav: { export: "{{program}} に書き出す" },
      },
    });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    const wrong = checkLanguages({ en: EN, es: EN, ja: { count_few: "{{count}}" } });
    expect(wrong.errors).toContain("ja: extra key «count_few»");
  });

  it("needs every language to name itself", () => {
    const report = checkLanguages(
      { en: EN, es: EN, it: { title: "Libreria" } },
      { requireName: true },
    );
    expect(report.errors).toContain("it: missing key «language.name» (the language's own name)");
  });
});
