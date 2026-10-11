# PROGRESS — Tonalia

**Fase actual:** 1 — Biblioteca e importación (empezada a petición del usuario con la aceptación de la Fase 0 aún pendiente de la CI en macOS x64/Windows)

Checklist copiada de `SPEC.md` §4. Cada tarea marcada lleva fecha y notas.

### Fase 0 — Esqueleto y CI
- [x] 0.1 Repo con la estructura de 1.2, LICENSE AGPL-3.0, README, `.editorconfig` y `.gitignore`. — 2026-10-11
- [x] 0.2 `engine/`: proyecto Python (pyproject, ruff, mypy, pytest) con el bucle JSON-RPC por stdio y `engine.ping`. — 2026-10-11. Dispatcher en `rpc.py`, métodos en `server.py`, evento `ready` al arrancar.
- [x] 0.3 `app/`: Tauri 2 + React + TS + Tailwind + i18n (es/en) + tema claro/oscuro, con una ventana que muestra "Motor: conectado" tras un `engine.ping`. — 2026-10-11. Tokens completos de DESIGN.md en `tokens.css` + `tailwind.config.ts` (Tailwind 4 vía `@config`), fuentes locales, i18n es/en, tema claro/oscuro/sistema, icono de app. El puente real al motor llega en 0.4 (hasta entonces la ventana muestra "desconectado").
- [x] 0.4 `engine.rs`: lanzar el sidecar, puente de mensajes, reinicio automático y eventos al frontend. — 2026-10-11. Comando `engine_request`, eventos `engine://event` / `engine://progress`, `engine.exited` + `engine.restarted`, backoff 250 ms→10 s. Verificado en dev: ping al arrancar, reinicio tras `kill -9` y sin huérfanos al salir. En dev el motor se lanza con `uv run`; `TONALIA_ENGINE_CMD` (array JSON) lo sobrescribe. `TONALIA_LOG_LEVEL=DEBUG` registra cada petición.
- [x] 0.5 Scripts para descargar binarios de FFmpeg y Rubber Band por plataforma (con verificación de checksums) y construir el sidecar con PyInstaller con el nombre por *target triple*. — 2026-10-11. `scripts/fetch_binaries.py` (+ `.sh`/`.ps1`) con SHA-256 fijados en `scripts/binaries.lock.json` (FFmpeg 9.0.2, Rubber Band 4.0.0); sidecars `ffmpeg-<triple>`, `rubberband-<triple>`. `scripts/build_engine.py` genera `binaries/engine/` (PyInstaller one-folder, con smoke test) y `binaries/tauri.bundle.conf.json`. Verificado en macOS arm64: `.app` + `.dmg` generados; la app de release lanza el motor empaquetado y responde a `engine.ping` sin `uv` en el PATH.
- [x] 0.6 Generación de tipos TS desde los esquemas pydantic. — 2026-10-11. `tonalia_engine/schema_export.py` + `app/scripts/gen-types.mjs` (json-schema-to-typescript); `scripts/gen-types [--check]` y `pnpm gen-types:check` para la CI. Sustituye al stub manual de 0.3.
- [x] 0.7 GitHub Actions: lint + tests + build en macOS arm64, macOS x64 y Windows x64, subiendo los instaladores como artefactos. — 2026-10-11. `.github/workflows/ci.yml` validado con actionlint. Repo privado `fllujan/tonalia` creado. Primera ejecución: Windows falló en Prettier por finales de línea CRLF (corregido con `.gitattributes`); macOS arm64 pasó lint y tests pero falló `bundle_dmg.sh` (en investigación).

**Aceptación:** el instalador de cada plataforma abre la app y muestra "Motor: conectado".

#### Resumen de la Fase 0 (2026-10-11)

**Qué se hizo:** monorepo con la estructura de SPEC §1.2; motor Python con JSON-RPC 2.0 por stdio; app Tauri 2 + React con todos los tokens de DESIGN.md, i18n es/en y tema claro/oscuro/sistema; puente Rust con supervisión y reinicio automático del motor; descarga verificada de FFmpeg/Rubber Band; motor empaquetado con PyInstaller; tipos TS generados desde pydantic; CI para tres plataformas.

