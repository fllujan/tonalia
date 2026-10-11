# Pruebas manuales / Manual tests

Lo que no se puede automatizar porque depende de programas de terceros o de la escucha.
Cada fase añade su lista; márcala con la fecha, la versión de Tonalia y la del programa.

Haz siempre las pruebas con **copias** de unos pocos temas.

## Fase 3 — Cues automáticos

Criterio: en 20 temas revisados a mano, ≥ 80 % de los cues marcan cambios de sección reales.

1. Importa y analiza 20 temas variados (house, techno, drum & bass, con y sin voz).
2. Abre cada tema (doble clic) y salta por sus cues con 1–8.
3. Apunta, por tema, cuántos cues caen en un cambio de sección real y cuántos no.

| Tema | Cues | Correctos | Notas |
|---|---|---|---|
| | | | |

Resultado: ___ / ___ correctos (___ %). Fecha: ____ · Versión: ____

## Fase 4 — Tags escritos

Criterio: los tags que escribe Tonalia se leen bien en Rekordbox, Serato y Traktor.

Preparación: un MP3, un M4A, un FLAC, un AIFF y un WAV analizados. En **Tags → Escribir
resultados**, con las opciones por defecto (tonalidad, BPM y comentario
`{key} - Energy {energy}` delante del comentario existente), escribe en los cinco.

| Comprobación | Rekordbox | Serato DJ | Traktor |
|---|---|---|---|
| La tonalidad aparece en su columna (MP3) | ☐ | ☐ | ☐ |
| La tonalidad aparece en su columna (M4A) | ☐ | ☐ | ☐ |
| La tonalidad aparece en su columna (FLAC) | ☐ | ☐ | ☐ |
| La tonalidad aparece en su columna (AIFF) | ☐ | ☐ | ☐ |
| El BPM aparece en su columna | ☐ | ☐ | ☐ |
| El comentario muestra «8A - Energy 7 …» | ☐ | ☐ | ☐ |
| Título, artista y carátula siguen intactos | ☐ | ☐ | ☐ |
| Tras «Deshacer», el programa vuelve a mostrar los valores originales (reimportar) | ☐ | ☐ | ☐ |

Notas por programa:

- **Rekordbox**: reimporta los archivos o usa «Volver a cargar etiqueta» para ver los cambios.
- **Serato**: «Rescan ID3 tags» en la biblioteca.
- **Traktor**: clic derecho → «Reanalyze» no hace falta; usa «Check consistency» / «Import».

Repite con la notación **Clásica** (Am, F#…) en las opciones para comprobar que los tres
programas también la reconocen.

Limpieza de tags (**Tags → Limpiar tags**): sobre una copia con título
`01 - MIDNIGHT BLOOM [Free Download]` y artista `Lumen Drift ft Ines Halo`, comprueba en
los tres programas que se lee `Midnight Bloom (feat. Ines Halo)` / `Lumen Drift`.

Fecha: ____ · Versión de Tonalia: ____ · Rekordbox ____ · Serato ____ · Traktor ____
