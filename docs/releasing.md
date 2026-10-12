# Publicar una versión / Releasing

## Español

Tonalia se actualiza sola desde **GitHub Releases** (SPEC 10.2). La app consulta
`https://github.com/fllujan/tonalia/releases/latest/download/latest.json`, comprueba la firma
de la actualización con la clave pública de `app/src-tauri/tauri.conf.json` y solo la instala
cuando el usuario pulsa «Instalar y reiniciar». La comprobación se desactiva en
**Ajustes → Actualizaciones**; no envía ningún dato del usuario.

### Claves de firma (una sola vez)

- La clave privada se genera con `pnpm tauri signer generate -w ~/.tauri/tonalia.key -p <contraseña>`
  y **nunca** se sube al repositorio. La pública (`~/.tauri/tonalia.key.pub`) va en
  `plugins.updater.pubkey` de `tauri.conf.json`.
- En GitHub → *Settings → Secrets and variables → Actions*, crea dos secretos:
  `TAURI_SIGNING_PRIVATE_KEY` (contenido de `~/.tauri/tonalia.key`) y
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (contenido de `~/.tauri/tonalia.key.password`).
- Si se pierde la clave privada, las apps instaladas no aceptarán actualizaciones firmadas con
  otra: guarda una copia de seguridad de `~/.tauri/`.

### Publicar

1. Sube la versión en `app/src-tauri/tauri.conf.json`, `app/package.json`,
   `app/src-tauri/Cargo.toml` y `engine/pyproject.toml` (las tres primeras deben coincidir con
   la etiqueta; el workflow lo comprueba).
2. Crea una etiqueta anotada; su mensaje son las notas que verá el usuario en «Novedades»:
   `git tag -a v0.2.0 -m "Atajos de teclado y mensajes de error claros"` y `git push origin v0.2.0`.
3. El workflow **Release** compila los instaladores firmados de macOS (arm64 y x64) y Windows,
   genera `latest.json` (`scripts/updater_manifest.py`) y crea un **borrador** de release.
4. Revisa el borrador, prueba un instalador y pulsa **Publish**: desde ese momento las apps
   instaladas ven la actualización.

> Las descargas de un repositorio **privado** no son públicas: para que el actualizador funcione
> el repositorio (o al menos sus releases) debe ser público.

## English

Tonalia updates itself from **GitHub Releases** (SPEC 10.2). The app reads
`releases/latest/download/latest.json`, verifies the update's signature against the public key
in `app/src-tauri/tauri.conf.json` and installs it only when the user presses “Install and
restart”. The check can be turned off in **Settings → Updates** and sends no user data.

- **Keys:** the private key lives in `~/.tauri/tonalia.key` (never in the repository); add it and
  its password as the repository secrets `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Back up `~/.tauri/`: without the key, installed apps will
  not accept new updates.
- **Release:** bump the version (tauri.conf.json, package.json, Cargo.toml, pyproject.toml), push
  an annotated tag `vX.Y.Z` whose message is the release notes, review the draft release created
  by the **Release** workflow and publish it.
- Downloads from a **private** repository are not public: the updater needs public releases.
