# Pruebas manuales / Manual tests

Lo que no se puede automatizar porque depende de programas de terceros o de la escucha.
Cada fase añade su lista; márcala con la fecha, la versión de Tonalia y la del programa.

Haz siempre las pruebas con **copias** de unos pocos temas.

El resultado de las pruebas con los programas de DJ y de la instalación limpia se resume en [`compatibility.md`](compatibility.md).

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

## Fase 5 — Integraciones con software de DJ

Prepara 5–10 temas analizados con cues (por ejemplo, de tu carpeta de pruebas) y una playlist con carpeta. Anota para cada programa si los cues caen **en el mismo compás** que en Tonalia y si el **color** coincide (los programas con paleta fija usan el color más cercano).

### Rekordbox (5.1)
1. Tonalia → Exportar → Rekordbox → «Simular»: revisa el resumen y los avisos.
2. «Exportar» y guarda `rekordbox.xml`.
3. Rekordbox → Preferencias → Avanzado → Base de datos → «rekordbox xml»: elige el archivo. En Preferencias → Vista → Diseño, activa «rekordbox xml».
4. Arrastra la playlist desde «rekordbox xml» a la colección.
- [ ] Los hot cues A–H aparecen en la posición correcta (comparar con la forma de onda de Tonalia).
- [ ] Nombres y colores de los hot cues correctos.
- [ ] El beatgrid coincide con los golpes (primer downbeat en el compás 1).
- [ ] La tonalidad aparece en la columna «Tonalidad».
- [ ] La carpeta y la playlist (con emoji) se importan con los temas en orden.
- [ ] Al exportar dos veces, Tonalia indica la copia de seguridad del archivo anterior.
- Nota: si los cues de algún MP3 aparecen desplazados unos milisegundos, anótalo con el codificador del archivo (problema conocido de algunos MP3 sin cabecera LAME).

### Traktor (5.2)
1. Cierra Traktor. Tonalia → Exportar → Traktor: comprueba que indica la colección encontrada (o elígela con «Cambiar…»).
2. Abre Traktor antes de exportar: la tarjeta debe avisar y desactivar «Exportar» (simular sigue disponible). Ciérralo.
3. «Simular» y después «Exportar». Abre Traktor.
- [ ] Los hot cues 1–8 aparecen en la posición correcta y con su nombre.
- [ ] El beatgrid (marcador de grid) cae en el primer downbeat y el BPM coincide.
- [ ] La tonalidad aparece correcta (verifica 3 temas: un mayor, un menor, uno con sostenido; anota el valor `MUSICAL_KEY` si no coincide).
- [ ] Tus datos previos de Traktor siguen ahí: contador de reproducciones, loops guardados y cues en otras ranuras.
- [ ] En Playlists aparece la carpeta «Tonalia» con tus carpetas y playlists; al exportar de nuevo se reemplaza (no se duplica).
- [ ] La copia de seguridad indicada existe y se puede restaurar copiándola sobre `collection.nml`.

### Serato (5.3)
1. Tonalia → Exportar → Serato → «Simular» (indica cuántos archivos cambiarían) y «Exportar».
2. Abre Serato DJ y carga los temas (Serato lee los marcadores al cargar; si ya estaban analizados en Serato, vuelve a cargarlos).
- [ ] Los hot cues aparecen en la posición correcta, con su nombre.
- [ ] Los colores corresponden (Serato usa su paleta: el color será el más parecido).
- [ ] Los loops y cues que ya tenías en Serato en otras ranuras siguen ahí.
- [ ] Con Serato cerrado al exportar, en la columna de crates aparece «Tonalia» con tus playlists dentro (las carpetas, como sub-crates) y tus crates siguen igual.
- [ ] «Deshacer» en el resultado de Tonalia deja los archivos como estaban (Serato vuelve a mostrar los cues anteriores).
- Formatos: MP3, M4A, FLAC y AIFF. WAV y OGG se omiten con aviso.

### VirtualDJ (5.4)
1. Cierra VirtualDJ. Tonalia → Exportar → VirtualDJ: comprueba la base de datos encontrada (o elige `database.xml`). Con VirtualDJ abierto, «Exportar» debe estar desactivado.
2. «Simular» y «Exportar». Abre VirtualDJ.
- [ ] Los hot cues aparecen en la posición correcta y con su nombre (los colores los asigna VirtualDJ).
- [ ] El beatgrid empieza en el primer downbeat y el BPM coincide.
- [ ] La tonalidad aparece correcta.
- [ ] Tus datos previos siguen ahí: reproducciones, estrellas, puntos de automix y cues en otras ranuras.
- [ ] En «Mis Listas» aparece la carpeta «Tonalia» con tus playlists (las carpetas de Tonalia, como subcarpetas) y en el mismo orden; tus otras listas siguen igual.
- Nota: los temas en discos externos pueden tener su propia base de datos en `<disco>/VirtualDJ/database.xml`; elígela con «Cambiar…» si esos temas no muestran los cues.

## Fase 10 — Engine DJ (10.5)

