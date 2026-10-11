# PROGRESS — Tonalia

**Fase actual:** 4 — Tags, limpieza y organización (fase 3 cerrada con criterios pendientes de datos del usuario)

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
- macOS x64 y Windows x64: ✅ en CI (ejecución 38134741816, commit `2b783f3`): lint, tests y build en verde en las tres plataformas; instaladores subidos como artefactos (`tonalia-aarch64-apple-darwin` 51 MB, `tonalia-x86_64-apple-darwin` 59 MB, `tonalia-x86_64-pc-windows-msvc` 102 MB). Queda que el usuario instale a mano el `.dmg` de Intel y el instalador de Windows (no tengo esas máquinas).

**Pendiente:** CI en verde en las tres plataformas y probar los instaladores descargados de macOS x64 y Windows.

**Estado de la CI (2026-10-11, ejecución 38131959453):** macOS arm64 ✅ y macOS x64 ✅, ambos con instalador generado (el fallo previo de `bundle_dmg.sh` en arm64 fue puntual). Windows ❌ en "Fetch ffmpeg and rubberband": `UnicodeEncodeError` por imprimir `→` en una consola cp1252. Ya corregido en `scripts/fetch_binaries.py` (`->`), **pendiente de commit y push**.

#### Traslado fuera de iCloud (2026-10-11)

La shell perdió el permiso de escritura en `~/Desktop/Tonalia` (Escritorio sincronizado con iCloud). El repo se copió a `~/Developer/Tonalia` y el trabajo sigue ahí; el original del Escritorio queda intacto para que el usuario lo borre cuando quiera. Fuera de iCloud Rust compila sin `CARGO_TARGET_DIR`. Arreglo de Windows (`->` en vez de `→`) subido en `2b783f3`.

### Fase 1 — Biblioteca e importación
- [x] 1.1 SQLite con migraciones y el esquema de 1.4. — 2026-10-11. `db.py`: migraciones transaccionales con `PRAGMA user_version`, copia de seguridad antes de actualizar una base existente, rechazo de bases de una versión más nueva, WAL + claves foráneas. `paths.py` + `TONALIA_DATA_DIR` desde Rust (app data dir de Tauri). Desviaciones menores del esquema: `segments.start_sec/end_sec` (evita la palabra reservada `end`), `tag_backups.path` sin clave foránea (las copias sobreviven a quitar el tema), `label` admite también `chorus`.
- [x] 1.2 `audio_io.py`: decodificación de todos los formatos de 2.1 (tests con fixtures generados por script, sin audio con copyright en el repo). — 2026-10-11. `decode()` → float32 mono/estéreo, remuestreo, segmento (`start`/`duration`), `DecodeError` con motivo. Fixtures: `tests/fixtures/generate.py` sintetiza un tono y lo codifica con FFmpeg a WAV, AIFF, FLAC, MP3, AAC, ALAC y Vorbis en una carpeta temporal con tildes y emojis. La mezcla a mono es la estándar de FFmpeg (−3 dB por canal); LUFS y clipping se medirán en estéreo. La CI descarga FFmpeg antes de los tests del motor.
- [x] 1.3 Lectura de metadatos y carátula con mutagen. — 2026-10-11. `metadata.py`: ID3 (MP3/WAV/AIFF), MP4 (AAC/ALAC) y Vorbis comments (FLAC/OGG); título, artista, álbum, género, año, sello, comentario, tonalidad/BPM existentes (solo como referencia), duración, frecuencia de muestreo, bitrate y carátula (portada frontal primero). Las etiquetas mal formadas nunca bloquean la importación. `save_artwork` deduplica por hash. Tests con todos los formatos y textos con tildes y emojis. Además, en `audio_io` FFmpeg queda limitado a archivos locales (`file:` + `-protocol_whitelist file`) tras un aviso de la revisión de seguridad.
- [x] 1.4 `library.addPaths` recursivo, deduplicación por hash y detección de archivos movidos o modificados. — 2026-10-11. `library.py`: escaneo recursivo (ignora ocultos y `._*` de macOS), hash xxh64 de primer/último MB + tamaño, archivo modificado → metadatos releídos y `pending`, archivo movido → se reubica conservando análisis/cues/playlists, copia duplicada → se omite y se informa, archivo ilegible → `status='error'` con motivo. Escrituras por lotes de 200. `jobs.py`: trabajos en segundo plano con `{jobId}`, progreso limitado a 10/s, cancelación cooperativa y evento `job.finished`. RPC: `library.addPaths/list/get/remove` y `job.cancel`; parámetros validados (`INVALID_PARAMS` con detalle). Búsqueda sin tildes ni mayúsculas mediante la columna `search_text` (migración v2). Esquema RPC en camelCase en el cable mediante alias. Los tests nunca tocan el directorio de datos real (`conftest.py`).
- [x] 1.5 UI: zona de arrastre, tabla virtualizada, búsqueda y orden. — 2026-10-11. Pantalla de bienvenida (6.1) con zona de arrastre y "Elegir carpeta…" (plugin de diálogos); arrastrar archivos sobre la ventana con superposición (6.15) usando el evento de Tauri con rutas reales; barra lateral (240 px) con recuento y estado del motor; biblioteca (6.2) con cabecera, búsqueda instantánea (⌘F/Ctrl+F, sin tildes), orden por columna, densidad cómoda/compacta y tabla virtualizada (TanStack Virtual) que pide solo las páginas visibles de 200 filas; barra de progreso de importación con cancelar y aviso de resumen al terminar. Carátulas por el protocolo `asset` limitado a `$APPDATA/artwork/**`. Vista previa en navegador solo para desarrollo (`pnpm dev` + `?empty`, `?big`, `?down`) con `mockIPC`; verificada en Chrome a 1440×900 en oscuro y claro, con 12.480 temas. Arreglos: el generador de tipos borraba las propiedades llamadas `title`; los temas sin título se ordenaban por la ruta completa (migración v3 `display_title`).

