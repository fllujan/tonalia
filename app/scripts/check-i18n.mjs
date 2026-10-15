#!/usr/bin/env node
// Checks the translations in src/i18n (SPEC 11.5; see docs/translating.md).
//
// Spanish and English are the reference: both must have exactly the same keys. Any other
// language may miss keys (English is shown for those, key by key) but may not add keys that
// do not exist, leave a text empty or change the {{placeholders}} of a text. Plural keys
// (`_one`, `_few`, `_other`…) follow the plural forms of each language.
//
// Usage: node scripts/check-i18n.mjs   (exit code 1 if there is any error)
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REFERENCE = "en";
const COMPLETE = ["es", "en"];
const PLURAL = /_(zero|one|two|few|many|other)$/;

/** Every leaf of a translation file as "a.b.c" → text. */
function flatten(obj, prefix = "", out = new Map()) {
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === "object") flatten(value, `${prefix}${key}.`, out);
    else out.set(`${prefix}${key}`, value);
  }
  return out;
}

const placeholders = (text) =>
  [...new Set(String(text).match(/{{\s*[\w.]+\s*}}/g) ?? [])]
    .map((p) => p.replace(/[{}\s]/g, ""))
    .sort();

function pluralCategories(lng) {
  try {
    return new Set(new Intl.PluralRules(lng).resolvedOptions().pluralCategories);
  } catch {
    return new Set(["one", "other"]);
  }
}

/**
 * @param {Record<string, object>} files language code → parsed JSON
 * @param {{ requireName?: boolean }} [options]
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function checkLanguages(files, { requireName = false } = {}) {
  const errors = [];
  const warnings = [];
  const reference = flatten(files[REFERENCE] ?? {});
  // Plural groups of the reference: "count" for count_one / count_other.
  const pluralBases = new Set(
    [...reference.keys()].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")),
  );
  const languages = Object.keys(files).sort((a, b) =>
    a === REFERENCE ? -1 : b === REFERENCE ? 1 : a.localeCompare(b),
  );
  for (const lng of languages) {
    const texts = flatten(files[lng]);
    const complete = COMPLETE.includes(lng);
    const categories = pluralCategories(lng);
    const missing = [];
    if (requireName && !texts.has("language.name"))
      errors.push(`${lng}: missing key «language.name» (the language's own name)`);
    if (complete) {
      for (const key of reference.keys())
        if (!texts.has(key)) errors.push(`${lng}: missing key «${key}»`);
    } else {
      for (const key of reference.keys()) {
        if (key === "language.name") continue;
        // A plural group needs only its "other" form: i18next uses it for the rest.
        const base = key.replace(PLURAL, "");
        const wanted = pluralBases.has(base) ? `${base}_other` : key;
        if (wanted === key && !texts.has(key)) missing.push(key);
      }
    }
    for (const [key, text] of texts) {
      const base = key.replace(PLURAL, "");
      const plural = PLURAL.test(key) && pluralBases.has(base);
      const known = complete
        ? reference.has(key) || key === "language.name"
        : reference.has(key) ||
          key === "language.name" ||
          (plural && categories.has(key.match(PLURAL)[1]));
      if (!known) {
        errors.push(`${lng}: extra key «${key}»`);
        continue;
      }
      if (typeof text !== "string" || text.trim() === "") {
        errors.push(`${lng}: empty text «${key}»`);
        continue;
      }
      const source = reference.get(key) ?? reference.get(`${base}_other`);
      if (source === undefined || key === "language.name") continue;
      const want = placeholders(source);
      const got = placeholders(text);
      // A plural form may leave out {{count}} ("one track"), never invent another value.
      const extra = got.filter((p) => !want.includes(p));
      const lost = want.filter((p) => !got.includes(p) && !(plural && p === "count"));
      if (extra.length || lost.length)
        errors.push(
          `${lng}: «${key}» must use ${want.map((p) => `{{${p}}}`).join(", ") || "no placeholders"}, ` +
            `not ${got.map((p) => `{{${p}}}`).join(", ") || "none"}`,
        );
    }
    if (missing.length)
      warnings.push(
        `${lng}: ${missing.length} ${missing.length === 1 ? "key" : "keys"} missing, ` +
          `English is shown instead: ${missing.slice(0, 10).join(", ")}` +
          (missing.length > 10 ? ", …" : ""),
      );
  }
  return { errors, warnings };
}

function main() {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n");
  const files = {};
  for (const name of readdirSync(dir)
    .filter((n) => n.endsWith(".json"))
    .sort())
    files[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(dir, name), "utf8"));
  const { errors, warnings } = checkLanguages(files, { requireName: true });
  for (const w of warnings) console.warn(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
  console.log(
    `${Object.keys(files).length} languages (${Object.keys(files).join(", ")}): ` +
      `${errors.length} errors, ${warnings.length} warnings`,
  );
  if (errors.length) process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
