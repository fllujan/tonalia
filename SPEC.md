# SPEC — Tonalia: analizador armónico y motor de mashups para DJs

> Software libre (AGPL-3.0) para macOS y Windows con la misma funcionalidad que una suite profesional de análisis armónico para DJs (tipo Mixed In Key 11 Pro): detección de tonalidad, BPM, nivel de energía, cue points automáticos, edición de tags, integración con Rekordbox, Serato y Traktor, sugerencias de mashup y de mezcla, separación de stems, cambio de tonalidad y constructor de playlists.
>
> Este documento es la fuente de verdad. El agente de código debe implementarlo **fase a fase y tarea a tarea**, en orden, siguiendo las reglas de `AGENTS.md`.

---

## 0. Reglas de producto (no negociables)

1. **Nombre e identidad propios.** El producto se llama "Tonalia". No usar nunca el nombre, logo, colores corporativos, textos ni capturas de Mixed In Key. No usar la palabra "Camelot" (marca registrada) en la interfaz, el código ni la documentación: la notación 1A–12B se llama **"Alfanumérica"** y la rueda se llama **"Rueda armónica"**.
2. **Todo local.** El análisis se hace en el ordenador del usuario. Sin cuentas, sin telemetría, sin servidores. La única conexión a internet permitida es la descarga opcional de modelos de stems y la comprobación de actualizaciones (desactivable).
3. **Nunca destruir datos del usuario.** Antes de escribir tags en un archivo de audio o modificar una colección de Traktor/Rekordbox/Serato, se guarda una copia de seguridad y existe "Deshacer".
4. **Multiplataforma real.** Cada fase debe funcionar en macOS (Apple Silicon e Intel) y Windows 10/11 x64. La CI compila y prueba en ambos.
5. **Licencia AGPL-3.0** para todo el proyecto (obligatorio porque se usa Essentia). Todas las dependencias deben ser compatibles: no usar modelos o librerías con licencia "no comercial" (por ejemplo, los modelos preentrenados de madmom) en la configuración por defecto.
6. **Idiomas de la interfaz:** español e inglés desde el primer día (i18n). El código, los identificadores y los commits, en inglés.
7. **Diseño:** `DESIGN.md` es la fuente de verdad visual (colores, tipografía, componentes y pantallas). Sus tokens se implementan en `app/src/styles/tokens.css` y en `tailwind.config.ts`; ningún componente usa colores sueltos fuera de los tokens. Si existe la carpeta `design/` con las pantallas exportadas del diseño, la UI debe reproducirlas.

---

## 1. Arquitectura

