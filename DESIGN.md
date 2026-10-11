# DESIGN — Tonalia

> Brief de diseño completo para Claude Design. Describe la marca, el sistema visual y **todas las pantallas** de Tonalia, una app de escritorio gratuita y de código abierto (macOS y Windows) para DJs: detecta la tonalidad, el BPM y la energía de cada tema, coloca cue points automáticos, sugiere mashups y transiciones, separa stems y construye sets.
>
> **Qué te pido, Claude Design:** crea el sistema de diseño (tokens + componentes) y las pantallas de la sección 6 en **modo oscuro** (principal) y las marcadas con ☀︎ también en **modo claro**, a 1440 × 900 px (ventana de escritorio). Usa datos de ejemplo realistas (sección 8). Todo el texto de la interfaz en **español**.

---

## 1. La marca

**Nombre:** Tonalia (siempre con mayúscula inicial; nunca "TONALIA" salvo en el logotipo si el diseño lo pide).
**Lema:** *"Mezcla en armonía."* (inglés: *"Mix in harmony."*)

**Personalidad:** musical, nocturna, precisa y cálida. Es la herramienta de preparación de un DJ a las 2 de la madrugada: tiene que verse como un instrumento profesional, no como un juguete, pero con el brillo de una cabina iluminada. Libre y de la comunidad: cercana, sin agresividad comercial.

**Palabras clave:** armonía · círculo · onda · aurora · noche · precisión · flujo.

**Lo que NO es:** no debe parecerse a Mixed In Key, Rekordbox, Serato ni Traktor (ni colores corporativos, ni disposición idéntica, ni iconos). No usar la palabra "Camelot". Nada de estética "gamer" (sin neones agresivos, sin biseles, sin fuentes futuristas).

### 1.1 Logotipo
- **Símbolo:** un círculo formado por **12 segmentos** de arco (la rueda armónica) con los colores de la rueda (sección 2.3) en degradado continuo; en el centro, una **onda sinusoidal** blanca que lo cruza horizontalmente. Debe funcionar a 16 px (favicon / icono de bandeja), donde se simplifica a anillo + onda.
- **Logotipo:** símbolo + "Tonalia" en Space Grotesk Medium, interletrado −1 %.
- Entregar: icono de app (macOS redondeado tipo *squircle* y Windows cuadrado), versión monocroma blanca y negra.

---

## 2. Color

Diseño **oscuro primero**. Fondo nocturno ligeramente violeta (no gris puro ni negro puro), superficies por capas y un acento "aurora" violeta-coral. El color fuerte se reserva para la **información musical** (tonalidad, energía, cues, decks) para que la interfaz no compita con los datos.

### 2.1 Neutros y superficies

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `bg` | `#0B0B14` | `#F7F6FB` | fondo de la ventana |
| `surface-1` | `#12121D` | `#FFFFFF` | barra lateral, paneles |
| `surface-2` | `#191927` | `#F1F0F7` | tarjetas, tabla, decks |
| `surface-3` | `#232335` | `#E8E6F1` | hover, inputs, chips neutros |
| `border` | `#2C2B42` | `#DDDAE8` | separadores, bordes de 1 px |
| `border-strong` | `#3D3B58` | `#C7C3D8` | foco suave, divisores de sección |
| `text` | `#F3F2FA` | `#15141F` | texto principal |
| `text-2` | `#A9A7BF` | `#55536A` | texto secundario |
| `text-3` | `#6F6D88` | `#8A879E` | ayudas, deshabilitado, metadatos |

### 2.2 Acentos de marca

| Token | Valor | Uso |
|---|---|---|
| `primary` | `#7C6CFF` (violeta "Aurora") | botones principales, selección, foco, enlaces |
| `primary-hover` | `#8F81FF` | |
| `primary-soft` | `#7C6CFF` al 16 % | fondo de fila seleccionada, chips activos |
| `accent` | `#FF5F8A` (coral) | acciones destacadas del modo Pro, favoritos ★ |
| `gradient-aurora` | `linear-gradient(135deg, #7C6CFF 0%, #C45CFF 50%, #FF5F8A 100%)` | logo, botón "Probar mashup", hero de bienvenida, barras de progreso globales. **Con moderación** (máx. 1–2 usos por pantalla) |
| `success` | `#3DDC97` | análisis completo, transición buena |
| `warning` | `#FFB547` | confianza baja, transición regular |
| `danger` | `#FF5C5C` | errores, transición mala, clipping |
| `info` | `#4CC3FF` | avisos neutros |