**Aceptación:** importar 1000 archivos de prueba sin bloquear la UI, con los metadatos correctos y las rutas con tildes/emojis funcionando.

#### Resumen de la Fase 1 (2026-10-11)

**Qué se hizo:** base de datos SQLite con migraciones (v1 esquema, v2 búsqueda, v3 orden por título), decodificación de los siete formatos con FFmpeg confinado a archivos locales, lectura de etiquetas y carátulas, importación recursiva en segundo plano con deduplicación y detección de movidos/modificados, y la UI de biblioteca.

**Cómo probarlo a mano:**
1. `cd engine && uv run python -m tools.make_test_library ~/Desktop/"Música de prueba 🎧" --count 1000` genera una biblioteca sintética.
2. `cd app && pnpm tauri dev` → pantalla de bienvenida → arrastra la carpeta (o "Elegir carpeta…") → barra de progreso → tabla con 1000 temas.
3. Busca "lumen" o "musica de prueba", ordena por columnas, cambia la densidad; vuelve a importar la misma carpeta (aviso: "No había temas nuevos").
4. Sin Tauri: `cd app && pnpm dev` y abre `http://localhost:1420/?big` en el navegador.

**Criterio de aceptación:** ✅ `tests/test_acceptance_phase1.py` importa 1000 archivos FLAC/MP3/M4A con nombres con tildes, emojis y rayas en 0,18 s (archivos de 0,2 s) sin bloquear el motor (latencia máxima de ping + list durante la importación: 1 ms), con título/artista/género/duración correctos y búsqueda sin tildes. La UI no se bloquea porque la importación es un trabajo en segundo plano y la tabla solo pide las páginas visibles (verificado en navegador con 12.480 filas). Pendiente: una prueba a mano dentro de la app Tauri real arrastrando la carpeta generada (no puedo interactuar con la ventana nativa desde aquí).