**Cómo probarlo a mano:**
1. `cd app && pnpm install && pnpm tauri dev` → la ventana muestra "Motor: conectado".
2. Matar el proceso `python -m tonalia_engine` → la insignia pasa a "reiniciando…" y vuelve a "conectado".
3. `./scripts/fetch-binaries.sh && ./scripts/build-engine.sh && cd app && pnpm tauri build --config src-tauri/binaries/tauri.bundle.conf.json` → abrir el `.dmg`, instalar y ejecutar Tonalia.

**Criterio de aceptación:**
- macOS arm64 (local): ✅ `.app` y `.dmg` generados; la app de release lanza el motor empaquetado y este responde a `engine.ping`. La captura de la ventana no fue posible (sin permiso de grabación de pantalla); el texto "Motor: conectado" ante un ping correcto está cubierto por los tests de Vitest.
- macOS x64 y Windows x64: ⏳ pendientes de la primera ejecución de la CI (hace falta un remote en GitHub).

**Pendiente:** CI en verde en las tres plataformas y probar los instaladores descargados de macOS x64 y Windows.

### Fase 1 — Biblioteca e importación
- [x] 1.1 SQLite con migraciones y el esquema de 1.4. — 2026-10-11. `db.py`: migraciones transaccionales con `PRAGMA user_version`, copia de seguridad antes de actualizar una base existente, rechazo de bases de una versión más nueva, WAL + claves foráneas. `paths.py` + `TONALIA_DATA_DIR` desde Rust (app data dir de Tauri). Desviaciones menores del esquema: `segments.start_sec/end_sec` (evita la palabra reservada `end`), `tag_backups.path` sin clave foránea (las copias sobreviven a quitar el tema), `label` admite también `chorus`.
- [x] 1.2 `audio_io.py`: decodificación de todos los formatos de 2.1 (tests con fixtures generados por script, sin audio con copyright en el repo). — 2026-10-11. `decode()` → float32 mono/estéreo, remuestreo, segmento (`start`/`duration`), `DecodeError` con motivo. Fixtures: `tests/fixtures/generate.py` sintetiza un tono y lo codifica con FFmpeg a WAV, AIFF, FLAC, MP3, AAC, ALAC y Vorbis en una carpeta temporal con tildes y emojis. La mezcla a mono es la estándar de FFmpeg (−3 dB por canal); LUFS y clipping se medirán en estéreo. La CI descarga FFmpeg antes de los tests del motor.
- [x] 1.3 Lectura de metadatos y carátula con mutagen. — 2026-10-11. `metadata.py`: ID3 (MP3/WAV/AIFF), MP4 (AAC/ALAC) y Vorbis comments (FLAC/OGG); título, artista, álbum, género, año, sello, comentario, tonalidad/BPM existentes (solo como referencia), duración, frecuencia de muestreo, bitrate y carátula (portada frontal primero). Las etiquetas mal formadas nunca bloquean la importación. `save_artwork` deduplica por hash. Tests con todos los formatos y textos con tildes y emojis. Además, en `audio_io` FFmpeg queda limitado a archivos locales (`file:` + `-protocol_whitelist file`) tras un aviso de la revisión de seguridad.
- [ ] 1.4 `library.addPaths` recursivo, deduplicación por hash y detección de archivos movidos o modificados.
- [ ] 1.5 UI: zona de arrastre, tabla virtualizada, búsqueda y orden.

**Aceptación:** importar 1000 archivos de prueba sin bloquear la UI, con los metadatos correctos y las rutas con tildes/emojis funcionando.

### Fase 2 — Tonalidad, BPM y notaciones
- [ ] 2.1 `keys.py` y `lib/keys.ts` con notaciones y compatibilidad, más una batería de tests compartida (mismo JSON de casos para Python y TS).
- [ ] 2.2 `analysis/key.py` (ensemble, afinación, alternativas y tonalidad secundaria).
- [ ] 2.3 `analysis/tempo.py` (beatgrid, downbeats, mitad/doble).
- [ ] 2.4 Cola de análisis en paralelo con progreso, cancelación y reintento.
- [ ] 2.5 `tools/eval_key.py` y `tools/eval_tempo.py` + documento `docs/accuracy.md` con resultados.
- [ ] 2.6 UI: columnas de tonalidad (chip) y BPM, selector de notación en Ajustes y edición manual.