**Decks del modo Pro:** Deck A = **cian** `#3FD0E0`, Deck B = **coral** `#FF7A6B`. Todo lo que pertenece a un deck (bordes, cabezal de reproducción, forma de onda superpuesta, crossfader) usa su color.

### 2.3 Colores de la rueda armónica (tonalidades)

Cada número de la rueda tiene un tono; las tonalidades **menores (A)** usan la variante profunda y las **mayores (B)** la variante clara. Los tonos vecinos de la rueda son colores vecinos, así que los temas compatibles "se ven" compatibles.

| Nº | A (menor) | B (mayor) | Clásica A / B |
|---|---|---|---|
| 1 | `#D15B60` | `#FF9D9E` | A♭m / B |
| 2 | `#CB6620` | `#FCA676` | E♭m / F♯ |
| 3 | `#B47900` | `#E6B55D` | B♭m / D♭ |
| 4 | `#8D8D00` | `#C2C564` | Fm / A♭ |
| 5 | `#4F9B3E` | `#94D186` | Cm / E♭ |
| 6 | `#00A278` | `#61D7B2` | Gm / B♭ |
| 7 | `#009FAA` | `#43D5DC` | Dm / F |
| 8 | `#0094CE` | `#60CCFC` | Am / C |
| 9 | `#4D84DF` | `#90BFFF` | Em / G |
| 10 | `#8673D9` | `#BDB0FF` | Bm / D |
| 11 | `#AD65BE` | `#E0A4EE` | F♯m / A |
| 12 | `#C65B93` | `#F89DC9` | D♭m / E |

**Chip de tonalidad:** píldora de 22 px de alto, fondo = color de la tonalidad al 20 %, borde 1 px = color al 60 %, texto = color pleno (en oscuro) o color oscurecido un 35 % (en claro), fuente mono semibold. Ej.: `8A`. **Nunca** solo color: el texto de la tonalidad siempre está visible (accesibilidad).

### 2.4 Escala de energía (1–10), de fría a caliente

| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| `#00AEE9` | `#00B7CE` | `#00BBAA` | `#18BA81` | `#6BB454` | `#9AA922` | `#BE9B00` | `#D88B06` | `#E87E42` | `#FF4D6A` |

**Medidor de energía:** 10 barritas verticales de 3 × 12 px con 2 px de separación; las encendidas toman el color de su nivel (degradado de frío a caliente), las apagadas `surface-3`. A su derecha, el número en mono.

### 2.5 Colores de cue points (8 ranuras) y de secciones

| Cue | Sección típica | Color |
|---|---|---|
| 1 | Intro / primer beat | `#4CC3FF` |
| 2 | Build | `#3DDC97` |
| 3 | Drop | `#FF5F8A` |
| 4 | Breakdown | `#FFB547` |
| 5 | 2.º build | `#9D8CFF` |
| 6 | 2.º drop | `#FF7A3D` |
| 7 | Puente / voz | `#E0A4EE` |
| 8 | Outro | `#8A879E` |

Segmentos en la forma de onda: franja de 4 px bajo la onda con el color de la sección al 70 %.

### 2.6 Stems

Voz `#FF8FB1` · Batería `#FFC857` · Bajo `#7C6CFF` · Otros/melodía `#3FD0E0` · Instrumental (suma) `#A9A7BF`.

### 2.7 Forma de onda (3 bandas)
Graves `#5B4BFF`, medios `#3FD0E0`, agudos `#F3F2FA` (en claro: `#4B3BE0`, `#0094B0`, `#15141F`), apiladas/superpuestas al estilo RGB de las cabinas, con la parte ya reproducida atenuada al 45 %. Curva de energía superpuesta: línea de 1,5 px con el degradado de la escala de energía y relleno inferior al 8 %.

---

## 3. Tipografía