### Fase 2 — Tonalidad, BPM y notaciones
- [x] 2.1 `keys.py` y `lib/keys.ts` con notaciones y compatibilidad, más una batería de tests compartida (mismo JSON de casos para Python y TS). — 2026-10-11. Notaciones Alfanumérica, Open Key, Clásica (sostenidos) y Clásica con bemoles; parser de tags tolerante (`08A`, `1m`, `A min`, `F♯m`, `Gbm`, `Cmaj`…); compatibilidad con relación y puntuación de la tabla 2.3 (la diagonal solo es n+1 A→B o n−1 B→A y el energy boost solo +2, tal como dice el spec); desplazamiento por semitonos. `engine/tests/data/keys_cases.json` (generado a partir de la tabla del spec, no de la implementación) con 94 casos que pasan en pytest y Vitest. Cobertura de `keys.py`: 96 %; la CI exige ≥ 80 %.
- [x] 2.2 `analysis/key.py` (ensemble, afinación, alternativas y tonalidad secundaria). — 2026-10-11. Implementación propia con numpy/scipy (sin Essentia, ver decisiones): `analysis/chroma.py` (STFT a 11 025 Hz con tramas de 8192, HPSS por filtrado de mediana, afinación por media circular de desviaciones en cents, HPCP con armónicos y ventana cos²) y `analysis/key.py` (perfiles publicados krumhansl/temperley/bgate/edma, voto ponderado por peso × *strength*, confianza = acuerdo × fuerza, 2 alternativas, ventanas de 30 s para la tonalidad dominante y la secundaria >25 %). Excluye tramas de silencio y de percusión pura (proporción armónica <0,65 en 100–5000 Hz). Pesos y umbrales en `key_weights.json`. Tests: 24/24 tonalidades en cadencias sintéticas, afinación a 432 Hz, intro de batería, cambio de tonalidad, silencio/percusión → sin tonalidad. 6 min de audio en 1,96 s (M-series). Precisión real pendiente de la evaluación en 2.5.
- [x] 2.3 `analysis/tempo.py` (beatgrid, downbeats, mitad/doble). — 2026-10-11. Flujo espectral por bandas logarítmicas normalizadas, con refuerzo de graves (alinea el grid al bombo y no a los platillos); latencia de la envolvente (42 ms) calibrada con un impulso; autocorrelación + elección de octava en el rango (70–180 por defecto) con prior log-normal (120 BPM, o 172 si el género es drum & bass/dubstep/jungle); seguimiento de beats por programación dinámica (Ellis 2007); BPM y fase por ajuste lineal robusto; tempo variable si una ventana de 32 beats se desvía >1 % → lista de beats; downbeat por energía lineal de graves tras cada beat más una validación por cambios de frase. `round_bpm` (entero, 1 o 2 decimales). Tests: 8 tempos ±0,05 BPM con fase <15 ms, los 4 desfases de downbeat, mitad→doble, rango personalizado, género DnB, cambio de tempo 120→126, música con batería. 6 min en 0,78 s. Nota: 87 vs 174 sin género es ambiguo solo por ritmo; lo resuelve el género (SPEC 2.4).
- [x] 2.4 Cola de análisis en paralelo con progreso, cancelación y reintento. — 2026-10-11. `analysis/queue.py`: un único trabajo vacía la cola con un pool de **procesos** `spawn` (N = núcleos − 1, ajuste `analysis.workers`); las peticiones durante la ejecución se suman a la misma cola; las fases (decodificando/tonalidad/tempo) llegan por una cola de multiprocessing → `progress`; un archivo corrupto queda en `error` con motivo sin frenar nada; si un proceso se cae, se reconstruye el pool y se reintenta una vez; cancelar devuelve a `pending` lo no terminado. Al importar se encadena el análisis de los temas nuevos (evento `job.started`). Al arrancar, los `analyzing` huérfanos vuelven a `pending`. RPC `analysis.start` (pendientes, opcionalmente también los erróneos = reintento) y `analysis.reanalyze`; evento `analysis.trackDone`. Migración v4 (tonalidad secundaria y afinación); `library.get` devuelve alternativas, secundaria, afinación, confianza de BPM y beatgrid. `ANALYSIS_VERSION = 2.0`. UI: barra de análisis con cancelar y aviso de resumen; la tabla se refresca con cada tema terminado. Verificado con el motor empaquetado (PyInstaller + `freeze_support`): 2 temas analizados en paralelo en 1,4 s con tonalidad y BPM correctos y sin procesos huérfanos. Arreglos: el motor envolvía stdout dos veces (error al salir en la versión empaquetada); el generador de tipos dejaba notas de relleno en los modelos con descripción.
- [x] 2.5 `tools/eval_key.py` y `tools/eval_tempo.py` + documento `docs/accuracy.md` con resultados. — 2026-10-11. `tools/fetch_datasets.py` (GiantSteps Key, GiantSteps Tempo y GiantSteps-MTG-Key, con MD5, a `datasets/` ignorada por git), `eval_key.py` (CSV, tags del usuario o GiantSteps; exacta + MIREX; `--tune`), `eval_tempo.py` (Acc1/Acc2, anotaciones originales o v2, prior por género) y `train_key.py`; referencias en `docs/accuracy.json` con `--check` (falla si baja >2 puntos). La evaluación destapó fallos reales que se corrigieron: tempo (prior fijo en 120, rejilla desviada por saltos del tracker, 84 % de temas marcados como variables → `[2.3]` c5ef81f) y tonalidad (sesgo menor → paralela mayor; perfiles aprendidos en GiantSteps-MTG-Key). Resultados v2.2: **tonalidad MIREX 0,722** (objetivo 0,75, **no alcanzado**), **tempo Acc1 0,889** en v2 con género (0,818 con las anotaciones originales). Detalle en `docs/accuracy.md`. `ANALYSIS_VERSION` 2.2.
- [x] 2.6 UI: columnas de tonalidad (chip) y BPM, selector de notación en Ajustes y edición manual. — 2026-10-11. Motor: `settings.get/set` (notación y decimales del BPM, validados y guardados en SQLite) y `track.update` (tonalidad y BPM a mano; migración v5 `edited_fields`; la cola de análisis nunca sobrescribe lo editado, SPEC 2.14). UI: chip de tonalidad (DESIGN 2.3: color de la rueda al 20 %/60 %, texto oscurecido en claro, borde discontinuo + ⚠ si la confianza es < 0,5, lápiz si está editado; el texto siempre visible); BPM con el redondeo elegido; clic en la celda → editor de tonalidad (rejilla de las 24 tonalidades en orden de la rueda, "Sin tonalidad") o de BPM (×2 / ÷2, Enter guarda, Escape cancela, el foco vuelve a la celda). Pantalla **Ajustes** (6.13) con General (tema e idioma, movidos de la barra lateral) y Análisis (notación con vista previa y redondeo del BPM) y selector rápido 8A / 1m / Am en la cabecera de la biblioteca (6.2). Cambio de notación optimista. Verificado en Chrome con la vista previa (datos de DESIGN 8) en oscuro y claro. 124 tests de frontend.