**Aceptación:** MIREX ≥ 0,75 (tonalidad) y Accuracy1 ≥ 0,85 (tempo) en los datasets de evaluación, con los resultados documentados.

### Fase 3 — Energía, estructura, cues, calidad y forma de onda
- [ ] 3.1 `energy.py` + `calibrate_energy.py`.
- [ ] 3.2 `structure.py` con segmentos etiquetados y hasta 8 cues.
- [ ] 3.3 `quality.py` y la playlist inteligente "Revisar calidad".
- [ ] 3.4 `waveform.py`.
- [ ] 3.5 UI: vista de detalle con forma de onda por bandas, curva de energía, segmentos, cues editables, Snap Cue, reproductor y salto entre cues.

**Aceptación:** los cues caen siempre en un downbeat. En 20 temas de prueba revisados a mano, ≥ 80 % de los cues marcan cambios de sección reales. MAE de energía ≤ 1,0 tras la calibración.

### Fase 4 — Tags, limpieza y organización
- [ ] 4.1 `tags/writer.py` con plantillas, vista previa, backup y undo, en todos los formatos.
- [ ] 4.2 `tags/cleaner.py` con reglas, vista previa y edición masiva.
- [ ] 4.3 Panel "Info del tema".
- [ ] 4.4 Carpetas y playlists anidadas con emoji, arrastrar y soltar, playlists inteligentes e importación/exportación M3U.
- [ ] 4.5 Filtros avanzados (incluido "compatibles con…").
- [ ] 4.6 Carpetas vigiladas (auto-análisis).

**Aceptación:** escribir → undo deja cada archivo byte a byte igual en sus tags (test). Los tags escritos se leen correctamente en Rekordbox, Serato y Traktor (checklist manual en `docs/manual-tests.md`).

### Fase 5 — Integraciones con software de DJ
- [ ] 5.1 Exportación `rekordbox.xml` (cues, colores, beatgrid, tonalidad y playlists) + guía en la UI.
- [ ] 5.2 Traktor `collection.nml` (con backup, detección de Traktor abierto y simulación).
- [ ] 5.3 Serato `Markers2` (lectura y escritura con tests de ida y vuelta).
- [ ] 5.4 VirtualDJ `database.xml`.
- [ ] 5.5 Pantalla "Exportar" que unifica todo, con el resultado detallado.

**Aceptación:** los cues aparecen en la posición y con el color correctos en los cuatro programas (checklist manual) y existen tests automáticos de formato con archivos de ejemplo.

### Fase 6 — Rueda armónica, piano y guías
- [ ] 6.1 Componente de rueda armónica interactiva (clic en una tonalidad = filtrar compatibles).
- [ ] 6.2 Piano de verificación (2.13).
- [ ] 6.3 Guías integradas (mezcla armónica, energía, cues) en es/en.

**Aceptación:** la rueda y el piano funcionan con teclado y ratón, y la escala resaltada corresponde a la tonalidad del tema en todas las notaciones.

### Fase 7 — Stems y render
- [ ] 7.1 `stems.py` con descarga del modelo, aceleración, caché y lotes.
- [ ] 7.2 `render.py`: pitch shift, time stretch, segmentos, stems y caché por hash.
- [ ] 7.3 `vocal_presence` real a partir de las stems.
- [ ] 7.4 Exportación de stems (original o procesado) con plantillas de nombre.

**Aceptación:** separar un tema de 4 min en < 60 s en Apple Silicon (con MPS) y < 3 min en CPU de 4 núcleos. Los archivos exportados con +2 semitonos están realmente 2 semitonos más altos (test con un tono puro).

### Fase 8 — Modo Pro: decks, mashups y DJ Mix
- [ ] 8.1 `suggest.py` (2.15) con tests de puntuación y un benchmark de 20 000 temas sintéticos.
- [ ] 8.2 UI de los dos decks con interruptor Mashup/DJ Mix, flechas de ideas con el motivo y el filtro de ideas.
- [ ] 8.3 Reproducción sincronizada (clic en cue, Probar mashup, Probar mezcla con crossfade).
- [ ] 8.4 Cambio de tono por deck con recálculo de ideas en vivo.
- [ ] 8.5 Selector de stem por deck y loop ajustado al beat.
- [ ] 8.6 Favoritos con valoración, notas y exportación al DAW o a una carpeta.
- [ ] 8.7 Añadir a playlist y Mover B → A.