| Rol | Fuente | Tamaño / interlineado / peso |
|---|---|---|
| Display (bienvenida, títulos grandes) | **Space Grotesk** | 32/40 · 600 |
| Títulos de pantalla | Space Grotesk | 22/28 · 600 |
| Títulos de sección / tarjeta | **Inter** | 15/22 · 600 |
| Cuerpo | Inter | 13/20 · 400 |
| Tabla y controles | Inter | 13/18 · 400–500 |
| Etiquetas pequeñas / mayúsculas | Inter | 11/16 · 600 · +4 % interletrado · MAYÚSCULAS |
| Datos musicales (tonalidad, BPM, tiempos, energía) | **JetBrains Mono** | 13/18 · 500 (números tabulares) |
| Datos grandes en decks (BPM, tonalidad) | JetBrains Mono | 28/32 · 600 |

Todas son libres (OFL). La app es densa: el tamaño base es 13 px, como en las apps de audio profesionales.

---

## 4. Retícula, espacios y forma

- Ventana mínima 1200 × 760; diseño a 1440 × 900. Barra de título nativa integrada (semáforo de macOS a la izquierda en la barra lateral; en Windows, botones a la derecha).
- Escala de espacios: 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Radios: 6 px (inputs, chips cuadrados), 10 px (tarjetas, paneles), 999 px (píldoras), 14 px (modales).
- Sombras: en oscuro casi nada; se separa con superficies y bordes de 1 px. Modales y menús: `0 12px 40px rgba(0,0,0,.45)`. En claro: `0 1px 2px rgba(20,18,40,.06), 0 8px 24px rgba(20,18,40,.08)`.
- Iconos: **Lucide**, trazo 1,5 px, 16 px en controles y 20 px en la barra lateral.
- Densidad de tabla: filas de 36 px (cómoda) o 28 px (compacta, conmutador en la cabecera).
- Movimiento: 150 ms *ease-out* en hovers, 220 ms en paneles deslizantes, sin rebotes. El cabezal de reproducción y los medidores se mueven en tiempo real. Respetar "reducir movimiento".

---

## 5. Componentes (diseñar como biblioteca)

1. **Botones:** primario (violeta), secundario (`surface-3` + borde), fantasma, peligro, botón con degradado aurora (solo "Probar mashup" / "Probar mezcla"), botón icono 28 px. Estados: normal, hover, presionado, foco (anillo 2 px `primary` + 2 px separación), deshabilitado, cargando.
2. **Chip de tonalidad** (2.3) en sus 24 variantes + estado "baja confianza" (borde discontinuo + iconito ⚠ a la derecha) + estado "desplazado" (p. ej. `8A → 10A` con flecha y etiqueta "+2 st").
3. **Medidor de energía** (2.4) en tamaño tabla y en tamaño grande.
4. **Píldora BPM** en mono (`124.00`), con variante "×2 / ÷2".
5. **Celda de estado de análisis:** pendiente (círculo vacío), analizando (anillo de progreso animado con %), listo (✓ verde), error (⚠ rojo con tooltip del motivo).
6. **Fila de tabla:** normal, hover, seleccionada, reproduciéndose (barra de 2 px violeta a la izquierda + icono ecualizador animado), arrastrándose.
7. **Elementos de barra lateral:** sección con título en mayúsculas pequeñas, ítem con icono o **emoji**, contador a la derecha, carpeta desplegable, playlist inteligente (icono de varita), estado activo con `primary-soft`.
8. **Campo de búsqueda** con atajo `⌘F` visible; **slider de rango** (BPM, energía) con dos asas; **selector segmentado** (Mashup | DJ Mix; Tema | Voz | Instrumental); **interruptor**; **stepper de semitonos** (− `+2` +); **selector de emoji**.
9. **Forma de onda** (2.7) en tres tamaños: miniatura de tabla (opcional, 120 × 20), detalle (ancho completo × 120) y deck (ancho de deck × 96) con cabezal, cues numerados en banderitas de su color y región de loop sombreada.
10. **Cue pad:** 8 pads 2 × 4 o 1 × 8, cada uno con número, nombre de sección y color; estados vacío, asignado, activo.
11. **Rueda armónica** (componente estrella): dos anillos concéntricos de 12 segmentos (exterior = mayores B, interior = menores A) con sus colores, número/letra en cada segmento (y nombre clásico opcional). Estados: tonalidad actual (segmento a pleno + halo), compatibles (pleno al 70 %, con etiqueta de relación: "misma", "±1", "relativa", "+2 energía"), resto atenuado al 25 %. Tamaños 280 px (detalle) y 120 px (mini en deck).
12. **Piano** de 2 octavas: teclas blancas `#F3F2FA` / negras `#15141F` en ambos modos, las notas de la escala con un punto de color de la tonalidad, la tónica con el punto más grande, tecla pulsada iluminada en `primary`. Etiquetas de teclado del ordenador (A, W, S, E…) en mono pequeño.
13. **Tarjeta de idea** (modo Pro): puntuación grande (p. ej. **92**) en anillo de progreso, motivo en chips ("Misma tonalidad", "Voz A + Instr. B", "+1 st en B"), flechas ◀ ▶ y "3 / 48".
14. **Barra de transición** (constructor de sets): conector entre dos temas con puntuación y color verde/ámbar/rojo y los iconos de tonalidad → tonalidad, ΔBPM, Δenergía.
15. **Toasts, diálogos, panel deslizante lateral (420 px), menús contextuales, tooltips, barra de progreso global** (con degradado aurora), **estados vacíos** con ilustración lineal sencilla de la rueda + onda.
16. **Tabla "antes → después"** para vista previa de tags/limpieza: valor antiguo tachado en `text-3`, valor nuevo en `text`, diferencia resaltada en `success` al 16 %.