**Aceptación:** MIREX ≥ 0,75 (tonalidad) y Accuracy1 ≥ 0,85 (tempo) en los datasets de evaluación, con los resultados documentados.

#### Resumen de la Fase 2 (2026-10-11)

**Qué se hizo:** notaciones y compatibilidad armónica idénticas en Python y TS (batería JSON compartida); detección de tonalidad (HPSS, afinación, HPCP propio y perfiles aprendidos en GiantSteps-MTG-Key, con el ensemble de perfiles publicados como alternativa; tonalidad secundaria); tempo, beatgrid y downbeats (prior por género, rejilla ajustada con peine, tempo variable por secciones); cola de análisis en paralelo con progreso, cancelación, reintento y recuperación; herramientas de evaluación, descarga de datasets y entrenamiento; columnas de tonalidad y BPM, ajustes de notación y edición manual que sobrevive al reanálisis.

**Cómo probarlo a mano:**
1. `cd app && pnpm tauri dev`, arrastra una carpeta: se importa y se analiza sola; la tabla muestra tonalidad (chip) y BPM.
2. Cambia la notación con 8A / 1m / Am en la cabecera o en Ajustes → Análisis (también "Clásica con bemoles" y el redondeo del BPM).
3. Haz clic en una tonalidad o un BPM para corregirlo; reanaliza el tema y comprueba que tu cambio se mantiene (lápiz = editado a mano).
4. Precisión: `cd engine && uv run python -m tools.fetch_datasets key tempo mtg-key && uv run python -m tools.eval_key --giantsteps && uv run python -m tools.eval_tempo --giantsteps --v2`.

**Criterios de aceptación:**
- Tempo: ✅ Accuracy1 **0,889** en GiantSteps Tempo v2 con el género (0,818 con las anotaciones originales; 0,782 sin género).
- Tonalidad: ⚠️ MIREX **0,722** en GiantSteps Key (objetivo 0,75). **Aceptado por el usuario** como excepción documentada (`docs/accuracy.md`).
- Resultados documentados en `docs/accuracy.md` y referencias en `docs/accuracy.json`.

**Pendiente:** mejorar la tonalidad hacia 0,75 (posible modelo convolucional pequeño); probar a mano en la app real la edición y el cambio de notación; el rango de BPM configurable y el paralelismo en Ajustes llegan con la pantalla completa de Ajustes (2.14).

