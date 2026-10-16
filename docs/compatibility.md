# Compatibilidad con programas de DJ · DJ software compatibility

Qué conserva cada programa de lo que Tonalia escribe, probado a mano con los programas reales (SPEC 11.6). Cada fila dice la versión del programa, la de Tonalia y la fecha de la prueba. Los pasos de cada prueba están en [`manual-tests.md`](manual-tests.md) (fases 4, 5 y 10).

*What each program keeps of what Tonalia writes, tested by hand with the real programs. Each row gives the program's version, Tonalia's version and the test date. The steps of each test are in [`manual-tests.md`](manual-tests.md) (phases 4, 5 and 10).*

**Leyenda · Legend:** ✓ funciona · works — **parcial · partial** funciona con un límite del programa (nota) · works within a limit of the program (see note) — ✕ no funciona · does not work — · sin probar · not tested yet

> **Estado · Status:** pendiente de probar · not tested yet. Tonalia 0.1.4.

## Matriz · Matrix

| Programa · Program | Versión · Version | Tags | Cues | Colores · Colours | Beatgrid | Tonalidad · Key | BPM | Playlists | Fecha · Date | Tonalia |
|---|---|---|---|---|---|---|---|---|---|---|
| Rekordbox | | · | · | · | · | · | · | · | | |
| Serato DJ | | · | · | · | — | · | · | · | | |
| Traktor | | · | · | — | · | · | · | · | | |
| VirtualDJ | | · | · | · | · | · | · | · | | |
| Engine DJ | | · | · | · | · | · | · | · | | |

- **Tags**: tonalidad, BPM y comentario escritos en el archivo (MP3, M4A, FLAC, AIFF), leídos por el programa · *key, BPM and comment written in the file, as read by the program.*
- **Cues**: hot cues en el mismo compás que en Tonalia, con su nombre · *hot cues on the same beat as in Tonalia, with their name.*
- «—»: el formato del programa no lo guarda, así que no se exporta · *the program's format does not store it, so it is not exported.*

### Límites conocidos por diseño · Known limits by design

Esto no cuenta como ✕: se anota como «parcial» con su nota.
*These are not ✕: they are marked "partial" with a note.*

| Programa | Límite · Limit |
|---|---|
| Rekordbox | Se importa con el `rekordbox.xml` (Preferencias → Avanzado → Base de datos); no se escribe en su base de datos · *imported through `rekordbox.xml`; its database is never written.* |
| Serato DJ | Paleta fija: cada cue toma el color más parecido. WAV y OGG no admiten sus marcadores · *fixed palette: each cue takes the closest colour. WAV and OGG cannot hold its markers.* |
| Traktor | Sin colores de cue en `collection.nml` · *no cue colours in `collection.nml`.* |
| VirtualDJ | Los colores los asigna VirtualDJ · *VirtualDJ assigns the colours.* Los temas en discos externos pueden usar `<disco>/VirtualDJ/database.xml` · *tracks on external drives may use their own database.* |
| Engine DJ | Bibliotecas de esquema 2.x (Engine DJ 2 y 3) y 3.x (Engine DJ 4); las demás se rechazan sin tocarlas · *2.x and 3.x library schemas; any other is refused untouched.* |

### Importar (13.1) · Import (13.1)

Tonalia solo lee la colección del otro programa (si está abierto, una copia). Lo que cada uno no guarda no se puede traer.
*Tonalia only reads the other program's collection (a copy if it is open). What a program does not keep cannot be brought over.*

| Programa | Qué no llega · What does not come across |
|---|---|
| Rekordbox | Nada de lo que hay en el `rekordbox.xml`; lo que no se exporta en él (p. ej., el historial) no · *everything in `rekordbox.xml` comes; what it does not export (e.g. history) does not.* |
| Serato DJ | Valoración y reproducciones (no las guarda) · *rating and play count (it keeps none).* |
| Traktor | Colores de cue; con varios marcadores de rejilla se toma un solo tempo · *cue colours; with several grid markers one tempo is kept.* |
| VirtualDJ | Colores de cue (sin documentar) · *cue colours (undocumented).* |
| Engine DJ | Loops (su formato no está documentado con fiabilidad) y reproducciones · *loops (their format is not reliably documented) and play count.* |

### De un programa a otro (13.2) · From one program to another (13.2)

Llevar la biblioteca encadena Importar y Exportar, así que llega lo que el origen guarda **y** Tonalia escribe en el destino. Antes de escribir, la revisión lista lo que se queda por el camino (`convert.py`, tabla `LOSSES`).
*Taking the library chains Import and Export, so what arrives is what the source keeps **and** Tonalia writes to the target. Before writing, the review lists what is left behind.*

| Destino · Target | Qué no llega · What does not arrive |
|---|---|
| Rekordbox | Memory cues y loops, valoración y reproducciones · *memory cues and loops, rating and play count.* |
| Traktor | Colores de cue, cambios de tempo (un solo tempo), memory cues y loops, valoración, reproducciones y comentario · *cue colours, tempo changes (one tempo), memory cues and loops, rating, play count and comment.* |
| Serato DJ | Rejilla (no se escribe), colores exactos (paleta fija), memory cues y loops, valoración, reproducciones y comentario; la tonalidad y el BPM los lee de los tags (Tags) · *grid (not written), exact colours (fixed palette), memory cues and loops, rating, play count and comment; key and BPM come from the tags.* |
| VirtualDJ | Colores de cue, cambios de tempo, memory cues y loops, valoración, reproducciones y comentario · *cue colours, tempo changes, memory cues and loops, rating, play count and comment.* |
| Engine DJ | Memory cues y loops, valoración, reproducciones y comentario; los temas deben estar ya en su colección · *memory cues and loops, rating, play count and comment; tracks must already be in its collection.* |

## Instalación limpia · Clean install

Sin herramientas de desarrollo, con el instalador de la release y siguiendo [`install.md`](install.md). La lista completa está en `manual-tests.md` → «Instalación limpia».
*No developer tools, with the release installer, following [`install.md`](install.md).*

| Sistema · System | Versión · Version | Instala y abre · Installs and opens | Analiza · Analyses | Stems | Exporta · Exports | Fecha · Date | Tonalia |
|---|---|---|---|---|---|---|---|
| macOS (Apple Silicon) | | · | · | · | · | | |
| macOS (Intel) | | · | · | · | · | | |
| Windows 11 | | · | · | · | · | | |

En Apple Silicon ya se comprobó sin herramientas de desarrollo que la app arranca y lanza su motor (2026-10-12); falta la prueba con la descarga real (Gatekeeper) y el resto de la lista.
*On Apple Silicon the app was already checked to start and launch its engine without developer tools; the real download (Gatekeeper) and the rest of the list are still to do.*

## Fallos encontrados · Issues found

Cada fallo es un issue en GitHub y se arregla antes de cerrar la fase 11. Un fallo en cues, tonalidad o BPM bloquea la publicación.
*Each failure is a GitHub issue and is fixed before phase 11 closes. A failure in cues, key or BPM blocks the release.*

| Programa | Qué falla · What fails | Issue | Estado · Status |
|---|---|---|---|
| | | | |