---

## 6. Pantallas

Disposición general (modo estándar):

```
┌──────────────┬──────────────────────────────────────────────────────┐
│  BARRA        │  BARRA SUPERIOR: título · búsqueda · filtros · vista │
│  LATERAL      ├──────────────────────────────────────────────────────┤
│  240 px       │                                                      │
│               │            CONTENIDO PRINCIPAL                       │
│               │                                                      │
│               ├──────────────────────────────────────────────────────┤
│               │  REPRODUCTOR INFERIOR (72 px): carátula · título ·   │
│               │  forma de onda mini · tonalidad · BPM · energía      │
└──────────────┴──────────────────────────────────────────────────────┘
```

**Barra lateral (240 px, `surface-1`):** logo arriba; conmutador grande **Biblioteca | Pro** (segmentado, Pro con un punto coral); secciones:
- BIBLIOTECA: 🎵 Todos los temas (12 480), ⏳ Analizar (cola, con contador), ✨ Recién añadidos, ⚠️ Revisar calidad (37).
- PLAYLISTS: carpetas y playlists anidadas con emoji (ver datos de ejemplo), botón "+".
- INTELIGENTES: 🔮 "Compatibles con 8A", 🔥 "Energía 8+", 🕓 "Sin analizar".
- PRO: ⭐ Mashups favoritos (24), 🧭 Constructor de sets.
- Abajo: Guías, Ajustes, estado del motor (punto verde "Motor listo").

### 6.1 Bienvenida / primera ejecución ☀︎
Pantalla limpia sobre `bg` con un gran halo aurora difuminado detrás del símbolo animado (la rueda gira despacio). Título "Bienvenido a Tonalia", lema, y una **zona de arrastre** enorme (borde discontinuo de 2 px, radio 14) "Arrastra aquí tu carpeta de música" + botón "Elegir carpeta…". Debajo, tres pasos ilustrados: *Analiza → Organiza → Mezcla en armonía*. Pie: "Gratis y de código abierto · Todo se procesa en tu ordenador".

### 6.2 Biblioteca (pantalla principal) ☀︎
- Barra superior: título "Todos los temas" + recuento; búsqueda; botón "Filtros" (con contador de filtros activos); selector de notación (8A / Am / 1m); conmutador de densidad; botón primario "Analizar".
- Fila de **filtros activos** como chips eliminables: "Tonalidad: compatible con 8A ✕", "BPM 122–128 ✕", "Energía ≥ 6 ✕".
- **Tabla** con columnas: ▶ (al hover), carátula 28 px, Título (+ artista debajo en `text-2` en modo cómodo), Tonalidad (chip), BPM, Energía (medidor), Cues (número + mini puntos de colores), Género, Duración, Estado, Añadido. Cabeceras ordenables con flecha.
- Mostrar: 1 fila reproduciéndose, 1 seleccionada, 1 analizando al 64 %, 1 con baja confianza, 1 con error.
- Reproductor inferior activo.

