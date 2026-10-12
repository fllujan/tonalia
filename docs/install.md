# Instalar Tonalia / Installing Tonalia

## Español

Descarga el instalador de tu sistema en la página de **Releases** del proyecto en GitHub.

| Sistema | Archivo | Requisitos |
|---|---|---|
| Mac con Apple Silicon (M1–M4) | `Tonalia_X.Y.Z_aarch64.dmg` | macOS 14 Sonoma o posterior |
| Mac con Intel | `Tonalia_X.Y.Z_x64.dmg` | la versión mínima figura en las notas de la release |
| Windows 10/11 de 64 bits | `Tonalia_X.Y.Z_x64-setup.exe` (recomendado) o `.msi` | WebView2 (viene con Windows 11; el instalador lo descarga si falta) |

No hace falta instalar Python, FFmpeg ni nada más: todo va dentro de la app.

### macOS

1. Abre el `.dmg` y arrastra **Tonalia** a **Aplicaciones**.
2. La primera vez, macOS dirá que no puede comprobar el desarrollador: Tonalia lleva una firma
   *ad-hoc* pero no está notarizada por Apple (eso exige una cuenta de pago de Apple Developer).
   - Abre Tonalia una vez y cierra el aviso.
   - Ve a **Ajustes del Sistema → Privacidad y seguridad**, baja hasta *Seguridad* y pulsa
     **Abrir igualmente** junto a «Tonalia». Confirma con tu contraseña.
   - A partir de ahí se abre con normalidad.
3. Alternativa en Terminal (quita la marca de cuarentena de la descarga):
   `xattr -dr com.apple.quarantine /Applications/Tonalia.app`

Si macOS dice que la app «está dañada», es la marca de cuarentena: usa el paso 3.

### Windows

1. Ejecuta `Tonalia_X.Y.Z_x64-setup.exe` y elige idioma (español o inglés). Se instala para tu
   usuario y no pide permisos de administrador.
2. Windows SmartScreen puede avisar de que la app no es conocida (aún no lleva firma de
   Windows): pulsa **Más información → Ejecutar de todas formas**.
3. El `.msi` (en inglés) está pensado para instalaciones gestionadas.

### Actualizaciones y desinstalación

- Tonalia avisa cuando hay una versión nueva y la instala solo si lo pides (se desactiva en
  **Ajustes → Actualizaciones**).
- Desinstalar: en macOS, arrastra la app a la papelera; en Windows, **Configuración →
  Aplicaciones**. Tu biblioteca y tus ajustes se quedan en la carpeta de datos de la app
  (macOS: `~/Library/Application Support/org.tonalia.app`; Windows:
  `%APPDATA%\org.tonalia.app`) por si reinstalas. Tus archivos de música nunca se tocan.

## English

Download the installer for your system from the project's **Releases** page on GitHub.

| System | File | Requirements |
|---|---|---|
| Apple Silicon Mac (M1–M4) | `Tonalia_X.Y.Z_aarch64.dmg` | macOS 14 Sonoma or later |
| Intel Mac | `Tonalia_X.Y.Z_x64.dmg` | the minimum version is in the release notes |
| Windows 10/11 64-bit | `Tonalia_X.Y.Z_x64-setup.exe` (recommended) or `.msi` | WebView2 (included in Windows 11; the installer fetches it if missing) |

Nothing else to install: Python, FFmpeg and the rest are inside the app.

- **macOS:** drag Tonalia to Applications. The app is ad-hoc signed but not notarized, so the
  first time open it once, then go to **System Settings → Privacy & Security** and press
  **Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/Tonalia.app`. A
  “damaged app” message means the quarantine flag: use the `xattr` command.
- **Windows:** run the `-setup.exe` (Spanish or English, per-user, no admin rights). If SmartScreen
  warns, choose **More info → Run anyway**. The English `.msi` is meant for managed installs.
- **Updates** are offered in the app and installed only when you ask (Settings → Updates).
  Uninstalling keeps your library in the app data folder; your music files are never touched.