### Fase 3 — Energía, estructura, cues, calidad y forma de onda
- [x] 3.1 `energy.py` + `calibrate_energy.py`. — 2026-10-11. `analysis/energy.py`: bloques de 8 compases según el beatgrid (bloques de ~15 s sin rejilla); por bloque, sonoridad BS.1770 (pyloudnorm), densidad de ataques, proporción percusiva (HPSS), flujo espectral, proporción 20–150 Hz y centroide; normalización con `energy_ref.json` (percentiles 5–95 de 5.938 bloques de los 664 temas de GiantSteps Tempo, calculados con la herramienta), pesos y sigmoide en `energy_weights.json`; energía del tema = media del 50 % de bloques más energéticos; la curva por bloque se guarda en `energy_curve` y sale en `library.get`. `tools/calibrate_energy.py`: `--ranges CARPETA` (rangos de referencia) y `--csv ruta,energía` (ridge con validación cruzada de 5 particiones sobre el logit, informa del MAE antes y después, `--write`). En GiantSteps la energía ordena bien los géneros (chill-out 4,7 · house 6,5 · psy-trance 6,9 de media). La energía también se puede editar a mano (`track.update`, protegida al reanalizar). 6 min de audio: tonalidad 3,0 s + tempo 1,4 s + energía 1,5 s. `ANALYSIS_VERSION` 2.3.
- [x] 3.2 `structure.py` con segmentos etiquetados y hasta 8 cues. — 2026-10-11. `analysis/structure.py`, todo por compases (de downbeat a downbeat), así que fronteras y cues caen siempre en un downbeat: croma, timbre tipo MFCC, sonoridad, banda de graves y flujo por compás; novedad de Foote (núcleo de damero con ventana gaussiana) sobre la matriz de autosimilitud + saltos de sonoridad y de graves (el bombo que se va o vuelve), cada componente escalado por su percentil 90 para que un breakdown muy marcado no oculte los demás cambios; fase de frase de 8 compases y candidatos en la rejilla de 4 compases; etiquetas heurísticas (intro/outro en los extremos, drop = fuerte con bombo, breakdown = sin bombo y más suave, build = la sección antes de un drop, verse = el resto) y fusión de secciones consecutivas iguales. Cues automáticos: el 1 en el primer downbeat y después drop, breakdown, 2.º drop, outro, builds… a ≥ 16 compases, con color por tipo de sección (DESIGN 2.5) y etiqueta como clave traducible. `cues.py` + RPC `cues.list/set/delete/resetAuto`; los cues del usuario nunca se sobrescriben (los automáticos usan las ranuras libres y se apartan de sus posiciones); ajuste `cueCount` 0–8 (también en Ajustes → Análisis); `library.get` devuelve segmentos y cues. En una estructura sintética intro-build-drop-breakdown-build-drop-outro encuentra todas las fronteras exactas y los cues esperados; en GiantSteps, 0,11 s por tema. `ANALYSIS_VERSION` 2.4.
- [x] 3.3 `quality.py` y la playlist inteligente "Revisar calidad". — 2026-10-11. `analysis/quality.py` sobre los canales originales: clipping (muestras ≥ −0,1 dBFS; aviso si > 0,1 %), bitrate bajo (MP3 < 192 kbps), falsa alta calidad (corte espectral < 16 kHz en un archivo ≥ 256 kbps o sin pérdida: nivel medio a 40 dB por debajo del de 2–8 kHz), sonoridad integrada < −14 LUFS (BS.1770) y silencio > 3 s al principio o al final; guarda sonoridad, pico, proporción de clipping, corte y silencios (migración v6). `library.list` acepta `qualityIssues`; en la barra lateral, **⚠️ Revisar calidad** con contador, vista filtrada y estado vacío; la columna Estado muestra ⚠ ámbar con la lista de problemas. En los MP3 de 96 kbps de GiantSteps mide un corte de ~15,3 kHz (bitrate bajo, no "falsa calidad"). Rendimiento: ahora se decodifica **una sola vez** en estéreo y el mono se calcula exactamente como lo hace FFmpeg ((L+R)/√2, verificado con test), con un único hilo de decodificación; 6 min de FLAC de 24 bits: 8,8 s en total (antes 12,6 s). `ANALYSIS_VERSION` 2.5.
- [x] 3.4 `waveform.py`. — 2026-10-11. `analysis/waveform.py`: 150 puntos/s en tres bandas (graves < 250 Hz, medios 250 Hz–4 kHz, agudos > 4 kHz, filtros Butterworth de orden 4), pico por punto en un byte con curva de raíz cuadrada; binario propio `TWF1` (cabecera de 16 bytes + 3 bytes por punto, ~160 KB para 6 min) escrito de forma atómica en `waveforms/<id>.twf` de la carpeta de datos; `library.get` devuelve `waveformPath`; quitar un tema borra su caché (nunca el audio). El protocolo `asset` de Tauri ya puede leer `$APPDATA/waveforms/**`. `ANALYSIS_VERSION` 2.6.
- [x] 3.5 UI: vista de detalle con forma de onda por bandas, curva de energía, segmentos, cues editables, Snap Cue, reproductor y salto entre cues. — 2026-10-11. Vista de detalle (6.5): doble clic o Intro en una fila; cabecera con carátula, datos grandes (chip de tonalidad con confianza, alternativas y tonalidad secundaria; BPM; medidor de energía grande); forma de onda a todo el ancho en canvas (bandas apiladas, parte reproducida al 45 %, curva de energía con el degradado de la escala y relleno al 8 %, etiquetas y franja de secciones, banderitas de cue numeradas y arrastrables con ajuste al beat, cabezal y regla de compases 1, 17, 33…); reproductor (play/pausa, cue anterior/siguiente, espacio y 1–8); cue pads 1×8 con editor (nombre, color de la paleta, borrar), "Fijar cue aquí" ajustado al beat y "Restablecer automáticos" con confirmación; chips de calidad. Medidor de energía (DESIGN 2.4) también en la tabla. Reproducción: comando Rust `allow_playback` que añade al protocolo `asset` solo el archivo del tema (extensión de audio, archivo existente; con tests) y CSP con `connect-src` para leer la forma de onda. Vista previa del navegador con estructura y forma de onda sintéticas; verificada en Chrome. 137 tests de frontend. Limitación: el WebView no reproduce todos los formatos (AIFF en Windows, OGG en algunos macOS); se resolverá con `render.preview` en la fase 7.

