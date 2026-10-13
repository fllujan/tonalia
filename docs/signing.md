# Firma de código / Code signing

Así se firma Tonalia (SPEC 10.3):

- **macOS:** las releases van firmadas con un certificado **Developer ID Application** y
  **notarizadas** por Apple, así que se abren sin avisos. La CI y las compilaciones locales usan
  una firma *ad-hoc* (`bundle.macOS.signingIdentity: "-"` en `tauri.conf.json`), necesaria para
  que Apple Silicon ejecute la app. `scripts/build_engine.py` firma uno a uno todos los binarios
  del motor (PyInstaller) y los sidecars (FFmpeg, Rubber Band) y calcula la versión mínima de
  macOS a partir de ellos.
- **Windows:** sin firma; SmartScreen avisa la primera vez.
- Las **actualizaciones** van siempre firmadas, con la clave propia de Tauri (minisign), que no
  depende de Apple ni de Microsoft (ver `docs/releasing.md`).

## Firma y notarización de Apple

- **Cómo funciona.** Con la variable `APPLE_SIGNING_IDENTITY` definida, `build_engine.py`:
  - firma cada binario con esa identidad, el *hardened runtime* (`--options runtime`), un sello
    de tiempo y `app/src-tauri/Entitlements.plist`;
  - escribe en `tauri.bundle.conf.json` la misma identidad, `hardenedRuntime` y los
    entitlements, para que Tauri firme la app igual.

  Si además están `APPLE_ID`, `APPLE_PASSWORD` y `APPLE_TEAM_ID`, Tauri notariza la app y grapa
  el ticket. Después, `release.yml` notariza también el `.dmg` y le grapa su ticket (con
  reintentos: en la v0.1.0 el grapado de Tauri falló en Intel mientras el ticket se propagaba),
  para que el instalador se abra sin consultar a Apple por internet. Sin la variable, todo sigue
  con la firma ad-hoc.
- **Entitlements.** Solo dos excepciones del hardened runtime, que el motor necesita: cargar sus
  librerías de Python (`cs.disable-library-validation`) y memoria ejecutable
  (`cs.allow-unsigned-executable-memory`: ctypes y PyTorch). Sin sandbox, porque Tonalia lee y
  escribe la música del usuario.
- **En GitHub** (`release.yml`): el paso «Import the Developer ID certificate» importa el `.p12`
  en un llavero temporal con una contraseña aleatoria y exporta su identidad. Necesita estos
  secretos del repositorio:
  - `APPLE_CERTIFICATE`: el `.p12` en base64. Se exporta desde *Acceso a Llaveros* → Mis
    certificados → «Developer ID Application: …» → Exportar, con una contraseña; después,
    `base64 -i certificado.p12 | gh secret set APPLE_CERTIFICATE`.
  - `APPLE_CERTIFICATE_PASSWORD`: la contraseña de ese `.p12`.
  - `APPLE_ID`: el correo de la cuenta de Apple Developer.
  - `APPLE_PASSWORD`: una contraseña de app (account.apple.com → Inicio de sesión y seguridad →
    Contraseñas de apps).
  - `APPLE_TEAM_ID`: el Team ID del certificado (entre paréntesis en su nombre).
- **En local:** `APPLE_SIGNING_IDENTITY="Developer ID Application: … (TEAMID)"
  ./scripts/build-engine.sh` y después `pnpm tauri build …` con la misma variable (y las de
  notarización si se quiere notarizar).
- **Comprobar:** `spctl -a -vv /Applications/Tonalia.app` → *source=Notarized Developer ID*.

## Añadir firma de Windows

- **Certificado propio (OV/EV):** importa el `.pfx` en el runner y define
  `bundle.windows.certificateThumbprint`, `digestAlgorithm: "sha256"` y `timestampUrl`.
- **Azure Trusted Signing / Artifact Signing** (sin hardware): define `bundle.windows.signCommand`,
  por ejemplo `artifact-signing-cli -e <endpoint> -a <cuenta> -c <perfil> -d Tonalia %1`, y pasa
  las credenciales de Azure como secretos.
- Tauri firma el ejecutable, el instalador NSIS y el MSI; firma también
  `engine/tonalia-engine.exe` para que SmartScreen no avise del motor.

## English (summary)

Releases are signed with a **Developer ID Application** certificate and **notarized** by Apple.
CI and local builds keep an **ad-hoc** signature. Setting `APPLE_SIGNING_IDENTITY` makes
`build_engine.py` sign every engine and sidecar binary with that identity, the hardened runtime,
a timestamp and `app/src-tauri/Entitlements.plist` (library validation off and unsigned executable
memory, both needed by the bundled Python). It also tells Tauri to sign the app the same way.
`APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID` make Tauri notarize
the app. `release.yml` imports the `APPLE_CERTIFICATE` secret (base64 `.p12`, with
`APPLE_CERTIFICATE_PASSWORD`) into a throwaway keychain. Windows builds are unsigned, and
**updates are always signed** with Tauri's own key. To add **Windows signing**, set
`certificateThumbprint` (own certificate) or `signCommand` (Azure Trusted Signing) in
`bundle.windows`.