### 6.3 Biblioteca con filtros avanzados abiertos
Popover anclado a "Filtros" (380 px): mini rueda armónica clicable para elegir tonalidad + interruptor "Incluir compatibles"; slider BPM con casilla "Incluir ×2 / ÷2"; slider de energía 1–10 con la escala de color de fondo; selector de géneros (chips multiselección); playlist; estado. Botones "Limpiar" y "Aplicar".

### 6.4 Análisis en curso
La vista "Analizar": cabecera con barra de progreso global (degradado aurora), "Analizando 342 de 1.200 · quedan ~6 min", botones Pausar / Cancelar, y ajuste "Procesos en paralelo: 7". Lista de temas con su fase actual (Decodificando → Tonalidad → Tempo → Energía → Estructura → Forma de onda) como mini *stepper* de puntos. Panel lateral derecho con un **resumen en vivo**: distribución de tonalidades (mini rueda tipo mapa de calor) y distribución de energía (histograma con la escala de color).

### 6.5 Detalle del tema ☀︎
Abre al hacer doble clic (pantalla completa del área de contenido con botón "← Volver").
- Cabecera: carátula 120 px, título (22 px), artista, álbum · año · sello; a la derecha, tres **datos grandes**: Tonalidad (chip grande + "Confianza 92 %" + alternativas "9A, 8B" pequeñas), BPM `124.00`, Energía `7` con medidor grande. Si hay tonalidad secundaria: "Cambia a 9A en 3:12".
- **Forma de onda de detalle** a todo el ancho con: segmentos coloreados (Intro, Build, Drop, Breakdown, Drop 2, Outro) etiquetados encima, curva de energía superpuesta, 8 banderitas de cue numeradas, cabezal de reproducción y regla de compases (1, 17, 33…) debajo.
- Fila de **cue pads** (1 × 8) con botón "Fijar cue aquí" (Snap Cue) y menú "Restablecer automáticos".
- Abajo, en dos columnas: **Rueda armónica** (280 px) con la tonalidad y sus compatibles, y **Piano** con los botones "Tocar acorde" y "Tocar escala" y el interruptor "Tocar con el tema".
- Panel inferior de calidad: chips "320 kbps ✓", "−8,2 LUFS ✓", "Sin clipping ✓" o avisos en ámbar.
- Botón "Editar info" (abre 6.6) y "Abrir en Pro" (coral).

### 6.6 Panel "Info del tema" (deslizante, 420 px)
Formulario: Título, Artista, Álbum, Género (autocompletar), Año, Tonalidad (selector con la rueda), BPM (con botones ×2 / ÷2 y "tap tempo"), Energía (1–10 seleccionable con el medidor), Comentario. Indicador "Editado a mano" junto a los campos cambiados. Botones Guardar / Cancelar.

### 6.7 Escritura y limpieza de tags ☀︎
Pantalla en dos pestañas: **Escribir resultados** y **Limpiar tags**.
- Escribir: a la izquierda, opciones (campos a escribir con interruptores; plantilla de comentario con variables como chips arrastrables `{key}` `{energy}` `{bpm}`; posición: delante / detrás / sustituir). A la derecha, **vista previa antes → después** de los temas seleccionados (componente 16). Pie con aviso tranquilizador: "🛟 Se guarda una copia de los tags originales. Puedes deshacerlo." + botón primario "Escribir en 248 temas".
- Limpiar: lista de reglas con interruptores y ejemplo de cada una ("Quitar URLs — *www.promo-site.com* → ∅"), lista editable de frases promocionales y vista previa.
- Mostrar también el toast tras escribir: "Tags escritos en 248 temas · Deshacer".

### 6.8 Exportar a software de DJ
Cuatro tarjetas en rejilla 2 × 2 (Rekordbox, Traktor, Serato, VirtualDJ) **con iconos genéricos** (no logos oficiales; usar nombre en texto + icono de disco/archivo). Cada tarjeta: qué se exporta (checkboxes: cues, colores, beatgrid, tonalidad, playlists), estado detectado ("Colección encontrada en ~/Documents/Native Instruments…" / "Traktor está abierto — ciérralo para exportar" en ámbar), botones "Simular" y "Exportar". Panel de resultado tras exportar: "1.204 temas · 8.916 cues · 0 errores" con lista desplegable y "Abrir copia de seguridad". Para Rekordbox, un mini paso a paso de 3 pasos de cómo importar el XML.

### 6.9 Modo Pro — Mashup ☀︎ (pantalla estrella)
Al cambiar a **Pro**, el contenido se convierte en estudio de dos decks.