```
┌───────────────────────────────────────────────────────────────┐
│  App de escritorio (Tauri 2)                                  │
│  ┌─────────────────────────────┐   ┌───────────────────────┐  │
│  │ Frontend React + TypeScript │◄─►│ Núcleo Rust (Tauri)   │  │
│  │ Vite, Tailwind, Zustand,    │   │ - lanza el motor      │  │
│  │ TanStack Table/Query,       │   │ - puente JSON-RPC     │  │
│  │ Web Audio (decks/preview)   │   │ - diálogos, ficheros  │  │
│  └─────────────────────────────┘   └──────────┬────────────┘  │
│                                               │ stdio (JSON-RPC 2.0, líneas JSON)
│                                   ┌───────────▼────────────┐  │
│                                   │ Motor de análisis       │ │
│                                   │ Python 3.11 (sidecar,   │ │
│                                   │ empaquetado PyInstaller)│ │
│                                   │ Essentia, librosa,      │ │
│                                   │ numpy, mutagen, Demucs, │ │
│                                   │ Rubber Band, SQLite     │ │
│                                   └─────────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 1.1 Stack fijado

| Capa | Tecnología |
|---|---|
| Shell de escritorio | Tauri 2.x (Rust estable) |
| Frontend | React 18, TypeScript estricto, Vite, Tailwind CSS, Zustand (estado), TanStack Table (tabla virtualizada) y TanStack Query, i18next, Radix UI (componentes accesibles), wavesurfer.js o canvas propio para formas de onda |
| Audio en la UI | Web Audio API (`AudioContext`, `AudioBufferSourceNode`, programación sample-accurate) |
| Motor | Python 3.11, Essentia (tonalidad, ritmo, descriptores), librosa (apoyo), numpy/scipy, pyloudnorm (LUFS), mutagen (tags), Demucs (stems, PyTorch), Rubber Band (time-stretch y pitch-shift, binario CLI empaquetado), FFmpeg (decodificación, binario empaquetado), SQLite (stdlib `sqlite3`) |
| Empaquetado del motor | PyInstaller (one-folder) como *sidecar* de Tauri, uno por plataforma/arquitectura |
| Tests | pytest (motor), Vitest + Testing Library (frontend), `cargo test` (Rust), smoke test E2E con tauri-driver |
| CI/CD | GitHub Actions: lint + tests + build en `macos-14` (arm64), `macos-13` (x64) y `windows-latest`. Releases con instaladores `.dmg` y `.msi`/NSIS, actualizador de Tauri |

### 1.2 Estructura del repositorio

```
tonalia/
├── AGENTS.md
├── SPEC.md
├── PROGRESS.md                 # el agente marca aquí el avance
├── LICENSE                     # AGPL-3.0
├── README.md
├── app/                        # Tauri + React
│   ├── src/                    # frontend
│   │   ├── components/
│   │   ├── features/
│   │   │   ├── library/
│   │   │   ├── analysis/
│   │   │   ├── track-detail/
│   │   │   ├── wheel/
│   │   │   ├── piano/
│   │   │   ├── tags/
│   │   │   ├── decks/          # modo Pro
│   │   │   ├── suggestions/
│   │   │   ├── playlist-builder/
│   │   │   ├── export/
│   │   │   └── settings/
│   │   ├── lib/rpc.ts          # cliente JSON-RPC tipado
│   │   ├── lib/keys.ts         # notaciones y compatibilidad (espejo del motor)
│   │   ├── i18n/{es,en}.json
│   │   └── main.tsx
│   └── src-tauri/
│       ├── src/main.rs
│       ├── src/engine.rs       # lanzar/supervisar el sidecar, puente stdio
│       ├── binaries/           # sidecars por target triple
│       └── tauri.conf.json
├── engine/
│   ├── pyproject.toml
│   ├── tonalia_engine/
│   │   ├── __main__.py         # bucle JSON-RPC por stdio
│   │   ├── rpc.py
│   │   ├── db.py               # SQLite + migraciones
│   │   ├── audio_io.py         # decodificación con FFmpeg
│   │   ├── analysis/
│   │   │   ├── key.py
│   │   │   ├── tempo.py
│   │   │   ├── energy.py
│   │   │   ├── structure.py    # segmentación y cue points
│   │   │   ├── quality.py      # clipping, bitrate, loudness
│   │   │   └── waveform.py
│   │   ├── keys.py             # notaciones, rueda, compatibilidad
│   │   ├── tags/
│   │   │   ├── writer.py
│   │   │   ├── cleaner.py
│   │   │   └── backup.py
│   │   ├── export/
│   │   │   ├── rekordbox_xml.py
│   │   │   ├── traktor_nml.py
│   │   │   ├── serato_markers.py
│   │   │   └── virtualdj.py
│   │   ├── stems.py
│   │   ├── render.py           # pitch shift / time stretch / previews
│   │   ├── suggest.py          # motor de ideas (mashup y DJ mix)
│   │   └── playlist_builder.py
│   ├── tools/
│   │   ├── eval_key.py
│   │   ├── eval_tempo.py
│   │   └── calibrate_energy.py
│   └── tests/
├── scripts/                    # build del sidecar, descarga de ffmpeg/rubberband
└── .github/workflows/
```

### 1.3 Protocolo motor ⇄ app

- Transporte: stdin/stdout del sidecar, **una línea = un mensaje JSON-RPC 2.0**. stderr solo para logs.
- Peticiones con `id`; notificaciones de progreso sin `id` con método `progress` (`{jobId, trackId, stage, percent}`) y `event` (`{type, payload}`).
- Trabajos largos (análisis, stems, render) devuelven `{jobId}` inmediatamente y se pueden cancelar con `job.cancel`.
- El núcleo Rust reenvía todo al frontend mediante eventos de Tauri. Si el motor muere, Rust lo reinicia y emite `engine.restarted`.
- Tipos compartidos: se definen en `engine/tonalia_engine/rpc_schema.py` (pydantic) y se genera `app/src/lib/rpc.types.ts` con un script (`scripts/gen-types`). Prohibido mantener tipos duplicados a mano.

Métodos mínimos (se ampliarán por fase):

| Método | Descripción |
|---|---|
| `engine.ping` / `engine.version` | salud |
| `library.addPaths(paths[])` | añade archivos o carpetas (recursivo) |
| `library.list(query)` | paginado, filtros, orden |
| `library.get(trackId)` | ficha completa |
| `library.remove(trackIds[])` | quita de la biblioteca (no borra archivos) |
| `analysis.start(trackIds[], options)` / `analysis.reanalyze` | cola de análisis |
| `track.update(trackId, fields)` | edición manual (key, BPM, energía, metadatos) |
| `cues.list/set/delete(trackId, …)` | cue points |
| `tags.write(trackIds[], template)` / `tags.preview` / `tags.undo(batchId)` | escritura de tags |
| `tags.clean(trackIds[], rules)` / `tags.cleanPreview` | limpieza |
| `playlists.*` | CRUD de carpetas y playlists anidadas con emoji |
| `export.rekordbox/traktor/serato/virtualdj(options)` | integraciones |
| `stems.separate(trackId, model)` / `stems.status` | separación |
| `render.preview(spec)` | renderiza audio procesado (pitch/tempo/stem/segmento) a caché y devuelve la ruta |
| `suggest.mashups(deckA, filters)` / `suggest.mixouts(deckA, filters)` | ideas |
| `favorites.*` | mashups favoritos con valoración |
| `builder.generate(pool, curve, options)` | constructor de sets |
| `settings.get/set` | preferencias |

### 1.4 Base de datos (SQLite, en el directorio de datos de la app)

Migraciones versionadas (`db.py`). Tablas:

- `tracks(id, path UNIQUE, file_hash, size, mtime, format, duration, sample_rate, bitrate, title, artist, album, genre, year, label, comment, artwork_path, added_at, analyzed_at, analysis_version, status, error)`
- `analysis(track_id PK, key_root, key_mode, key_confidence, key_alternatives JSON, bpm, bpm_confidence, beat_grid JSON (primer downbeat + bpm, o lista de beats si es variable), energy INT 1-10, energy_curve JSON, loudness_lufs, peak_db, clipping_ratio, vocal_presence REAL, quality_flags JSON, waveform_path)`
- `segments(id, track_id, start, end, label, energy)` — label ∈ intro, verse, build, drop, breakdown, outro
- `cues(id, track_id, slot 0-7, position_sec, label, color, source auto|user)`
- `playlists(id, parent_id, name, emoji, is_folder, sort_order, smart_query JSON NULL)` y `playlist_tracks(playlist_id, track_id, position)`
- `stems(track_id, model, vocals_path, drums_path, bass_path, other_path, instrumental_path, created_at)`
- `favorites(id, track_a, track_b, mode mashup|mix, shift_a, shift_b, cue_a, cue_b, rating 0-5, notes, created_at)`
- `tag_backups(batch_id, track_id, original_tags BLOB, written_at)`
- `settings(key PK, value JSON)`

Detección de cambios: si `size`/`mtime` cambian se recalcula `file_hash` (xxhash de los primeros y últimos 1 MB + tamaño) y se marca para reanálisis. Si un archivo se mueve y el hash coincide, se reubica en lugar de duplicarlo.

---

## 2. Especificación funcional detallada

### 2.1 Formatos de audio
MP3, WAV, AIFF, M4A/AAC, ALAC, OGG Vorbis, FLAC. Decodificación por FFmpeg a mono float32 de 44,1 kHz para el análisis (estéreo para stems y previews).

### 2.2 Detección de tonalidad (`analysis/key.py`)
- 24 tonalidades (12 mayores + 12 menores).
- Método: **ensemble** de `essentia.standard.KeyExtractor` con perfiles `edma`, `bgate`, `temperley` y `krumhansl`, sobre HPCP calculado en la parte armónica (HPSS) y excluyendo intro/outro de percusión pura. Votación ponderada por la fuerza (*strength*) de cada perfil. Pesos configurables en `key_weights.json` y ajustables con la herramienta de evaluación.
- Resultado: tonalidad principal, confianza 0–1 y 2 alternativas. Si la confianza < 0,5 la UI lo marca con un aviso discreto.
- **Detección de cambios de tonalidad:** análisis por ventanas de 30 s; si una tonalidad distinta domina más del 25 % del tema, se guarda como "tonalidad secundaria" y se muestra.
- Afinación: estimar la referencia (por ejemplo 440 vs 432 Hz) y compensarla antes del HPCP.
- **Evaluación obligatoria (`tools/eval_key.py`):** recibe un CSV `ruta,tonalidad_real` y calcula precisión exacta y la puntuación ponderada MIREX (quinta = 0,5, relativa = 0,3, paralela = 0,2). Admite como referencia los tags de tonalidad que el usuario ya tenga en su biblioteca. Objetivo de la fase 2: **≥ 0,75 de puntuación MIREX** en el dataset público GiantSteps Key.

### 2.3 Notaciones y rueda armónica (`keys.py` y `lib/keys.ts`, con tests idénticos)
Notaciones seleccionables en Ajustes: **Alfanumérica** (1A–12B), **Open Key** (1m–12d), **Clásica** (Am, C, F#m…), **Clásica con bemoles** (Gbm…).

Tabla Alfanumérica (menor = A, mayor = B):

| Nº | A (menor) | B (mayor) |
|---|---|---|
| 1 | A♭m | B |
| 2 | E♭m | F♯ |
| 3 | B♭m | D♭ |
| 4 | Fm | A♭ |
| 5 | Cm | E♭ |
| 6 | Gm | B♭ |
| 7 | Dm | F |
| 8 | Am | C |
| 9 | Em | G |
| 10 | Bm | D |
| 11 | F♯m | A |
| 12 | D♭m | E |

Open Key: `open = ((n + 4) mod 12) + 1`, con `m` para menor y `d` para mayor (8B → 1d, 8A → 1m).

Reglas de compatibilidad (puntuación de transición entre la tonalidad X = nL y la Y):

| Relación | Ejemplo desde 8A | Puntuación |
|---|---|---|
| Misma tonalidad | 8A | 1,00 |
| ±1 en la rueda, misma letra | 7A, 9A | 0,90 |
| Relativa (mismo número, otra letra) | 8B | 0,85 |
| Diagonal (n+1 con cambio de letra: A→B o n−1 B→A) | 9B | 0,60 |
| Energy boost +2 | 10A | 0,55 |
| +7 (subida de un semitono) | 3A | 0,50 |
| Resto | — | 0 |

Desplazamiento de tono: subir `s` semitonos suma `7·s (mod 12)` al número de la rueda y conserva la letra.

### 2.4 Tempo y beatgrid (`analysis/tempo.py`)
- `RhythmExtractor2013(method="multifeature")` y estimación de downbeats propia: el beat con mayor energía de graves y de onsets en ciclos de 4, validado por la periodicidad de 16 y 32 compases.
- Rango configurable (por defecto 70–180 BPM) con resolución de mitad/doble según el género (drum & bass y dubstep permiten 160–180).
- Redondeo opcional a entero o 1 o 2 decimales. Detección de tempo variable (desviación > 1 % entre secciones) → `beat_grid` como lista de beats en lugar de rejilla fija.
- Evaluación con `tools/eval_tempo.py` (Accuracy1 y Accuracy2) en GiantSteps Tempo. Objetivo: Accuracy1 ≥ 0,85.

### 2.5 Nivel de energía 1–10 (`analysis/energy.py`) — algoritmo propio
1. Segmentar el tema en bloques de 8 compases (según el beatgrid).
2. Por bloque, calcular: sonoridad a corto plazo (LUFS, pyloudnorm), densidad de onsets por segundo, proporción percusiva (HPSS), flujo espectral medio, proporción de energía en 20–150 Hz y centroide espectral.
3. Normalizar cada descriptor con rangos de referencia (`energy_ref.json`) y combinar con pesos (`energy_weights.json`) en una puntuación 0–1, que se mapea a 1–10 con una sigmoide calibrada.
4. Energía del tema = media del 50 % de bloques más energéticos (refleja las partes principales, no la intro). Se guarda también la curva por bloque (`energy_curve`) para pintarla sobre la forma de onda.
5. `tools/calibrate_energy.py`: recibe un CSV `ruta,energía` (por ejemplo, valoraciones manuales del usuario o tags de energía que ya tenga) y ajusta pesos y sigmoide por regresión ridge con validación cruzada. Informa del MAE. Objetivo: MAE ≤ 1,0 frente a las etiquetas de referencia.

### 2.6 Estructura y cue points automáticos (`analysis/structure.py`)
- Novedad de Foote sobre una matriz de auto-similitud de chroma + MFCC, combinada con los saltos de la curva de energía y la caída/vuelta del bombo (energía de graves).
- Fronteras ajustadas al downbeat más cercano y preferentemente a límites de frase (múltiplos de 8/16/32 compases).
- Etiquetado heurístico de segmentos: intro, build, drop, breakdown, outro (y verse/chorus si hay voz).
- **Hasta 8 cue points** por tema (número configurable de 0 a 8): el cue 1 siempre en el primer downbeat; el resto, en los cambios de sección más importantes, con prioridad para el drop, el breakdown, el segundo drop y el outro. Separación mínima de 16 compases.
- Cada cue lleva etiqueta, color (paleta configurable, con un color por tipo de sección) y `source=auto`. Los cues editados por el usuario (`source=user`) no se sobrescriben al reanalizar.

### 2.7 Calidad de audio (`analysis/quality.py`)
Detecta clipping (proporción de muestras ≥ −0,1 dBFS), bitrate bajo (< 192 kbps en MP3), *upsampling* falso (corte espectral por debajo de 16 kHz en un archivo "de 320"), sonoridad muy baja (< −14 LUFS integrado) y silencio excesivo al principio o al final. Esto alimenta la playlist inteligente **"Revisar calidad"** (equivalente a la lista "mejorar temas").

### 2.8 Forma de onda (`analysis/waveform.py`)
Pre-cálculo a 150 puntos/s con tres bandas (graves, medios, agudos) guardado como binario compacto. La UI la pinta coloreada por bandas, con la curva de energía superpuesta y los marcadores de cue.

### 2.9 Escritura de tags (`tags/writer.py`)
- Campos configurables: tonalidad (`TKEY` en ID3; campo equivalente en MP4, Vorbis y AIFF), BPM (`TBPM`), comentario y *grouping*.
- Plantilla de comentario con variables: `{key}`, `{key_alt}`, `{energy}`, `{bpm}`, `{comment_original}`. Por defecto: `{key} - Energy {energy}`. Opciones: delante del comentario existente, detrás o sustituirlo.
- Opción de escribir la energía también en el campo de valoración o en *grouping*.
- **Vista previa obligatoria** (antes → después) y copia de seguridad de los tags originales en `tag_backups`. `tags.undo(batchId)` restaura exactamente lo que había.
- Escritura atómica: copia temporal, escribir, verificar, reemplazar. Nunca dejar un archivo a medias.

### 2.10 Limpieza de tags (`tags/cleaner.py`)
Reglas activables con vista previa: quitar URLs y dominios, textos promocionales ("Free download", "Exclusive", "Promo only"…, lista editable), números de pista en el título, `(Original Mix)` opcional, espacios dobles, MAYÚSCULAS → Tipo Título, normalizar `feat.`/`ft.`/`Feat` y mover el artista invitado al título o al artista según la preferencia, separador de artistas unificado. Edición masiva de cualquier campo para N temas a la vez.

### 2.11 Playlists y organización
Carpetas y playlists anidadas sin límite de profundidad, con **emoji** por playlist (selector de emoji), arrastrar y soltar para ordenar y para añadir temas. Playlists inteligentes (consulta guardada: tonalidad, rango de BPM, energía, género, "sin analizar", "Revisar calidad", "Favoritos"). Importar playlists M3U/M3U8 y exportarlas.

### 2.12 Integración con software de DJ (`export/`)
Siempre con copia de seguridad del archivo de destino y modo "solo simular" que informa de lo que va a cambiar.

| Destino | Qué se exporta | Cómo |
|---|---|---|
| Todos | tonalidad, BPM y energía | tags en el archivo (2.9) |
| Rekordbox | hot cues 0–7 con nombre y color, beatgrid (TEMPO) y tonalidad | genera un `rekordbox.xml` (formato DJ_PLAYLISTS) con `POSITION_MARK` y `TEMPO` + playlists. El usuario lo importa desde las preferencias de Rekordbox. Instrucciones paso a paso en la UI |
| Traktor | cue points (`CUE_V2`) y tonalidad | modifica `collection.nml` (localización automática en Mac/Win), solo con Traktor cerrado (detectar el proceso y avisar) |
| Serato | hot cues con color y nombre | escribe el GEOB `Serato Markers2` en el propio archivo (MP3, M4A, FLAC, AIFF). Implementar siguiendo la documentación pública de ingeniería inversa del formato (proyecto "serato-tags" en GitHub) con tests de ida y vuelta (leer → escribir → leer = idéntico) |
| VirtualDJ | cues (`Poi`) y tonalidad | modifica `database.xml` |
| Engine DJ | (fase opcional) | base de datos SQLite `m.db`, solo después de todo lo anterior |
| Ableton y DAWs | tonalidad y BPM en tags + exportación de stems (2.16) | — |

### 2.13 Piano de verificación
Teclado de 2 octavas en pantalla, tocable con el ratón y con el teclado del ordenador. Resalta la escala de la tonalidad detectada y tiene botones para "tocar acorde de tónica" y "tocar escala". Sonido de piano con samples de licencia libre (por ejemplo Salamander Grand Piano, CC-BY, con atribución en "Acerca de") o síntesis como alternativa. Se puede tocar mientras suena el tema para comprobar la tonalidad de oído.

### 2.14 Interfaz — modo estándar
- **Barra lateral:** Biblioteca, Analizar (cola), carpetas y playlists (con emoji), playlists inteligentes, Favoritos de mashup, Ajustes, Guías.
- **Panel principal:** tabla virtualizada (soporta 100 000 temas) con carátula, título, artista, tonalidad (chip de color según la posición en la rueda), BPM, energía (barra 1–10), número de cues, género, estado y fecha. Orden por cualquier columna, columnas configurables y búsqueda instantánea.
- **Filtros avanzados:** tonalidad (con opción "compatibles con…"), rango de BPM (con mitad/doble), energía, género, playlist y estado.
- **Zona de arrastre:** soltar carpetas o archivos en cualquier lugar añade y analiza, con progreso por tema y global, cancelable y con análisis en paralelo (N procesos = núcleos − 1, configurable).
- **Detalle del tema:** forma de onda con la curva de energía y los segmentos coloreados, cues editables (arrastrar, renombrar, cambiar color, borrar) y **Snap Cue** (fijar el cue en la posición de reproducción actual, ajustado al beat), reproductor con salto entre cues, rueda armónica con la tonalidad resaltada y sus compatibles, y piano.
- **Info del tema (panel deslizante):** editar título, artista, álbum, tonalidad, energía, tempo y género. Los cambios manuales prevalecen sobre el análisis.
- **Ajustes:** notación, plantilla de tags, rango de BPM, número de cues y colores, carpetas vigiladas (auto-análisis de temas nuevos), paralelismo, tema claro/oscuro/sistema, idioma, ubicación de caché, modelo de stems y aceleración (CPU/GPU).
- **Guías:** tutorial integrado de mezcla armónica, niveles de energía y uso de cue points, con textos propios.
- Modo oscuro y claro. Atajos de teclado (espacio = play/pausa, 1–8 = saltar a cue, ⌘/Ctrl+F = buscar).

### 2.15 Modo Pro — dos decks, ideas de mashup y de mezcla
**Disposición:** Deck A (izquierda) y Deck B (derecha), cada uno con forma de onda, cues, controles de tono (±6 semitonos), selector de stem (Tema completo / Voz / Instrumental) y loop. Interruptor de modo: **Mashup** ↔ **DJ Mix**.

**Mashup:**
- Al cargar un tema en A, el Deck B muestra la mejor idea de la biblioteca. Las flechas ◀ ▶ recorren las ideas, con su puntuación y el motivo ("misma tonalidad", "relativa", "+1 semitono en B", "voz en A + instrumental en B").
- **Filtro de ideas:** energía, rango de tempo, playlist(s) y género, para limitar las sugerencias en bibliotecas grandes.
- **Clic en un cue** de cualquier deck: reproduce ese segmento sincronizado con el otro deck.
- **Probar mashup:** reproduce los dos decks a la vez, igualados en tempo (B se adapta al BPM de A) y alineados al downbeat.
- **Cambio de tono:** al cambiar la tonalidad de A o de B, las sugerencias se recalculan en el momento con la tonalidad desplazada.
- **Loop de un fragmento:** fijar un loop de 1, 2, 4, 8, 16 o 32 compases o uno libre ajustado al beat (por ejemplo, una acapella en A) e ir cambiando instrumentales en B.
- **Favoritos:** guardar la combinación (temas, desplazamientos, cues, modo) con valoración de 0 a 5 estrellas y notas, y exportarla (2.16).

**DJ Mix:**
- Al cargar A, B propone el siguiente tema para una transición fluida (salida de A → entrada de B).
- **Probar mezcla:** reproduce el final de A (desde el cue de outro) y la entrada de B sincronizados, con un crossfade automático de 16 o 32 compases.
- **Añadir a playlist**, **Mover B → A** (B pasa a ser el tema actual y se regeneran las sugerencias), cambio de tono, stems y loop igual que en Mashup.

**Motor de ideas (`suggest.py`):**
- Candidatos: todos los temas analizados que pasan los filtros. Para cada candidato y cada desplazamiento permitido de B (por defecto −2…+2 semitonos; 0 si el usuario lo desactiva):
  - `key_score` según la tabla de 2.3, aplicando los desplazamientos.
  - `bpm_score` = 1 − |Δ|/tolerancia, considerando ×0,5, ×1 y ×2. Tolerancia: 6 % en DJ Mix y 10 % en Mashup.
  - `energy_score`: en Mashup, cercanía de energías; en DJ Mix, preferir Δ entre 0 y +1 (configurable: mantener, subir, bajar).
  - `vocal_score` (solo Mashup): complementariedad, que uno tenga mucha voz y el otro poca (de `vocal_presence`).
  - `genre_score`: bonificación por el mismo género o uno afín.
  - Penalización por desplazamiento: −0,05 por semitono.
- Puntuación total ponderada (pesos en `suggest_weights.json`). Mashup: key 0,45 · bpm 0,25 · vocal 0,15 · energy 0,10 · genre 0,05. DJ Mix: key 0,40 · bpm 0,30 · energy 0,20 · genre 0,10.
- Rendimiento: < 200 ms para 20 000 temas (índice por número de rueda y bandas de BPM en memoria).

**Reproducción sincronizada (`render.py` + frontend):**
- El motor renderiza a caché (WAV 44,1 kHz, clave = hash de los parámetros) el segmento pedido de B con time-stretch al BPM de A y pitch-shift (Rubber Band, modo de alta calidad) y, si procede, solo la stem elegida. Así devuelve los datos de alineación: el primer downbeat en muestras.
- El frontend carga ambos `AudioBuffer` y los programa en el mismo `AudioContext.currentTime + offset` para que los downbeats coincidan con un error < 5 ms. Ganancia por deck y crossfader.
- Pre-render especulativo de la siguiente idea mientras se escucha la actual.

### 2.16 Stems (`stems.py`)
- Demucs `htdemucs_ft` (máxima calidad) y `htdemucs` (rápido) como opción. El modelo se descarga la primera vez, con progreso y comprobación de hash. Aceleración: MPS en Apple Silicon, CUDA en Windows si existe y CPU como alternativa.
- Salidas: vocals, drums, bass, other e **instrumental** (suma de todo menos vocals). Caché por tema y modelo.
- Separación bajo demanda (al pedir una stem) o en lote para una playlist ("preparar stems").
- `vocal_presence` = RMS(vocals) / RMS(mezcla) en las secciones principales. Antes de tener stems, se usa una estimación heurística (energía en 300–3400 Hz con baja percusividad), que se sustituye cuando existen las stems.
- **Exportar:** voz, instrumental, cada stem o el tema completo, en su tonalidad y tempo originales **o** con el desplazamiento y tempo aplicados. Formato WAV, AIFF o FLAC (24 bits), nombre de archivo con plantilla (`{artist} - {title} ({stem}) [{key} {bpm}]`) y destino: carpeta elegida o "carpeta de proyecto del DAW" configurada. Exportar un favorito genera los dos archivos procesados listos para el DAW.

### 2.17 Constructor de sets (`playlist_builder.py`)
- Entrada: un conjunto de temas (playlist o selección), duración objetivo o número de temas, tema inicial opcional y **curva de energía** (calentamiento → pico → bajada, plana, en ascenso, o dibujada a mano en la UI).
- Algoritmo: búsqueda en haz (*beam search*, ancho 50) que maximiza la suma de las puntuaciones de transición del modo DJ Mix más el ajuste a la curva de energía, sin repetir temas. Determinista con semilla.
- UI: lista resultante con la puntuación de cada transición (verde/amarillo/rojo), reordenar a mano (recalcula las puntuaciones), "reemplazar este tema" (muestra alternativas) y guardar como playlist o exportar a Rekordbox, Traktor o M3U.

---

## 3. Requisitos no funcionales

- **Rendimiento:** análisis completo (sin stems) de un tema de 6 min en < 10 s en un Mac M1 o en un PC de 4 núcleos. Arranque de la app en < 3 s. Tabla fluida con 100 000 filas.
- **Robustez:** un archivo corrupto nunca bloquea la cola (se marca `error` con su motivo). Las rutas con tildes, emojis y espacios funcionan en ambos sistemas (tests específicos). En Windows se admiten rutas largas.
- **Reproducibilidad:** `analysis_version` en cada resultado. Al subir de versión el algoritmo, la UI ofrece reanalizar.
- **Accesibilidad:** navegación completa con teclado, contraste AA y la tonalidad nunca indicada solo por color.
- **Privacidad:** cero telemetría. Los logs se quedan en local y existe el botón "Abrir carpeta de logs".
- **Calidad de código:** ruff + mypy estricto (motor), ESLint + Prettier + `tsc --noEmit` (frontend), clippy (Rust). Cobertura mínima del 80 % en `keys.py`, `suggest.py`, `tags/` y `export/`.

---

## 4. Plan de implementación por fases

Cada tarea es un commit (o varios pequeños). Una fase termina solo cuando **todos** sus criterios de aceptación se cumplen y la CI está en verde en macOS y Windows. El agente actualiza `PROGRESS.md` tras cada tarea.

### Fase 0 — Esqueleto y CI
- [x] 0.1 Repo con la estructura de 1.2, LICENSE AGPL-3.0, README, `.editorconfig` y `.gitignore`.
- [x] 0.2 `engine/`: proyecto Python (pyproject, ruff, mypy, pytest) con el bucle JSON-RPC por stdio y `engine.ping`.
- [x] 0.3 `app/`: Tauri 2 + React + TS + Tailwind + i18n (es/en) + tema claro/oscuro, con una ventana que muestra "Motor: conectado" tras un `engine.ping`.
- [x] 0.4 `engine.rs`: lanzar el sidecar, puente de mensajes, reinicio automático y eventos al frontend.
- [x] 0.5 Scripts para descargar binarios de FFmpeg y Rubber Band por plataforma (con verificación de checksums) y construir el sidecar con PyInstaller con el nombre por *target triple*.
- [x] 0.6 Generación de tipos TS desde los esquemas pydantic.
- [x] 0.7 GitHub Actions: lint + tests + build en macOS arm64, macOS x64 y Windows x64, subiendo los instaladores como artefactos.
**Aceptación:** el instalador de cada plataforma abre la app y muestra "Motor: conectado".

### Fase 1 — Biblioteca e importación
- [x] 1.1 SQLite con migraciones y el esquema de 1.4.
- [x] 1.2 `audio_io.py`: decodificación de todos los formatos de 2.1 (tests con fixtures generados por script, sin audio con copyright en el repo).
- [x] 1.3 Lectura de metadatos y carátula con mutagen.
- [x] 1.4 `library.addPaths` recursivo, deduplicación por hash y detección de archivos movidos o modificados.
- [x] 1.5 UI: zona de arrastre, tabla virtualizada, búsqueda y orden.
**Aceptación:** importar 1000 archivos de prueba sin bloquear la UI, con los metadatos correctos y las rutas con tildes/emojis funcionando.

### Fase 2 — Tonalidad, BPM y notaciones
- [x] 2.1 `keys.py` y `lib/keys.ts` con notaciones y compatibilidad, más una batería de tests compartida (mismo JSON de casos para Python y TS).
- [x] 2.2 `analysis/key.py` (ensemble, afinación, alternativas y tonalidad secundaria).
- [x] 2.3 `analysis/tempo.py` (beatgrid, downbeats, mitad/doble).
- [x] 2.4 Cola de análisis en paralelo con progreso, cancelación y reintento.
- [x] 2.5 `tools/eval_key.py` y `tools/eval_tempo.py` + documento `docs/accuracy.md` con resultados.
- [x] 2.6 UI: columnas de tonalidad (chip) y BPM, selector de notación en Ajustes y edición manual.
**Aceptación:** MIREX ≥ 0,75 (tonalidad) y Accuracy1 ≥ 0,85 (tempo) en los datasets de evaluación, con los resultados documentados.

### Fase 3 — Energía, estructura, cues, calidad y forma de onda
- [x] 3.1 `energy.py` + `calibrate_energy.py`.
- [x] 3.2 `structure.py` con segmentos etiquetados y hasta 8 cues.
- [x] 3.3 `quality.py` y la playlist inteligente "Revisar calidad".
- [x] 3.4 `waveform.py`.
- [x] 3.5 UI: vista de detalle con forma de onda por bandas, curva de energía, segmentos, cues editables, Snap Cue, reproductor y salto entre cues.
**Aceptación:** los cues caen siempre en un downbeat. En 20 temas de prueba revisados a mano, ≥ 80 % de los cues marcan cambios de sección reales. MAE de energía ≤ 1,0 tras la calibración.

### Fase 4 — Tags, limpieza y organización
- [x] 4.1 `tags/writer.py` con plantillas, vista previa, backup y undo, en todos los formatos.
- [x] 4.2 `tags/cleaner.py` con reglas, vista previa y edición masiva.
- [x] 4.3 Panel "Info del tema".
- [x] 4.4 Carpetas y playlists anidadas con emoji, arrastrar y soltar, playlists inteligentes e importación/exportación M3U.
- [x] 4.5 Filtros avanzados (incluido "compatibles con…").
- [x] 4.6 Carpetas vigiladas (auto-análisis).
**Aceptación:** escribir → undo deja cada archivo byte a byte igual en sus tags (test). Los tags escritos se leen correctamente en Rekordbox, Serato y Traktor (checklist manual en `docs/manual-tests.md`).

### Fase 5 — Integraciones con software de DJ
- [x] 5.1 Exportación `rekordbox.xml` (cues, colores, beatgrid, tonalidad y playlists) + guía en la UI.
- [x] 5.2 Traktor `collection.nml` (con backup, detección de Traktor abierto y simulación).
- [x] 5.3 Serato `Markers2` (lectura y escritura con tests de ida y vuelta).
- [x] 5.4 VirtualDJ `database.xml`.
- [x] 5.5 Pantalla "Exportar" que unifica todo, con el resultado detallado.
**Aceptación:** los cues aparecen en la posición y con el color correctos en los cuatro programas (checklist manual) y existen tests automáticos de formato con archivos de ejemplo.

### Fase 6 — Rueda armónica, piano y guías
- [x] 6.1 Componente de rueda armónica interactiva (clic en una tonalidad = filtrar compatibles).
- [x] 6.2 Piano de verificación (2.13).
- [x] 6.3 Guías integradas (mezcla armónica, energía, cues) en es/en.
**Aceptación:** la rueda y el piano funcionan con teclado y ratón, y la escala resaltada corresponde a la tonalidad del tema en todas las notaciones.

### Fase 7 — Stems y render
- [x] 7.1 `stems.py` con descarga del modelo, aceleración, caché y lotes.
- [x] 7.2 `render.py`: pitch shift, time stretch, segmentos, stems y caché por hash.
- [x] 7.3 `vocal_presence` real a partir de las stems.
- [x] 7.4 Exportación de stems (original o procesado) con plantillas de nombre.
**Aceptación:** separar un tema de 4 min en < 60 s en Apple Silicon (con MPS) y < 3 min en CPU de 4 núcleos. Los archivos exportados con +2 semitonos están realmente 2 semitonos más altos (test con un tono puro).

### Fase 8 — Modo Pro: decks, mashups y DJ Mix
- [x] 8.1 `suggest.py` (2.15) con tests de puntuación y un benchmark de 20 000 temas sintéticos.
- [x] 8.2 UI de los dos decks con interruptor Mashup/DJ Mix, flechas de ideas con el motivo y el filtro de ideas.
- [x] 8.3 Reproducción sincronizada (clic en cue, Probar mashup, Probar mezcla con crossfade).
- [x] 8.4 Cambio de tono por deck con recálculo de ideas en vivo.
- [x] 8.5 Selector de stem por deck y loop ajustado al beat.
- [x] 8.6 Favoritos con valoración, notas y exportación al DAW o a una carpeta.
- [x] 8.7 Añadir a playlist y Mover B → A.
**Aceptación:** desfase entre los downbeats de los decks < 5 ms (medido con un test de clics). Las sugerencias responden en < 200 ms. Un flujo completo (cargar A → elegir idea → cambiar tono → probar → guardar favorito → exportar stems) funciona en el smoke test E2E.

### Fase 9 — Constructor de sets
- [x] 9.1 `playlist_builder.py` (búsqueda en haz y curva de energía).
- [x] 9.2 UI con un editor de curva, puntuaciones por transición, reemplazar tema y guardar/exportar.
**Aceptación:** con una playlist de 100 temas, genera un set de 20 en < 2 s en el que ninguna transición puntúa 0 en tonalidad, salvo que no exista alternativa (y entonces se marca en rojo).

### Fase 10 — Pulido y publicación
- [x] 10.1 Atajos de teclado, accesibilidad, estados vacíos y mensajes de error claros en es/en.
- [x] 10.2 Actualizador de Tauri con GitHub Releases (desactivable).
- [ ] 10.3 Instaladores finales: `.dmg` (arm64 y x64) y `.msi` o NSIS. Firma ad-hoc en Mac con instrucciones para abrir la app sin notarización; documentar cómo añadir notarización y firma de Windows si en el futuro hay certificados.
- [ ] 10.4 Documentación de usuario (`docs/`), CONTRIBUTING.md, plantilla de issues y página de atribuciones de licencias de terceros generada automáticamente.
- [ ] 10.5 (Opcional) Exportación a Engine DJ.
**Aceptación:** instalación limpia en un Mac y un PC sin herramientas de desarrollo. Todo el flujo de `docs/manual-tests.md` se supera.

---

## 5. Datos de prueba y evaluación

- **Nunca** subir audio con copyright al repositorio. Los fixtures de tests se generan por script (acordes y escalas sintéticos en tonalidades conocidas, clics a BPM conocido, estructuras sintéticas intro/drop/breakdown, ruido con clipping).
- Los datasets de evaluación (GiantSteps Key y GiantSteps Tempo) se descargan con un script a una carpeta ignorada por git. Si no se pueden descargar, la evaluación acepta cualquier CSV del usuario (`ruta,valor`).
- `docs/accuracy.md` registra la precisión de cada versión del algoritmo para no retroceder sin darse cuenta: la CI falla si la precisión de tonalidad o tempo baja más de 2 puntos respecto a la última registrada (cuando el dataset esté disponible en el runner, con caché).

---

## 6. Fuera de alcance (por ahora)

Análisis en tiempo real del audio del sistema, plugins VST/AU para DAWs, masterización o mejora de audio, versión para Linux (no bloquear, pero no es objetivo), aplicación móvil y funciones en la nube.
