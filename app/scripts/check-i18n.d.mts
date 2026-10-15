// Types of check-i18n.mjs, for its test (src/i18n/check.test.ts).
export interface I18nReport {
  errors: string[];
  warnings: string[];
}

export function checkLanguages(
  files: Record<string, object>,
  options?: { requireName?: boolean },
): I18nReport;