```
┌───────────────────────── [ Mashup | DJ Mix ] ──── Filtro de ideas ▾ ─────┐
│  DECK A (cian)                         │  DECK B (coral)                   │
│  carátula · título · artista           │  ◀  IDEA 3 / 48  ▶   [92]         │
│  8A  124.00  E7   [Tema|Voz|Instr]     │  carátula · título · artista      │
│  semitonos − 0 +   loop [4 compases]   │  8A→9A(+2st)  126→124  E6  [...]  │
│  ═══ forma de onda + cues + loop ═══   │  ═══ forma de onda + cues ═══     │
│  [1][2][3][4][5][6][7][8]              │  [1][2][3][4][5][6][7][8]         │
├────────────────────────────────────────┴──────────────────────────────────┤
│   Motivo: [Misma tonalidad +2st] [Voz A + Instr. B] [BPM ±1,6 %]          │
│     A ●────────────○──────────● B   crossfader   ▶ PROBAR MASHUP (aurora)  │
│   ☆ Guardar favorito   ⤓ Exportar stems   + Añadir a playlist             │
├───────────────────────────────────────────────────────────────────────────┤
│  Lista de ideas (tabla compacta con puntuación, tonalidad, BPM, motivo)   │
└───────────────────────────────────────────────────────────────────────────┘
```
- Deck A con borde superior cian de 2 px; Deck B coral. Selector de stem segmentado: **Tema | Voz | Instrumental**, con la forma de onda recoloreada con el color de la stem elegida.
- Mostrar: Deck A en "Voz" (forma de onda rosa de voz) con un loop de 4 compases sombreado; Deck B en "Instrumental" desplazado +2 semitonos (chip `8A → 10A` "+2 st").
- **Filtro de ideas** desplegado como barra: energía, rango BPM, playlists, géneros, interruptor "Permitir cambio de tono (±2)".
- Estado de stems: si aún no hay stems, botón "Separar stems" con progreso circular en el propio deck ("Separando voz… 42 %").

### 6.10 Modo Pro — DJ Mix
Misma estructura que 6.9 con el interruptor en **DJ Mix**: Deck A muestra el final del tema con la región de **outro** resaltada; Deck B la entrada con la región de **intro**; entre ambos, un **diagrama de transición** (dos formas de onda alineadas con la zona de crossfade de 32 compases sombreada en degradado cian → coral). Botón aurora "▶ Probar mezcla", botones "Mover B → A" y "+ Añadir a playlist". Indicador de energía de la transición: "E7 → E8 ↑".

### 6.11 Mashups favoritos
Rejilla de tarjetas (3 columnas): cada tarjeta muestra los dos temas (carátulas solapadas, una con borde cian y otra coral), tonalidades con desplazamiento, BPM común, estrellas 0–5 editables, notas, modo (Mashup / DJ Mix), botones ▶, "Abrir en decks" y "Exportar". Barra superior con orden (valoración, fecha) y búsqueda.

### 6.12 Constructor de sets ☀︎
- Izquierda (360 px): configuración — origen (playlist), duración objetivo "60 min" o "20 temas", tema inicial opcional, y **editor de curva de energía**: gráfico de 0 a 10 con puntos arrastrables y plantillas (Calentamiento → Pico → Cierre, Plana, Ascenso), con el fondo en la escala de color de energía. Botón primario "Generar set".
- Derecha: **línea de tiempo vertical** del set: cada tema como fila (nº, carátula, título, chip de tonalidad, BPM, energía) unida a la siguiente por la **barra de transición** (componente 14) verde/ámbar/rojo. Encima, una mini gráfica que compara la curva objetivo (discontinua) con la real. Acciones por tema: arrastrar para reordenar, "Reemplazar" (abre alternativas), quitar. Pie: "Puntuación media de transición 0,86 · 0 choques de tonalidad" + "Guardar como playlist" + "Exportar ▾".

### 6.13 Ajustes ☀︎
Navegación por secciones a la izquierda: General (idioma, tema Claro/Oscuro/Sistema con miniaturas), Análisis (notación con vista previa 8A / Am / 1m, rango BPM, redondeo, nº de cues 0–8, paleta de colores de cues editable, procesos en paralelo), Carpetas vigiladas (lista + añadir), Tags (plantilla por defecto), Stems (modelo Calidad máxima / Rápido, aceleración CPU / GPU, ubicación de caché con tamaño usado y botón "Vaciar"), Actualizaciones (interruptor), Acerca de (versión, licencia AGPL, créditos y atribuciones, "Abrir carpeta de logs").