Usa una **copia** de tu carpeta «Engine Library» si puedes, o deja que Tonalia haga su copia de seguridad (la indica en el resultado).

1. En Engine DJ, importa 5–10 temas analizados en Tonalia (con cues) y cierra Engine DJ.
2. Tonalia → Exportar → Engine DJ: comprueba que indica `…/Engine Library/Database2/m.db` (o elígelo con «Cambiar…»; vale también el de un USB).
3. Abre Engine DJ antes de exportar: la tarjeta debe avisar y desactivar «Exportar». Ciérralo.
4. «Simular»: los temas que no estén en Engine DJ salen como «Añadido». «Exportar» y abre Engine DJ.
- [ ] Los hot cues 1–8 aparecen en la posición correcta, con su nombre y color.
- [ ] El beatgrid cae en los golpes (primer downbeat en el compás 1) y el BPM coincide.
- [ ] La tonalidad es la correcta (comprueba un mayor, un menor y uno con sostenido).
- [ ] Los pads que ya tenías en Engine DJ en ranuras sin cue de Tonalia siguen ahí, igual que el cue principal y los loops.
- [ ] Aparece la playlist «Tonalia» con tus carpetas y playlists, con los temas en orden; al exportar de nuevo se sustituye (no se duplica).
- [ ] Tus propias playlists de Engine DJ siguen intactas.
- [ ] Un tema que no estaba en Engine DJ aparece en la colección y en su playlist de «Tonalia», Engine lo analiza (forma de onda) y conserva los cues de Tonalia.
- [ ] En Engine DJ, «restablecer» el beatgrid vuelve al análisis propio de Engine.
- [ ] La copia de seguridad indicada existe; copiada sobre `m.db` (con Engine DJ cerrado) deja la biblioteca como estaba.
- Anota la versión de Engine DJ: Tonalia admite las bibliotecas de esquema 2.x (Engine DJ 2 y 3) y 3.x (Engine DJ 4) y rechaza las demás sin tocarlas.

Resultado: ___ · Fecha: ____ · Versión de Tonalia: ____ · Engine DJ: ____

## Fase 13 — Importar desde programas de DJ (13.1)

Para cada programa que tengas (Rekordbox con un `rekordbox.xml` exportado, Traktor, Serato, VirtualDJ, Engine DJ):

1. Pon a mano en el programa 2–3 hot cues con nombre y color, un memory cue y un loop en un tema que también esté en Tonalia; valóralo y ponle un comentario.
2. Tonalia → Importar → el programa → «Vista previa».
- [ ] El tema sale emparejado y la tabla «antes → después» enseña sus cues, la valoración y el comentario.
- [ ] Con la colección en otro disco o letra de unidad, aparece la «ruta cambiada» detectada y empareja esos temas.
3. «Importar» y abre el tema en Tonalia.
- [ ] Los hot cues están en su pad, en la posición, con su nombre (y color, salvo Traktor y VirtualDJ).
- [ ] Debajo de los pads salen el memory cue y el loop; arriba, las estrellas y las reproducciones.
- [ ] Las playlists están en «Importado de …» con su jerarquía y orden.
- [ ] La colección del programa no ha cambiado (fecha de modificación igual) y el programa la abre como siempre.
4. Reanaliza el tema: los cues importados siguen ahí.
5. «Deshacer»: el tema vuelve a como estaba y la carpeta «Importado de …» desaparece.

Resultado: ___ · Fecha: ____ · Programas y versiones: ____

## Fase 13 — De un programa a otro (13.2)

Con dos programas instalados (por ejemplo, Rekordbox → Traktor; repite con los pares que uses):

1. En el de origen, deja un tema con 3 hot cues con nombre y color, la rejilla corregida a mano y en una playlist dentro de una carpeta. Cierra el de destino.
2. Tonalia → Exportar → «De un programa a otro» → elige origen y destino → «Revisar el viaje».
- [ ] El informe dice cuántos temas hay y cuántos están en Tonalia, qué se escribiría y «Lo que no llega» (en Traktor: colores de cue).
- [ ] Ni la colección de origen ni la de destino han cambiado (fecha de modificación igual).
3. Abre el destino: «Llevar a …» se queda desactivado y lo explica. Ciérralo.
4. «Llevar a …» → confirma.
- [ ] En el destino, el tema tiene los hot cues en su pad, en el mismo compás y con su nombre (y color donde se guarda).
- [ ] La rejilla cae en los mismos beats que en el origen.
- [ ] Las playlists están en la carpeta «Tonalia» del destino (en Rekordbox, al importar el XML) con su jerarquía.
- [ ] «Mostrar copia de seguridad» abre la copia de la colección anterior.
5. «Deshacer en Tonalia»: Tonalia vuelve a como estaba (el destino conserva lo escrito; para revertirlo, la copia).

Resultado: ___ · Fecha: ____ · Programas y versiones: ____

## Fase 13 — Duplicados (13.3)