**Aceptación:** desfase entre los downbeats de los decks < 5 ms (medido con un test de clics). Las sugerencias responden en < 200 ms. Un flujo completo (cargar A → elegir idea → cambiar tono → probar → guardar favorito → exportar stems) funciona en el smoke test E2E.

### Fase 9 — Constructor de sets
- [ ] 9.1 `playlist_builder.py` (búsqueda en haz y curva de energía).
- [ ] 9.2 UI con un editor de curva, puntuaciones por transición, reemplazar tema y guardar/exportar.

**Aceptación:** con una playlist de 100 temas, genera un set de 20 en < 2 s en el que ninguna transición puntúa 0 en tonalidad, salvo que no exista alternativa (y entonces se marca en rojo).

### Fase 10 — Pulido y publicación
- [ ] 10.1 Atajos de teclado, accesibilidad, estados vacíos y mensajes de error claros en es/en.
- [ ] 10.2 Actualizador de Tauri con GitHub Releases (desactivable).
- [ ] 10.3 Instaladores finales: `.dmg` (arm64 y x64) y `.msi` o NSIS. Firma ad-hoc en Mac con instrucciones para abrir la app sin notarización; documentar cómo añadir notarización y firma de Windows si en el futuro hay certificados.
- [ ] 10.4 Documentación de usuario (`docs/`), CONTRIBUTING.md, plantilla de issues y página de atribuciones de licencias de terceros generada automáticamente.
- [ ] 10.5 (Opcional) Exportación a Engine DJ.

**Aceptación:** instalación limpia en un Mac y un PC sin herramientas de desarrollo. Todo el flujo de `docs/manual-tests.md` se supera.

---

## Decisiones tomadas

- 2026-10-11 · CI macOS x64 en `macos-15-intel`: el runner `macos-13` que cita el spec ya no existe en GitHub Actions.

- 2026-10-11 · TypeScript 6 en lugar de 7: typescript-eslint aún no soporta TS 7.
- 2026-10-11 · Tailwind 4 con `tailwind.config.ts` cargado por `@config` (el spec exige ese archivo); los colores son `var(--color-*)` de `tokens.css`.
- 2026-10-11 · Fuentes empaquetadas con `@fontsource` (nada de Google Fonts en runtime: regla "todo local").
- 2026-10-11 · `rpc.types.ts` escrito a mano provisionalmente en 0.3; sustituido por el generado en 0.6.

- 2026-10-11 · Herramientas locales: Python 3.11 gestionado por `uv` (el del sistema es 3.9), Rust estable vía `rustup`.

## Decisiones pendientes

- 2026-10-11 · Sidecar: el spec pide PyInstaller *one-folder* como sidecar de Tauri, pero `externalBin` espera un único ejecutable. Opción conservadora elegida: Rust lanza el proceso directamente (tokio) y la carpeta one-folder se empaqueta como `resources/engine/`. No hace falta el plugin shell ni capacidades extra. Implementado en 0.5: `externalBin` solo para ffmpeg/rubberband (un único ejecutable cada uno) y el motor como recurso `engine/`. La config de bundle se genera por plataforma y solo se usa en `tauri build --config`, así `dev`/tests no necesitan binarios.
- 2026-10-11 · El zip de FFmpeg para macOS no incluye archivo de licencia; añadir el texto GPL-3.0 a `licenses/` en la página de atribuciones (10.4).

## Problemas abiertos

- macOS: el proyecto vive en el Escritorio sincronizado con iCloud (File Provider) y `ar` no puede escribir ahí → la compilación de Rust falla dentro de `app/src-tauri/target`. Solución local: `export CARGO_TARGET_DIR="$HOME/Library/Caches/tonalia/target"` (o mover el repo fuera de iCloud).

- El repositorio aún no tiene remote en GitHub: la CI (0.7) y la verificación en macOS x64 / Windows dependen de crearlo.

## Resultados de precisión

| Fecha | Versión | Tonalidad (MIREX) | Tempo (Acc1) | Energía (MAE) | Dataset |
|---|---|---|---|---|---|