**Aceptación:** los cues caen siempre en un downbeat. En 20 temas de prueba revisados a mano, ≥ 80 % de los cues marcan cambios de sección reales. MAE de energía ≤ 1,0 tras la calibración.

#### Resumen de la Fase 3 (2026-10-11)

**Qué se hizo:** energía 1–10 por bloques de 8 compases con herramienta de calibración; estructura por compases con secciones etiquetadas y hasta 8 cues automáticos (que respetan los del usuario); control de calidad y lista "Revisar calidad"; forma de onda de tres bandas en caché; vista de detalle con reproductor, cues editables y Snap Cue. El análisis completo de 6 min tarda 8,8 s (FLAC 24 bits; < 10 s del spec).

**Cómo probarlo a mano:**
1. `cd app && pnpm tauri dev`, importa música y espera al análisis: columnas de energía y cues, y "⚠️ Revisar calidad" en la barra lateral.
2. Doble clic en un tema: forma de onda, secciones, curva de energía y cues. Espacio reproduce; 1–8 salta a los cues; arrastra una banderita para mover un cue; "Fijar cue aquí" lo pone en la posición actual ajustado al beat.
3. Reanaliza el tema: tus cues se mantienen.
4. Calibrar la energía con tus valoraciones: `cd engine && uv run python -m tools.calibrate_energy --csv mis_temas.csv`.

**Criterios de aceptación:**
- Los cues caen siempre en un downbeat: ✅ por construcción (todo se calcula por compases) y comprobado en tests (`test_structure.py`, `test_cues_rpc.py`).
- ≥ 80 % de los cues en cambios de sección reales en 20 temas revisados a mano: ⏳ **revisión manual del usuario** (en la estructura sintética de referencia, 100 %).
- MAE de energía ≤ 1,0 tras la calibración: ⏳ **necesita valoraciones reales del usuario** (la herramienta está probada: recupera una relación conocida con MAE ≤ 0,6).
- CI en verde en macOS y Windows: ⏳ **bloqueada por la facturación de GitHub Actions** (ver Problemas abiertos); todo pasa en local.

**Pendiente:** los tres puntos anteriores; la rueda y el piano del detalle (fase 6); reproducción de AIFF/OGG donde el WebView no los soporta (fase 7).