1. Ten en la biblioteca el mismo tema en MP3 y en FLAC con tags distintos, dos mezclas del mismo tema (Original y Extended) y un tema distinto con la misma duración.
2. Duplicados → «Buscar duplicados».
- [ ] MP3 + FLAC salen como «Mismo audio», con la FLAC propuesta («sin pérdida»).
- [ ] Las dos mezclas salen como «Otra versión»; el tema distinto no sale.
3. Pon un cue tuyo en la MP3 y métela en una playlist. «Fusionar en la elegida» (la FLAC) sin papelera.
- [ ] La FLAC tiene el cue y está en la playlist; la MP3 ya no está en la biblioteca pero su archivo sigue en el disco.
- [ ] «Deshacer» la devuelve como estaba.
4. Repite marcando «Mover … a la papelera»: el archivo de la MP3 aparece en la papelera del sistema (Mac y Windows) y se puede recuperar.
5. «Son versiones distintas» en las dos mezclas y vuelve a buscar: no salen.

Resultado: ___ · Fecha: ____ · Sistema: ____

## Fase 13 — Historial (13.4)

1. Toca unos temas de tu biblioteca en cada programa (o usa un historial que ya tengas). En Rekordbox, exporta después la colección como `rekordbox.xml`.
2. Historial → «Importar historial» → «Importar» en cada programa.
- [ ] Rekordbox · [ ] Traktor · [ ] Serato · [ ] VirtualDJ · [ ] Engine DJ: aparecen sus sesiones con la fecha correcta y los temas en el orden en que sonaron.
- [ ] Traktor: lo que solo escuchaste en los auriculares no cuenta. Serato: un tema cargado y no tocado no cuenta.
- [ ] La tabla muestra «Veces tocado» y «Última vez» con los valores esperados; importar otra vez no los duplica.
3. Marca una playlist como tocada ayer → aparece como sesión «Marcado a mano»; «Deshacer» la quita.
4. Constructor de sets con «Evitar temas tocados hace poco» (7 días) → ningún tema tocado esta semana entra en el set y la línea dice cuántos quedaron fuera. Lo mismo en las ideas de Pro.
5. Historial → «No tocados en 30 días» → la playlist inteligente no tiene temas tocados este mes.

Resultado: ___ · Fecha: ____ · Programas y versiones: ____

## Fase 13 — Espectrograma (13.5)

1. Prepara un MP3 de 128 kbps y conviértelo a FLAC (o a MP3 de 320 kbps) con cualquier conversor; ten también un FLAC auténtico.
2. Analiza los tres.
- [ ] El convertido sale en «Revisar calidad» con «Corte espectral»; al pulsarlo, la línea queda hacia 16-17 kHz y la frase dice que probablemente viene de 128 kbps.
- [ ] El MP3 de 128 kbps dice «lo normal en un MP3 de unos 128 kbps».
- [ ] El FLAC auténtico llega por encima de 19-20 kHz y no sale en «Revisar calidad».
- [ ] En el detalle de cada uno se ve la sección «Espectrograma», también en modo claro.

Resultado: ___ · Fecha: ____ · Sistema: ____

## Fase 10 — Instalación limpia (10.3)

Criterio: Tonalia se instala y funciona en un Mac y en un PC **sin herramientas de desarrollo**
(sin Python, uv, Homebrew, Node ni Rust). Usa un equipo o una cuenta de usuario nuevos y los
instaladores de la release (o los artefactos de la CI). Sigue `docs/install.md`.

| Comprobación | Mac Apple Silicon | Mac Intel | Windows 10/11 |
|---|---|---|---|
| El instalador abre (DMG monta / setup.exe arranca, idioma español o inglés) | | | |
| Primera apertura con el paso de *Privacidad y seguridad* / SmartScreen | | | |
| La barra lateral muestra «Motor listo» | | | |
| Importar una carpeta con tildes y emojis en el nombre y analizarla | | | |
| Tonalidad, BPM, energía y cues aparecen; la forma de onda se ve | | | |
| Reproducir un tema y saltar entre cues | | | |
| Pro: cargar A, «Probar mashup» suena sincronizado | | | |
| Separar stems de un tema (descarga el modelo la primera vez) | | | |
| Escribir tags y «Deshacer» | | | |
| Exportar a un programa de DJ (simulación) | | | |
| Ajustes → Acerca de → «Abrir carpeta de logs» abre la carpeta | | | |
| Ajustes → Actualizaciones → «Buscar ahora» responde | | | |
| Desinstalar: la música no se toca | | | |

Fecha: ____ · Versión de Tonalia: ____ · Versión del sistema: ____

Verificado por el agente (2026-10-12, Mac Apple Silicon, macOS 27): el `.dmg` ad-hoc monta, la
app copiada a una carpeta con tilde y emoji arranca con un entorno vacío
(`env -i PATH=/usr/bin:/bin`), lanza el motor empaquetado y abre su base de datos;
`codesign --verify --deep --strict` es válido y `LSMinimumSystemVersion` = 14.0. Falta el paso de
Gatekeeper con la descarga real (requiere pulsar «Abrir igualmente») y los otros dos equipos.
