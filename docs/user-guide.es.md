# Guía de usuario de Tonalia

*Mezcla en armonía.* · [English](user-guide.en.md)

Tonalia analiza tu música en tu ordenador: tonalidad, BPM, energía, estructura y cue points. Con eso te ayuda a preparar sesiones: escribe los resultados en los tags, los lleva a tu programa de DJ, te sugiere mashups y transiciones, separa stems y construye sets. No hay cuentas, ni telemetría, ni servidores.

Para instalarla, consulta [`install.md`](install.md).

## Índice

1. [Primeros pasos](#1-primeros-pasos)
2. [La biblioteca](#2-la-biblioteca)
3. [Detalle del tema: forma de onda, cues, rueda y piano](#3-detalle-del-tema)
4. [Editar la información de un tema](#4-editar-la-información-de-un-tema)
5. [Escribir y limpiar tags](#5-escribir-y-limpiar-tags)
6. [Playlists y playlists inteligentes](#6-playlists-y-playlists-inteligentes)
7. [Exportar a tu software de DJ](#7-exportar-a-tu-software-de-dj)
8. [Stems](#8-stems)
9. [Modo Pro: mashups y DJ Mix](#9-modo-pro-mashups-y-dj-mix)
10. [Constructor de sets](#10-constructor-de-sets)
11. [Ajustes](#11-ajustes)
12. [Atajos de teclado](#12-atajos-de-teclado)
13. [Privacidad y tus archivos](#13-privacidad-y-tus-archivos)
14. [Problemas frecuentes](#14-problemas-frecuentes)

---

## 1. Primeros pasos

1. Abre Tonalia. La primera vez verás **«Bienvenido a Tonalia»**.
2. Arrastra tu carpeta de música a la ventana o pulsa **«Elegir carpeta…»**. Tonalia incluye las subcarpetas y acepta MP3, AAC/M4A, ALAC, AIFF, WAV, OGG y FLAC.
3. Los temas se añaden a la biblioteca y empiezan a analizarse solos. La barra de progreso muestra cuántos van, y el análisis se puede cancelar.

Más adelante puedes soltar carpetas o archivos en cualquier parte de la ventana. Aparece **«Suelta para añadir y analizar»**.

> Tonalia **no copia ni mueve** tu música: guarda la ruta de cada archivo. Si mueves un archivo, lo reconoce por su contenido y actualiza la ruta, sin duplicarlo.

### Qué calcula el análisis

| Dato | Qué significa |
|---|---|
| **Tonalidad** | Una de las 24 tonalidades, con la confianza y dos alternativas. Si la confianza es baja, el chip lleva un aviso. Si el tema cambia de tonalidad, se indica dónde («Cambia a 9A en 3:12»). |
| **BPM** | El tempo, con su beatgrid (dónde cae cada compás). Los temas de tempo variable se marcan como tales. |
| **Energía 1–10** | Lo intensa que es la parte principal del tema (no la intro), de 1 (tranquilo) a 10 (pico). La curva de energía se ve sobre la forma de onda. Puedes ajustarla a cómo la oyes tú con [Calibrar energía](#calibrar-energía). |
| **Estructura y cues** | Intro, build, drop, breakdown y outro, con hasta 8 cue points en los cambios importantes, siempre sobre un downbeat. |
| **Calidad** | Clipping, bitrate bajo, falsa alta calidad, sonoridad muy baja y silencios largos. Los temas con avisos aparecen en **Revisar calidad**, donde cada problema dice qué hacer (pasa el ratón por encima) y **✓ Marcar como revisado** quita el tema de la lista hasta que aparezca un problema nuevo (el aviso permite deshacerlo). |

### Calibrar energía

La energía es una opinión: lo que para un DJ es un 7, para otro es un 6. Si quieres que Tonalia la mida como tú, ve a **Ajustes → Análisis → Calibrar energía…** (o a la tarjeta **Energía personal** de Analizar):

1. **Escuchar:** cada tema suena 20 segundos desde su drop. Valóralo de 1 a 10 con las teclas **1–9** y **0** (= 10) o con el ratón. **→** salta un tema y **⌘Z** deshace la última valoración. Tonalia no te enseña su nivel para no condicionarte. Puedes parar cuando quieras: las valoraciones se guardan.
2. **Importar de los tags** (opcional): si ya anotabas la energía en el comentario o en *grouping* («Energy 7», «E7», «7 - …»), Tonalia la lee como valoraciones, con vista previa. Los niveles que escribió la propia Tonalia se dejan fuera.
3. Con **30 valoraciones**, pulsa **Calibrar**: verás el error medio antes y después (por ejemplo «1,4 → 0,8 niveles», medido en temas que la calibración no vio). Si mejora, **Aplicar a la biblioteca** recalcula la energía de todos los temas en unos segundos, sin volver a analizar el audio.

Las energías que pusiste a mano no cambian. **Volver al modelo por defecto** deshace la calibración cuando quieras. Los temas analizados con una versión anterior de Tonalia necesitan un reanálisis para entrar en la calibración.

## 2. La biblioteca

**Todos los temas** muestra la tabla con carátula, título y artista, tonalidad, BPM, energía, cues, género, duración, estado y fecha. La tabla aguanta bibliotecas de cien mil temas sin ir lenta.

- **Buscar:** el campo de arriba (⌘F en Mac, Ctrl+F en Windows) busca en título, artista y álbum mientras escribes.
- **Ordenar:** haz clic en la cabecera de una columna. Otro clic invierte el orden.
- **Densidad:** cambia entre filas cómodas y compactas.
- **Selección:** clic, Mayús+clic para un rango, ⌘/Ctrl+clic para sueltos. Con el teclado: flechas, Mayús+flechas, Inicio/Fin y Re Pág/Av Pág.
- **Abrir un tema:** doble clic o Intro.
- **Menú contextual** (clic derecho): reproducir, abrir el detalle, cargar en un deck, añadir a playlist, reanalizar, editar info, mostrarlo en Finder o el Explorador, y quitarlo de la biblioteca. Quitar un tema **no borra el archivo**.

### Notación de la tonalidad

En **Ajustes → Análisis** eliges cómo se escriben las tonalidades:

| Notación | Ejemplo (La menor / Do mayor) |
|---|---|
| Alfanumérica | 8A / 8B |
| Open Key | 1m / 1d |
| Clásica | Am / C |
| Clásica con bemoles | Igual, pero con bemoles (E♭m en lugar de D♯m) |

El color del chip indica la posición en la rueda armónica. Las tonalidades vecinas tienen colores vecinos, pero el texto siempre está visible: nunca dependes solo del color.

En la misma sección también ajustas:
- **Rango de BPM** (70–180 por defecto): el tempo se busca entre esos valores, y un tema fuera del rango se lee a la mitad o al doble. Para drum & bass, prueba de 85 a 180. Se aplica a los próximos análisis.
- **Colores de los cues**: un color por tipo de sección (intro, build, drop…). Los cues automáticos cambian de color al momento; los que coloreaste a mano se quedan como están.
- **Procesos en paralelo**: cuántos temas se analizan a la vez. «Automático» usa todos los núcleos menos uno.

### Filtros avanzados

El botón **Filtros** abre un panel con:
- la tonalidad (y **«Incluir compatibles»**);
- el rango de BPM (y **«Incluir ×2 / ÷2»**, para encontrar temas a la mitad o al doble de tempo);
- la energía, los géneros, una playlist, el estado del análisis y la calidad.

Los filtros activos aparecen como chips que se quitan con ✕. **«Guardar como playlist inteligente»** convierte la combinación en una playlist que se actualiza sola.

## 3. Detalle del tema

Haz doble clic en un tema para abrirlo; **Volver** (o Esc) te devuelve a la lista.

- **Datos grandes:** tonalidad con confianza y alternativas, BPM y energía.
- **Forma de onda:** coloreada por bandas (graves, medios y agudos), con los segmentos etiquetados, la curva de energía, los cues numerados y la regla de compases.
- **Reproductor:** espacio para reproducir o pausar, y salto al cue anterior o siguiente.
- **Cue points:**
  - Las teclas **1–8** saltan a cada cue.
  - **Arrastra** la banderita de un cue para moverlo.
  - Haz clic en un pad para cambiar su nombre o su color, o para borrarlo.
  - **«Fijar cue aquí»** (Snap Cue) pone un cue en la posición actual, ajustado al beat.
  - **«Restablecer automáticos»** vuelve a calcular los cues automáticos. Tus cues no se pierden al reanalizar: solo con este botón.
- **Rueda armónica:** resalta la tonalidad del tema y sus compatibles (misma, ±1, relativa, +2 de energía…). Haz clic en una tonalidad para ver en la biblioteca los temas compatibles con ella.
- **Piano:** dos octavas con la escala del tema marcada.
  - Tócalo con el ratón o con el teclado del ordenador (A W S E D F T G Y H U J K O L P; Z y X cambian de octava).
  - **«Tocar acorde»** y **«Tocar escala»** te dejan comprobar la tonalidad de oído.
  - **«Tocar con el tema»** suena encima de la música.
- **Calidad:** chips con el bitrate, la sonoridad (LUFS) y el clipping, en verde si están bien y en ámbar si hay que revisarlos.

### Editar la rejilla de beats

Si la rejilla no cae en el bombo, pulsa **«Editar rejilla»** bajo la forma de onda. Se abre una vista ampliada con una línea por beat (más marcada en el primero de cada compás) y estas herramientas:

- **«Primer downbeat aquí»** (tecla **D**, o doble clic en la vista ampliada): el beat que suena en el cabezal pasa a ser el primero de un compás.
- **Mover la rejilla:** **,** y **.** la mueven 1 ms; con **⇧**, 10 ms. También con los botones −10 / −1 / +1 / +10 ms.
- **BPM** con decimales, **×2** y **÷2**.
- **Tap** (tecla **T**, con el tema sonando): marca el pulso y Tonalia propone el BPM y la fase; pulsa «Usar … BPM» para aplicarlos.
- **Metrónomo** (tecla **M**): un clic en cada beat, más agudo en el primero del compás, para comprobar la rejilla de oído.
- **Tempo variable:** **«Añadir ancla aquí»** (tecla **A**) fija un beat en el cabezal; arrastra el rombo hasta el golpe real. Entre anclas, los beats se reparten por igual. «Quitar ancla» (o ⌫) la borra.
- **Deshacer y rehacer** (⌘Z / ⇧⌘Z en Mac, Ctrl+Z / Ctrl+Y en Windows); **Esc** o «Cancelar» cierran sin guardar.

Al **guardar**, la rejilla queda **bloqueada**: reanalizar el tema no la cambia (el candado junto al BPM la desbloquea). Los cues automáticos y las secciones se recolocan en los nuevos compases; tus cues se quedan donde estaban y, si alguno ya no cae en un beat, Tonalia te ofrece **«Ajustar al beat»**. **«Restablecer al análisis»** devuelve la rejilla que encontró el análisis. Todas las exportaciones, el modo Pro y el constructor usan la rejilla editada.

En **Guías**, en la barra lateral, tienes tutoriales sobre mezcla armónica, niveles de energía, cue points y frases, y mashups con stems.

## 4. Editar la información de un tema

**«Editar info»** abre un panel lateral con título, artista, álbum, género, año, tonalidad, BPM (con ×2, ÷2 y **Tap tempo**), energía y comentario.

- Lo que cambias a mano prevalece sobre el análisis y se marca como **«Editado a mano»**.
- Título, artista, álbum, género, año y comentario se escriben **en el archivo**, con copia de seguridad, y puedes deshacerlo.

## 5. Escribir y limpiar tags

Selecciona temas y pulsa **Tags**. Si no hay selección, se usan todos los temas de la vista.

### Escribir resultados

- Elige qué campos escribir: tonalidad, BPM y comentario. También puedes guardar la energía en «grouping» o en la valoración.
- **Plantilla del comentario** con variables: `{key}`, `{key_alt}`, `{energy}`, `{bpm}` y `{comment_original}`. La plantilla por defecto es `{key} - Energy {energy}`. Puedes escribirla delante del comentario existente, detrás o en su lugar.
- La **vista previa** muestra el antes y el después de cada tema. No se escribe nada hasta que pulsas **«Escribir en N temas»**.
- Antes de escribir se guarda una copia de los tags originales. El aviso final tiene **Deshacer**, que restaura exactamente lo que había. Si el aviso ya se cerró, la pestaña **Historial** de la pantalla Tags guarda cada escritura (resultados, limpieza, edición en lote y cues de Serato) con su fecha, sus temas y su botón **Deshacer**, que funciona mientras el archivo no haya cambiado después.
- Encima de las opciones, Tonalia dice a qué temas se aplicará: la selección o todos los temas de la vista, con los primeros títulos. **Cambiar** vuelve a la biblioteca.

Los tags escritos los leen Rekordbox, Serato, Traktor, VirtualDJ y la mayoría de DAW.

### Limpiar tags

Reglas que puedes activar, todas con vista previa:
- quitar URLs y dominios, frases promocionales (la lista se puede editar), números de pista en el título y «(Original Mix)»;
- quitar espacios dobles y pasar de MAYÚSCULAS a Tipo Título;
- normalizar «feat.» y mover al artista invitado al título o al artista;
- unificar el separador de artistas.

También puedes editar un campo en muchos temas a la vez.

## 6. Playlists y playlists inteligentes

- Crea **carpetas** y **playlists** anidadas sin límite, cada una con su icono (pulsa el icono para cambiarlo).
- **Arrastra** temas a una playlist de la barra lateral para añadirlos, y arrastra playlists para ordenarlas o moverlas de carpeta.
- **Playlists inteligentes:** se llenan solas con los temas que cumplen todas sus condiciones (tonalidad o compatibles, rango de BPM, energía, género, sin analizar, Revisar calidad o Favoritos).
- **M3U/M3U8:** puedes importar y exportar playlists para usarlas en otros programas.

### Carpetas vigiladas

En **Ajustes → Carpetas vigiladas**, añade las carpetas donde descargas música. Los temas nuevos se añaden y analizan solos: Tonalia revisa esas carpetas cada 30 segundos mientras está abierto, y espera a que cada archivo termine de copiarse.

## 7. Exportar a tu software de DJ

**Exportar** reúne los cinco destinos. Pulsa siempre **Simular** primero: te dice qué cambiará sin escribir nada. Al exportar, Tonalia guarda una copia del archivo anterior, y **«Mostrar copia de seguridad»** te lleva a ella.

| Destino | Qué se lleva | Cómo |
|---|---|---|
| **Rekordbox** | Hot cues con nombre y color, beatgrid, tonalidad y playlists | Genera un `rekordbox.xml`. En Rekordbox: Preferencias → Avanzado → Base de datos → «rekordbox xml», elige el archivo; luego arrastra los temas o playlists desde «rekordbox xml» (barra lateral) a tu colección. La pantalla te guía paso a paso. |
| **Traktor** | Cues y tonalidad | Actualiza tu `collection.nml`, que Tonalia busca solo. **Cierra Traktor antes**: si está abierto, Tonalia te avisa y no escribe. |
| **Serato** | Hot cues con color y nombre, y playlists | Los cues van dentro de cada archivo (MP3, M4A, FLAC y AIFF), donde Serato los lee; las playlists, en el crate «Tonalia» (se sustituye en cada exportación; tus crates no se tocan). Cierra Serato antes para que se escriban las playlists. |
| **VirtualDJ** | Cues, tonalidad y playlists | Actualiza su `database.xml` y crea la carpeta «Tonalia» en «Mis Listas» (se sustituye en cada exportación; tus listas no se tocan). Cierra VirtualDJ antes. |
| **Engine DJ** | Hot cues con nombre y color, beatgrid, tonalidad y playlists | Actualiza su base de datos (`Engine Library/Database2/m.db`, en tu carpeta Música o en un USB). **Cierra Engine DJ antes.** Los temas que aún no estén en Engine DJ se añaden a su colección, y Engine los analiza al abrirlo. Tus playlists aparecen dentro de una playlist «Tonalia», que se sustituye en cada exportación. Los pads sin cue de Tonalia y el análisis propio de Engine se conservan. |

La tonalidad, el BPM y la energía llegan a cualquier programa a través de los [tags](#5-escribir-y-limpiar-tags).

## 8. Stems

Tonalia separa cada tema en **voz, batería, bajo, otros** e **instrumental** (todo menos la voz), en tu ordenador.

- **Modelo** (Ajustes → Stems, o en el diálogo de la primera separación):
  - «Rápido» (`htdemucs`, unos 85 MB), el que viene elegido: un tema de 4 minutos tarda menos de un minuto en un Mac con Apple Silicon;
  - «Calidad máxima» (`htdemucs_ft`, unos 340 MB): algo mejor, pero tarda unas 4 veces más.

  Tras tu primera separación, cada modelo dice cuánto tarda **en tu ordenador** («≈ 40 s por tema de 4 min en este equipo»; «estimado» mientras ese modelo no se haya usado). Las stems que ya hayas separado con un modelo se conservan y se siguen usando aunque cambies de modelo.

  El modelo se descarga **una sola vez**, la primera vez que separas, y se comprueba que la descarga está completa.
- **Aceleración:** usa la GPU en los Mac con Apple Silicon; si no, usa la CPU.
- **GPU NVIDIA en Windows:** si el PC tiene una tarjeta NVIDIA compatible, Ajustes → Stems ofrece «Descargar aceleración GPU» (unos 2,6 GB, una sola vez). La descarga se puede cancelar y continúa donde se quedó; al terminar, Tonalia comprueba que la GPU funciona antes de usarla. Si no funciona, o falla durante una separación, Tonalia sigue con la CPU y te lo dice. Se desinstala desde el mismo sitio. Si el controlador de NVIDIA es antiguo, Tonalia te pide actualizarlo.
- **Separar:** desde el detalle del tema o desde un deck del modo Pro. **«Preparar stems»** separa una playlist entera de una vez.
- **Exportar:** en WAV, AIFF o FLAC (24 bits), en la tonalidad y el tempo originales o con el cambio de tono y de tempo aplicados. El nombre del archivo sale de una plantilla (`{artist} - {title} ({stem}) [{key} {bpm}]`) y el destino puede ser una carpeta o la del proyecto de tu DAW.
- La caché de stems se puede vaciar en Ajustes → Stems.
- **Presencia de voz:** el detalle del tema dice cuánta voz tiene y si es una **acapella**, un **instrumental** o un tema con voz. Antes de separar, Tonalia lo **estima** a partir del audio del tema (pone «estimada»); al separar las stems, lo **mide** en ellas. Las ideas de mashup y de DJ Mix lo usan, por ejemplo, para proponer la voz de un tema sobre el instrumental de otro.

## 9. Modo Pro: mashups y DJ Mix

Cambia a **Pro** en el selector de arriba de la barra lateral, o pulsa **«Abrir en Pro»** en un tema. Verás dos decks: **A** (cian) y **B** (coral).

### Mashup

1. Carga un tema en el **Deck A**.
2. El **Deck B** muestra la mejor idea de tu biblioteca, con su puntuación y el **motivo** («Misma tonalidad», «Relativa», «+1 st en B», «Voz A + Instr. B»…). Recorre las ideas con ◀ ▶ (o ← →).
3. **«Probar mashup»** (o espacio) reproduce los dos decks a la vez: B se adapta al tempo de A y los downbeats coinciden.
4. Cada deck tiene:
   - un **cambio de tono** de ±6 semitonos (las ideas se recalculan al momento);
   - un **selector de stem** (Tema / Voz / Instrumental);
   - un **loop** de 1 a 32 compases.
5. Haz clic en un **cue** de cualquier deck para escuchar ese fragmento sincronizado con el otro.
6. **Filtro de ideas:** limita las sugerencias por energía, BPM, playlists y géneros, y decide si se permite el cambio de tono (±2).
7. **Guardar favorito** guarda la combinación: temas, tonos, cues, stems y modo. En **Favoritos** puedes valorarla con estrellas, añadir notas, abrirla otra vez en los decks o exportar los dos archivos listos para tu DAW.

### DJ Mix

Con el selector en **DJ Mix**, B propone el siguiente tema para una transición fluida desde A:
- **«Probar mezcla»** reproduce el final de A y la entrada de B con un crossfade automático de 16 o 32 compases.
- **«Mover B → A»** convierte B en el tema actual y genera ideas nuevas.
- **«Añadir a playlist»** te ayuda a construir la sesión tema a tema.

## 10. Constructor de sets

1. Elige el **origen** (una playlist o la selección de la biblioteca).
2. Elige la **longitud**, en minutos o en número de temas, y, si quieres, el **tema inicial**.
3. Dibuja la **curva de energía**: arrastra los puntos o usa una plantilla (Calentamiento → Pico → Cierre, Plana, Ascenso). Con doble clic añades o quitas un punto.
4. Pulsa **«Generar set»**.

El resultado muestra cada transición con su puntuación:
- verde ✓: buena;
- ámbar ~: regular;
- rojo ✕: hay un choque de tonalidad sin alternativa.

Puedes reordenar arrastrando, **reemplazar** un tema (te muestra alternativas) o quitarlo, y luego guardarlo como playlist o exportarlo a Rekordbox, Traktor o M3U.

## 11. Ajustes

| Sección | Opciones |
|---|---|
| General | Idioma (español, inglés) y tema (claro, oscuro o el del sistema) |
| Análisis | Notación, decimales del BPM, número de cues automáticos (0–8) |
| Carpetas vigiladas | Carpetas que se importan y analizan solas |
| Stems | Modelo, aceleración, caché, carpeta del DAW y plantilla de exportación |
| Actualizaciones | Buscar actualizaciones al abrir (se puede desactivar) y «Buscar ahora» |
| Acerca de | Versión, licencia, código fuente, **licencias de terceros** y «Abrir carpeta de logs» |

## 12. Atajos de teclado

Pulsa **?** en cualquier momento (o «Atajos de teclado» en la barra lateral) para ver la lista completa. Los más usados:

| Atajo | Acción |
|---|---|
| Espacio | Reproducir o pausar (en Pro: probar el mashup o la mezcla) |
| 1–8 | Saltar al cue |
| ⌘F / Ctrl+F | Buscar |
| ⌘1–4 / Ctrl+1–4 | Biblioteca, Pro, Favoritos, Constructor |
| ⌘, / Ctrl+, | Ajustes |
| ← → | En Pro, idea anterior o siguiente |
| Esc | Cerrar un diálogo o panel, o volver del detalle |

Toda la app se puede usar con el teclado, y el foco siempre está visible.

## 13. Privacidad y tus archivos

- **Todo es local.** El análisis, los stems y las sugerencias se hacen en tu ordenador. Tonalia solo se conecta a internet para descargar el modelo de stems la primera vez y para buscar actualizaciones, y eso último se puede desactivar.
- **Nunca destruye datos.** Antes de escribir tags o de modificar una colección de Traktor o VirtualDJ se guarda una copia, y existe Deshacer. Las escrituras son atómicas: un archivo nunca se queda a medias.
- **Sin telemetría.** Los logs se guardan solo en tu ordenador (Ajustes → Acerca de → «Abrir carpeta de logs»).

## 14. Problemas frecuentes

**macOS dice que no puede abrir Tonalia.** La app no está notarizada por Apple. Sigue los pasos de [`install.md`](install.md) («Abrir igualmente» en Ajustes del Sistema).

**Un tema sale con «error» en el estado.** Pasa el ratón por el icono para ver el motivo (por ejemplo, un archivo dañado o un formato que no se puede leer). Los demás temas siguen analizándose.

**La tonalidad lleva un aviso ⚠.** La confianza es baja: compruébala con el piano («Tocar acorde» con «Tocar con el tema») y, si hace falta, corrígela en «Editar info».

**El BPM sale a la mitad o al doble.** En «Editar info», usa ×2 o ÷2 (o «Tap tempo»). Tus cambios manuales se respetan al reanalizar.

**Aparece «El motor de análisis se ha reiniciado».** Tonalia lo vuelve a arrancar solo. Si se repite, pulsa «Ver detalles» y abre la carpeta de logs para [informar del problema](https://github.com/fllujan/tonalia/issues/new/choose).

**Traktor, VirtualDJ o Engine DJ no reciben la exportación.** Cierra el programa antes de exportar y vuelve a abrirlo después.

**Engine DJ: «no se cerró bien».** Abre Engine DJ, ciérralo con normalidad y vuelve a exportar. Tonalia no toca una base de datos con cambios pendientes.

¿Has encontrado un error o tienes una idea? [Abre un issue](https://github.com/fllujan/tonalia/issues/new/choose). Si quieres colaborar, lee [`CONTRIBUTING.md`](../CONTRIBUTING.md).
