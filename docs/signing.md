# Firma de código / Code signing

Hoy Tonalia se publica **sin certificados de pago** (SPEC 10.3):

- **macOS:** firma *ad-hoc* (`bundle.macOS.signingIdentity: "-"` en `tauri.conf.json`), necesaria
  para que Apple Silicon ejecute la app descargada. `scripts/build_engine.py` firma también, uno
  a uno, todos los binarios del motor (PyInstaller) y los sidecars (FFmpeg, Rubber Band), y
  calcula la versión mínima de macOS a partir de ellos. Sin notarización, el usuario autoriza la
  app una vez en *Privacidad y seguridad* (ver `docs/install.md`).
- **Windows:** sin firma; SmartScreen avisa la primera vez.
- Las **actualizaciones** sí van siempre firmadas, con la clave propia de Tauri (minisign), que no
  depende de Apple ni de Microsoft (ver `docs/releasing.md`).

## Añadir notarización de Apple (cuando haya cuenta de Apple Developer)

1. Crea un certificado **Developer ID Application** y expórtalo como `.p12`.
2. Añade estos secretos al repositorio: `APPLE_CERTIFICATE` (el `.p12` en base64),
   `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (p. ej.
   `Developer ID Application: Nombre (TEAMID)`), `APPLE_ID`, `APPLE_PASSWORD` (contraseña de app)
   y `APPLE_TEAM_ID`.
3. En `release.yml`, importa el certificado en un llavero temporal antes de compilar y pasa esas
   variables al paso **Build signed installers**; Tauri firma y notariza solo cuando las encuentra.
4. Cambia `signingIdentity` a `null` (o al nombre del certificado), activa
   `"hardenedRuntime": true` y añade un `entitlements.plist` que permita al motor cargar sus
   librerías (`com.apple.security.cs.disable-library-validation`). En `build_engine.py`, firma
   los binarios del motor con la misma identidad y `--options runtime` en lugar de `-`.
5. Comprueba con `spctl -a -vv /Applications/Tonalia.app` → *source=Notarized Developer ID*.

## Añadir firma de Windows

- **Certificado propio (OV/EV):** importa el `.pfx` en el runner y define
  `bundle.windows.certificateThumbprint`, `digestAlgorithm: "sha256"` y `timestampUrl`.
- **Azure Trusted Signing / Artifact Signing** (sin hardware): define `bundle.windows.signCommand`,
  por ejemplo `artifact-signing-cli -e <endpoint> -a <cuenta> -c <perfil> -d Tonalia %1`, y pasa
  las credenciales de Azure como secretos.
- Tauri firma el ejecutable, el instalador NSIS y el MSI; firma también
  `engine/tonalia-engine.exe` para que SmartScreen no avise del motor.

## English (summary)

Tonalia currently ships without paid certificates: macOS builds are **ad-hoc signed** (every
engine and sidecar binary too, by `build_engine.py`, which also derives the minimum macOS),
Windows builds are unsigned, and **updates are always signed** with Tauri's own key. To add
**Apple notarization**, provide a Developer ID certificate and the `APPLE_*` secrets to the build
step, switch to the hardened runtime with an entitlements file and sign the engine with the same
identity. To add **Windows signing**, set `certificateThumbprint` (own certificate) or
`signCommand` (Azure Trusted Signing) in `bundle.windows`.