### 6.14 Guías
Pantalla de lectura con índice a la izquierda (Mezcla armónica, Niveles de energía, Cue points y saltos de frase, Mashups con stems) y artículo a la derecha con ilustraciones: la rueda armónica explicada con flechas de movimientos compatibles, ejemplos de curva de energía de un set y diagrama de compases/frases de 8, 16 y 32.

### 6.15 Estados y diálogos (hoja de componentes)
- Estado vacío de biblioteca, de playlist, de favoritos y de resultados de búsqueda ("Ningún tema coincide · Quitar filtros").
- Error del motor: banner superior ámbar "El motor de análisis se ha reiniciado" con "Ver detalles".
- Diálogo de descarga del modelo de stems (tamaño, progreso, "Solo se descarga una vez").
- Diálogo de confirmación de exportación a Traktor con copia de seguridad.
- Menú contextual de una fila de la tabla: Reproducir, Abrir detalle, Cargar en Deck A / B, Añadir a playlist ▸, Reanalizar, Editar info, Mostrar en Finder/Explorador, Quitar de la biblioteca.
- Arrastrando archivos sobre la ventana: superposición con borde aurora "Suelta para añadir y analizar".

---

## 7. Accesibilidad y detalles de calidad
- Contraste AA mínimo en texto (comprobar los chips de tonalidad en modo claro).
- Información nunca solo por color: tonalidad con texto, energía con número, transiciones con icono (✓, ~, ✕) además del color.
- Foco visible en todo; todos los controles con tamaño de clic ≥ 24 px.
- Números tabulares (mono) en todas las columnas numéricas para que no "bailen".
- Truncado con elipsis y tooltip en títulos largos; fechas y números en formato español (1.204 · 124,00 en texto; la tabla puede usar punto decimal en BPM por convención DJ: `124.00`).

---

## 8. Datos de ejemplo (para las maquetas)

Usa temas **inventados** (no artistas reales):

| Título | Artista | Tonalidad | BPM | Energía | Género |
|---|---|---|---|---|---|
| Midnight Bloom | Lumen Drift | 8A | 124.00 | 7 | Melodic House |
| Golden Hour Tide | Sora Vela | 9A | 124.00 | 6 | Deep House |
| Neon Cathedral | Kairo | 8B | 126.00 | 8 | Techno |
| Velvet Static | Mara Ion | 7A | 122.00 | 5 | Organic House |
| Heatwave Protocol | Duo Arcadia | 10A | 128.00 | 9 | Tech House |
| Paper Satellites | Ines Halo | 3B | 120.00 | 4 | Downtempo |
| Run The Signal (Acapella) | Nova Reign | 8A | 124.00 | 6 | Acapella |
| Sunset Engine | The Quiet Orbit | 11B | 125.00 | 7 | Progressive |
| Cobalt Rain | Eli Marsh | 5A | 174.00 | 8 | Drum & Bass |
| Last Train To Lisbon | Amaro | 12A | 118.00 | 5 | Afro House |

Playlists de ejemplo: 📁 Bolos ▸ 🌅 Warm-up Ibiza, 🔥 Peak time, 🌙 Cierre · 📁 Radio ▸ 🎙️ Show semanal · 🧪 Por probar · 💿 Vinilos digitalizados.

Biblioteca: 12.480 temas · 37 en "Revisar calidad" · 24 mashups favoritos.

---

## 9. Entregables que necesito de Claude Design
1. **Sistema de diseño**: tokens de color (oscuro y claro), tipografía, espacios, radios, sombras e iconografía, exportables como variables CSS / tema de Tailwind.
2. **Biblioteca de componentes** de la sección 5 con todos sus estados.
3. **Pantallas** 6.1 a 6.15 en oscuro, y las marcadas ☀︎ también en claro.
4. **Logo e icono de app** (1.1).
5. Exportación de las pantallas como imágenes (PNG) y, si es posible, como HTML/CSS de referencia para que el equipo de desarrollo (React + Tailwind) las reproduzca.