### Fase 4 — Tags, limpieza y organización
- [x] 4.1 `tags/writer.py` con plantillas, vista previa, backup y undo, en todos los formatos. — 2026-10-11. `tags/writer.py` para ID3 (MP3/WAV/AIFF: TKEY, TBPM, COMM, TIT1, POPM), MP4 (initialkey, tmpo entero, ©cmt, ©grp) y Vorbis (FLAC/OGG: INITIALKEY, BPM, COMMENT, GROUPING, RATING); plantilla de comentario con `{key}` `{key_alt}` `{energy}` `{bpm}` `{comment_original}`, delante/detrás/sustituir, sin apilar copias al repetir; energía opcional en grouping o valoración; los ID3v2.3 siguen siendo v2.3. Escritura en dos fases: copia temporal exclusiva (nombre aleatorio, `O_EXCL`, nunca sigue enlaces) → escribir → releer y verificar → la copia de seguridad se guarda en la base de datos → reemplazo atómico. `tags/backup.py`: se guarda comprimida la región del original que difiere del nuevo más las huellas xxh64; deshacer reconstruye el original **byte a byte** y no toca un archivo que haya cambiado después. RPC `tags.preview`, `tags.write` (trabajo con progreso, `batchId`) y `tags.undo`; la fila de la biblioteca (comentario, tamaño, fecha, huella) se actualiza para que un reescaneo no lo tome por modificado. UI (6.7, «Escribir resultados»): selección en la tabla (clic, ⌘/Ctrl, Mayús, Escape), botón «Tags» (selección o toda la vista), opciones con interruptores, plantilla con variables insertables o arrastrables, posición, notación, «Guardar como plantilla por defecto», vista previa antes → después (tachado → resaltado), aviso de copia de seguridad, barra de progreso y aviso final con «Deshacer». Tests: escribir → deshacer idéntico byte a byte en los 7 formatos (criterio de aceptación automático de la fase 4), cambios externos respetados, enlace plantado no seguido; cobertura de `tags/` 90 %. Revisión de seguridad: corregido el temporal predecible (48e5d85).
- [x] 4.2 `tags/cleaner.py` con reglas, vista previa y edición masiva. — 2026-10-11. `tags/cleaner.py` (funciones puras, cobertura 100 %): URLs y dominios, frases promocionales de una lista editable, números de pista del título (respeta nombres como «2 Unlimited»), «(Original Mix)» opcional, espacios dobles, MAYÚSCULAS → Tipo Título (sin romper apóstrofos; solo si la parte principal está en mayúsculas), «feat./ft./featuring» normalizado y el invitado movido al título o al artista, separador de artistas unificado. El escritor maneja ya título, artista, álbum, género, año y sello en ID3, MP4 y Vorbis (vacío = borrar el campo). Los lotes reciben un «planificador» (resultados, limpieza, edición) y comparten el mismo camino seguro (copia verificada, copia de seguridad exacta, deshacer); tras escribir o deshacer se refresca la fila de la biblioteca (título, artista, búsqueda, orden). RPC `tags.cleanPreview`/`tags.clean` y `tags.editPreview`/`tags.edit` (edición masiva de cualquier campo). UI: pestañas «Escribir resultados», «Limpiar tags» (reglas con interruptor y ejemplo, lista de frases editable, posición del invitado, separador) y «Editar en lote» (casillas por campo, vacío = borrar), con la misma vista previa y aviso. Verificado en Chrome. Lista de pruebas manuales de la fase 4 en `docs/manual-tests.md`.
- [x] 4.3 Panel "Info del tema". — 2026-10-11. Panel deslizante «Info del tema» (6.6, 420 px, animación de 220 ms, Escape o clic fuera para cerrar): título, artista, álbum, género (autocompletado con los géneros de la biblioteca: RPC `library.genres`, variantes de mayúsculas agrupadas), año (validado), tonalidad (rejilla de 24 en orden de la rueda, «Sin tonalidad»), BPM (×2, ÷2 y tap tempo con la marca de tiempo del clic; se reinicia tras 2 s de pausa), energía 1–10 con el medidor y comentario. Marca «Editado a mano» en los campos cambiados (y de forma permanente en tonalidad, BPM y energía editados). Al guardar: tonalidad, BPM y energía con `track.update` (prevalecen sobre el análisis); título, artista, álbum, género, año y comentario se escriben en el archivo con `tags.edit` (copia de seguridad y «Deshacer» en el aviso). Se abre con «Editar info» en el detalle o en la biblioteca con un tema seleccionado. Rejilla de tonalidades extraída a `KeyGrid` (12 o 6 columnas). Verificado en Chrome.
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

- 2026-10-11 · **Sin Essentia** (decisión del usuario): Essentia no publica wheels de Windows y la de Python 3.11 para Apple Silicon exige macOS 15. Tonalidad y tempo se implementan con el mismo diseño del spec (HPSS + afinación + HPCP + ensemble de perfiles edma/bgate/temperley/krumhansl ponderado por *strength*; RhythmExtractor sustituido por un estimador propio) **solo con numpy/scipy**: sin librosa, para evitar numba/llvmlite en PyInstaller. Resultados idénticos en las tres plataformas. La licencia sigue siendo AGPL-3.0 por decisión del proyecto.

- 2026-10-11 · CI macOS x64 en `macos-15-intel`: el runner `macos-13` que cita el spec ya no existe en GitHub Actions.

