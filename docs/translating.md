# Translating Tonalia · Traducir Tonalia

[English](#english) · [Español](#español)

## English

Tonalia's interface is in Spanish and English, and anyone can add another language. A language is **one file**, `app/src/i18n/<code>.json`. The app finds every file in that folder when it is built and lists it in **Settings → General → Language** under the language's own name.

### Add a language

1. Copy `app/src/i18n/en.json` to a file named after the language's [BCP 47 code](https://www.w3.org/International/articles/language-tags/): `fr.json`, `de.json`, `pt-BR.json`…
2. Set `language.name` to the language's name **in that language** ("Français", "Deutsch", "Português (Brasil)"). It is how the selector shows it.
3. Translate the **values**, never the keys. You can stop half way: any key you leave out is shown in English, so delete the ones you have not translated rather than leaving English text in your file.
4. Check it: `cd app && pnpm i18n:check` (it also runs in CI). Then try it with `pnpm tauri dev`, or open the browser preview with `pnpm dev`.
5. Open a pull request. Please say whether you speak the language natively and which parts you translated.

### Rules the check enforces

- **No extra keys.** A key that does not exist in `en.json` is a typo or a leftover, so it fails.
- **No empty texts.** Leave the key out instead and English is used.
- **Keep the `{{placeholders}}`.** `{{count}}`, `{{name}}`, `{{program}}`… are filled in by the app, so keep them exactly as they are. You can move them anywhere in the sentence.
- **Plurals follow your language.** English has `key_one` and `key_other`. Write the forms your language uses (`_one`, `_two`, `_few`, `_many`, `_other`, as in [CLDR plural rules](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)). Only `_other` is required, because it is used for any form that is missing. A singular form may leave out `{{count}}` ("one track").
- **Spanish and English are complete.** Every new text of the app is added to both. The check fails if one of them misses a key.

### Words to keep as they are

- **Tonalia**, and the names of other programs (Rekordbox, Traktor, Serato, VirtualDJ, Engine DJ, FFmpeg, Rubber Band).
- The key notations: the 1A–12B notation is called "Alphanumeric" (translate the word), and the wheel is the "Harmonic wheel". Never use the trademarked name of that notation.
- Musical signs (♯, ♭), BPM, LUFS and kbps.

The user guide (`docs/user-guide.<code>.md`) can be translated too, but it is optional and has no check.

## Español

La interfaz de Tonalia está en español y en inglés, y cualquiera puede añadir otro idioma. Un idioma es **un archivo**, `app/src/i18n/<código>.json`. La app encuentra todos los archivos de esa carpeta al construirse y los muestra en **Ajustes → General → Idioma** con el nombre del idioma en ese idioma.

### Añadir un idioma

1. Copia `app/src/i18n/en.json` a un archivo con el [código BCP 47](https://www.w3.org/International/articles/language-tags/) del idioma: `fr.json`, `de.json`, `pt-BR.json`…
2. Pon en `language.name` el nombre del idioma **en ese idioma** («Français», «Deutsch», «Português (Brasil)»). Así aparece en el selector.
3. Traduce los **valores**, nunca las claves. Puedes dejarlo a medias: las claves que no estén se muestran en inglés, así que borra las que no hayas traducido en vez de dejar el texto inglés en tu archivo.
4. Compruébalo: `cd app && pnpm i18n:check` (también se ejecuta en la CI). Después pruébalo con `pnpm tauri dev` o con la vista previa en el navegador (`pnpm dev`).
5. Abre un pull request. Indica si el idioma es tu lengua materna y qué partes has traducido.

### Lo que exige la comprobación

- **Ninguna clave de más.** Una clave que no existe en `en.json` es una errata o un resto, y falla.
- **Ningún texto vacío.** Si no tienes la traducción, quita la clave y se usará el inglés.
- **Conserva los `{{marcadores}}`.** `{{count}}`, `{{name}}`, `{{program}}`… los rellena la app: déjalos tal cual. Puedes moverlos de sitio dentro de la frase.
- **Los plurales siguen tu idioma.** El inglés tiene `clave_one` y `clave_other`. Escribe las formas que use tu idioma (`_one`, `_two`, `_few`, `_many`, `_other`, según las [reglas de plural de CLDR](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html)). Solo `_other` es obligatoria, porque se usa para las formas que falten. La forma singular puede omitir `{{count}}` («un tema»).
- **El español y el inglés están completos.** Cada texto nuevo de la app se añade a los dos. La comprobación falla si a uno le falta una clave.

### Palabras que no se traducen

- **Tonalia** y los nombres de otros programas (Rekordbox, Traktor, Serato, VirtualDJ, Engine DJ, FFmpeg, Rubber Band).
- Las notaciones: la de 1A–12B se llama «Alfanumérica» (traduce la palabra) y la rueda es la «Rueda armónica». No uses nunca el nombre registrado de esa notación.
- Los signos musicales (♯, ♭), BPM, LUFS y kbps.

La guía de usuario (`docs/user-guide.<código>.md`) también se puede traducir, pero es opcional y no tiene comprobación.