- 2026-10-11 · TypeScript 6 en lugar de 7: typescript-eslint aún no soporta TS 7.
- 2026-10-11 · Tailwind 4 con `tailwind.config.ts` cargado por `@config` (el spec exige ese archivo); los colores son `var(--color-*)` de `tokens.css`.
- 2026-10-11 · Fuentes empaquetadas con `@fontsource` (nada de Google Fonts en runtime: regla "todo local").
- 2026-10-11 · `rpc.types.ts` escrito a mano provisionalmente en 0.3; sustituido por el generado en 0.6.

- 2026-10-11 · Herramientas locales: Python 3.11 gestionado por `uv` (el del sistema es 3.9), Rust estable vía `rustup`.

- 2026-10-11 · **Tonalidad: se acepta MIREX 0,722** (objetivo 0,75) por decisión del usuario; la fase 2 se cierra con esta excepción documentada en `docs/accuracy.md`. Mejora futura posible: modelo convolucional pequeño.
- 2026-10-11 · **`key_model.json` se incluye** (decisión del usuario): pesos calculados a partir de las anotaciones de GiantSteps-MTG-Key (datos factuales, sin audio); registrado en `docs/third-party.md`.

- 2026-10-11 · **Fase 3 cerrada con criterios pendientes** (decisión del usuario): la MAE de energía queda sin medir hasta tener valoraciones reales; la revisión manual de cues (20 temas) la hará el usuario mientras avanza la fase 4; la CI la desbloqueará el usuario en GitHub (facturación) y entonces se relanza.

## Decisiones pendientes

- 2026-10-11 · **Energía — MAE ≤ 1,0 sin medir (aceptado como pendiente por el usuario)**: no existe un dataset público con niveles de energía. Los pesos actuales son un valor por defecto razonable (sigmoide centrada para que la música de club quede en torno a 6). Para medir y calibrar: un CSV `ruta,energía` con 30–100 temas valorados a mano (o con tags de energía que ya tengas) y `uv run python -m tools.calibrate_energy --csv archivo.csv --write`. **Pediré ese CSV al usuario al cerrar la fase.**

- 2026-10-11 · Tempo: el objetivo Acc1 ≥ 0,85 se cumple con las anotaciones v2 (corregidas) y el prior por género (0,889), igual que en la app, que usa la etiqueta de género. Con las anotaciones originales: 0,818; sin género: 0,782.

- 2026-10-11 · Sidecar: el spec pide PyInstaller *one-folder* como sidecar de Tauri, pero `externalBin` espera un único ejecutable. Opción conservadora elegida: Rust lanza el proceso directamente (tokio) y la carpeta one-folder se empaqueta como `resources/engine/`. No hace falta el plugin shell ni capacidades extra. Implementado en 0.5: `externalBin` solo para ffmpeg/rubberband (un único ejecutable cada uno) y el motor como recurso `engine/`. La config de bundle se genera por plataforma y solo se usa en `tauri build --config`, así `dev`/tests no necesitan binarios.
- 2026-10-11 · El zip de FFmpeg para macOS no incluye archivo de licencia; añadir el texto GPL-3.0 a `licenses/` en la página de atribuciones (10.4).

## Problemas abiertos

- 2026-10-11 · **CI de GitHub detenida por facturación**: desde el commit 93f541a los trabajos no arrancan ("recent account payments have failed or your spending limit needs to be increased"). Los runners de macOS consumen 10× minutos en repos privados. Opciones del usuario: subir el límite de gasto, hacer público el repositorio (Actions gratis) o esperar a la renovación mensual. Mientras tanto todo se verifica en local (ruff, mypy, pytest, pnpm lint/typecheck/test, cargo).

- ~~macOS: compilación de Rust bloqueada en el Escritorio de iCloud~~ — resuelto al mover el repo a `~/Developer/Tonalia`.

- El repositorio aún no tiene remote en GitHub: la CI (0.7) y la verificación en macOS x64 / Windows dependen de crearlo.

## Resultados de precisión

| Fecha | Versión | Tonalidad (MIREX) | Tempo (Acc1) | Energía (MAE) | Dataset |
|---|---|---|---|---|---|
| 2026-10-11 | 2.0 | 0,492 | 0,625 (v2, sin género) | — | GiantSteps Key / Tempo |
| 2026-10-11 | 2.2 | **0,722** | **0,889** (v2, género) · 0,818 (orig.) | — | GiantSteps Key / Tempo |
