---
name: Tonalia
description: Analizador armónico y motor de mashups para DJs. Mezcla en armonía.
colors:
  bg: "#0B0B14"
  surface-1: "#12121D"
  surface-2: "#191927"
  surface-3: "#232335"
  border: "#2C2B42"
  border-strong: "#3D3B58"
  text: "#F3F2FA"
  text-2: "#A9A7BF"
  text-3: "#8C8AA1"
  bg-light: "#F7F6FB"
  surface-1-light: "#FFFFFF"
  surface-2-light: "#F1F0F7"
  surface-3-light: "#E8E6F1"
  border-light: "#DDDAE8"
  border-strong-light: "#C7C3D8"
  text-light: "#15141F"
  text-2-light: "#55536A"
  text-3-light: "#67647C"
  primary: "#7162E8"
  primary-hover: "#6555DA"
  primary-soft: "rgb(124 108 255 / 0.16)"
  row-selected: "rgb(124 108 255 / 0.26)"
  row-selected-light: "rgb(124 108 255 / 0.16)"
  primary-ink: "#8F81FF"
  primary-ink-light: "#6356CB"
  accent: "#FF5F8A"
  accent-light: "#B84564"
  accent-fill: "#C74A6C"
  success: "#3DDC97"
  success-light: "#227C55"
  warning: "#FFB547"
  warning-light: "#9D5E00"
  danger: "#FF5C5C"
  danger-light: "#BD4444"
  danger-fill: "#CB4949"
  info: "#4CC3FF"
  info-light: "#0072AC"
  deck-a: "#3FD0E0"
  deck-b: "#FF7A6B"
  key-1a: "#D15B60"
  key-1b: "#FF9D9E"
  key-2a: "#CB6620"
  key-2b: "#FCA676"
  key-3a: "#B47900"
  key-3b: "#E6B55D"
  key-4a: "#8D8D00"
  key-4b: "#C2C564"
  key-5a: "#4F9B3E"
  key-5b: "#94D186"
  key-6a: "#00A278"
  key-6b: "#61D7B2"
  key-7a: "#009FAA"
  key-7b: "#43D5DC"
  key-8a: "#0094CE"
  key-8b: "#60CCFC"
  key-9a: "#4D84DF"
  key-9b: "#90BFFF"
  key-10a: "#8673D9"
  key-10b: "#BDB0FF"
  key-11a: "#AD65BE"
  key-11b: "#E0A4EE"
  key-12a: "#C65B93"
  key-12b: "#F89DC9"
  on-key: "#0B0B14"
  piano-white: "#F3F2FA"
  piano-black: "#15141F"
  energy-1: "#00AEE9"
  energy-2: "#00B7CE"
  energy-3: "#00BBAA"
  energy-4: "#18BA81"
  energy-5: "#6BB454"
  energy-6: "#9AA922"
  energy-7: "#BE9B00"
  energy-8: "#D88B06"
  energy-9: "#E87E42"
  energy-10: "#FF4D6A"
  cue-1: "#4CC3FF"
  cue-2: "#3DDC97"
  cue-3: "#FF5F8A"
  cue-4: "#FFB547"
  cue-5: "#9D8CFF"
  cue-6: "#FF7A3D"
  cue-7: "#E0A4EE"
  cue-8: "#8A879E"
  stem-vocals: "#FF8FB1"
  stem-drums: "#FFC857"
  stem-bass: "#7C6CFF"
  stem-other: "#3FD0E0"
  stem-instrumental: "#A9A7BF"
  wave-low: "#5B4BFF"
  wave-mid: "#3FD0E0"
  wave-high: "#F3F2FA"
  wave-low-light: "#4B3BE0"
  wave-mid-light: "#0094B0"
  wave-high-light: "#5A5672"
typography:
  display:
    fontFamily: "Bricolage Grotesque Variable, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: "40px"
  headline:
    fontFamily: "Bricolage Grotesque Variable, system-ui, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: "28px"
  title:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
  body:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: "20px"
  control:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
  label:
    fontFamily: "Instrument Sans Variable, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "16px"
    letterSpacing: "0.04em"
  data:
    fontFamily: "Martian Mono Variable, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 450
    lineHeight: "18px"
    fontFeature: "tnum, zero"
  data-lg:
    fontFamily: "Martian Mono Variable, ui-monospace, monospace"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: "32px"
    fontFeature: "tnum, zero"
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "6": "24px"
  "8": "32px"
  "12": "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#FFFFFF"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  button-icon:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    size: "32px"
  button-aurora:
    textColor: "#FFFFFF"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "36px"
  input:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    typography: "{typography.control}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "32px"
  key-chip:
    typography: "{typography.data}"
    rounded: "{rounded.pill}"
    padding: "0 8px"
    height: "22px"
  segmented:
    backgroundColor: "{colors.bg}"
    rounded: "7px"
    padding: "2px"
  segmented-option-active:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text}"
    rounded: "5px"
    height: "28px"
  switch-on:
    backgroundColor: "{colors.primary}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
  switch-off:
    backgroundColor: "{colors.surface-3}"
    rounded: "{rounded.pill}"
    width: "36px"
    height: "20px"
  nav-item:
    textColor: "{colors.text-2}"
    rounded: "{rounded.sm}"
    padding: "0 8px"
    height: "30px"
  nav-item-active:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.text}"
  card:
    backgroundColor: "{colors.surface-2}"
    rounded: "{rounded.md}"
  modal:
    backgroundColor: "{colors.surface-1}"
    rounded: "{rounded.lg}"
---

# Design System: Tonalia

> **Fuente de verdad visual** (SPEC.md, regla 7). Los tokens de la cabecera YAML son normativos y coinciden con `app/src/styles/tokens.css` y `app/tailwind.config.ts`; el texto explica cómo aplicarlos. Este documento nació como un brief de diseño y se fusionó con el sistema implementado el 2026-10-12. Las secciones del brief original se conservan: los números entre paréntesis (§2.3, §5.11, §6.9…) son los que citan los comentarios del código. Tabla de correspondencias al final.
>
> Aquí solo lo visual: el producto y su arquitectura están en `SPEC.md`.

## Overview

**Creative North Star: "La cabina a las 2 a. m."**

Tonalia es la herramienta de preparación de un DJ a las dos de la madrugada: una sala a oscuras, un fondo nocturno ligeramente violeta y, encima, solo se encienden las cosas que importan para mezclar, como los LEDs de una cabina. Tiene que verse como un instrumento profesional, no como un juguete, pero con el brillo cálido de una cabina iluminada. Es musical, nocturna, precisa y cálida; libre y de la comunidad, cercana y sin agresividad comercial.

El sistema es **oscuro primero** y **denso**: el cuerpo es de 13 px, como en las apps de audio profesionales, y las superficies se separan por capas tonales y bordes de 1 px, casi sin sombras. El color fuerte no decora la interfaz: está reservado para la **información musical** (tonalidad, energía, cues, decks y stems), de modo que una tabla de miles de temas se lee de un vistazo y los temas compatibles «se ven» compatibles. La marca vive en un único gesto de brillo, el degradado aurora, usado con cuentagotas.

Rechazos confirmados: no parecerse a otras aplicaciones para DJs (ni colores corporativos, ni disposición idéntica, ni iconos); nada de estética «gamer» (sin neones agresivos, sin biseles, sin fuentes futuristas); nunca la palabra «Camelot».

**Key Characteristics:**
- Noche violeta por capas: `bg` → `surface-1` → `surface-2` → `surface-3`, con bordes de 1 px.
- El color es dato: rueda armónica (24 tonos), energía (10), cues (8), decks (2) y stems (5).
- Datos musicales siempre en Martian Mono estrecha, como la pantalla de un equipo.
- Densidad profesional: base 13 px, controles de 32 px, filas de 28–36 px.
- Aurora como único brillo de marca, uno o dos usos por pantalla.
- Modo claro completo, con los colores de estado oscurecidos para AA.

### Marca y logotipo (§1)

- **Nombre:** Tonalia, siempre con mayúscula inicial (nunca «TONALIA» salvo en el logotipo si el diseño lo pide). **Lema:** «Mezcla en armonía.» / «Mix in harmony.» **Palabras clave:** armonía · círculo · onda · aurora · noche · precisión · flujo.
- **Símbolo (§1.1):** un círculo de **12 segmentos** de arco (la rueda armónica) con los colores de la rueda en degradado continuo y, en el centro, una **onda sinusoidal** blanca que lo cruza horizontalmente. A 16 px (favicon, bandeja) se simplifica a anillo + onda. Implementado en `app/src/components/brand/`.
- **Logotipo:** símbolo + «Tonalia» en la fuente display (Bricolage Grotesque), interletrado −1 %. El icono de app sale de `app/src-tauri/icons/source.svg` (`icon.icns` para macOS, `icon.ico` para Windows). Las versiones monocromas blanca y negra que pedía el brief todavía no existen.

## Colors

Una noche violeta casi neutra donde el único color saturado es información musical, más un violeta «Aurora» para la interacción y un coral para el modo Pro.

### Primary
- **Violeta Aurora** (`primary`): botones principales, interruptores encendidos, foco y selección. Es algo más profundo que el `#7C6CFF` del brief para que el texto blanco encima cumpla AA 4,5:1. Su hover (`primary-hover`) **oscurece**, no aclara, por la misma razón.
- **Violeta tinta** (`primary-ink`; en claro `primary-ink-light`): el violeta cuando es texto o icono (enlaces, icono activo de la barra lateral).
- **Velo violeta** (`primary-soft`, el violeta original al 16 %): fondo del ítem activo de navegación y de los chips activos; también la zona de soltar al arrastrar.
- **Fila seleccionada** (`row-selected`): el mismo violeta al 26 % en oscuro (al 16 % se perdía sobre las filas) y al 16 % en claro.

### Secondary
- **Coral nocturno** (`accent`; en claro `accent-light`): acciones destacadas del modo Pro, favoritos ★ y el punto coral del conmutador «Pro». Cuando lleva texto blanco encima se usa `accent-fill`.

### Tertiary
- **Degradado aurora** (`linear-gradient(135deg, #7162E8 0%, #A44DD5 50%, #C74A6C 100%)`, token `--gradient-aurora`): logotipo, botón «Probar mashup / Probar mezcla», halo de bienvenida, superposición de arrastre y barras de progreso globales. Sus extremos son las variantes AA del violeta y el coral.

### Neutral
- **Noche de cabina** (`bg`): fondo de la ventana; también el carril de los selectores segmentados.
- **Panel** (`surface-1`): barra lateral, paneles deslizantes y modales.
- **Tarjeta** (`surface-2`): tarjetas, tabla, decks; hover de los ítems de navegación.
- **Control** (`surface-3`): botones secundarios, campos, chips neutros y opción activa del segmentado.
- **Filo** (`border`) y **Filo marcado** (`border-strong`): separadores de 1 px; el marcado para el hover de los controles y los divisores de sección.
- **Tinta** (`text`), **Tinta media** (`text-2`) y **Tinta baja** (`text-3`): texto principal, secundario y ayudas o metadatos. `text-3` se aclaró respecto al brief (`#6F6D88`) para llegar a AA.
- **Modo claro:** los mismos papeles con los valores `*-light` (fondo `#F7F6FB`, superficies blancas y lavanda).

### Estado (§2.2)
- **Éxito** (`success`), **Aviso** (`warning`), **Peligro** (`danger`) e **Info** (`info`): análisis completo y transición buena; confianza baja y transición regular; errores, transición mala y clipping; avisos neutros. En modo claro se usan las variantes `*-light`, oscurecidas para AA. Un botón de peligro con texto blanco usa `danger-fill`.

### Decks del modo Pro (§2.2)
- **Deck A cian** (`deck-a`) y **Deck B coral** (`deck-b`): todo lo que pertenece a un deck (borde superior de 2 px, cabezal, forma de onda superpuesta, crossfader, borde de su carátula en favoritos) usa su color.

### Rueda armónica (§2.3)
Cada número de la rueda tiene un tono; las **menores (A)** usan la variante profunda y las **mayores (B)** la clara (`key-1a` … `key-12b`). Los vecinos de la rueda son colores vecinos.

| Nº | A (menor) | B (mayor) | Clásica A / B |
|---|---|---|---|
| 1 | `key-1a` | `key-1b` | A♭m / B |
| 2 | `key-2a` | `key-2b` | E♭m / F♯ |
| 3 | `key-3a` | `key-3b` | B♭m / D♭ |
| 4 | `key-4a` | `key-4b` | Fm / A♭ |
| 5 | `key-5a` | `key-5b` | Cm / E♭ |
| 6 | `key-6a` | `key-6b` | Gm / B♭ |
| 7 | `key-7a` | `key-7b` | Dm / F |
| 8 | `key-8a` | `key-8b` | Am / C |
| 9 | `key-9a` | `key-9b` | Em / G |
| 10 | `key-10a` | `key-10b` | Bm / D |
| 11 | `key-11a` | `key-11b` | F♯m / A |
| 12 | `key-12a` | `key-12b` | D♭m / E |

El texto sobre los segmentos de la rueda usa `on-key`, igual en ambos temas.

### Energía 1–10 (§2.4)
De fría a caliente, `energy-1` (cian) → `energy-10` (rosa encendido). Solo para el medidor de energía, la curva de energía y la escala de fondo de los sliders y del editor de curva.

### Cues y secciones (§2.5)

| Cue | Sección típica | Token |
|---|---|---|
| 1 | Intro / primer beat | `cue-1` |
| 2 | Build | `cue-2` |
| 3 | Drop | `cue-3` |
| 4 | Breakdown | `cue-4` |
| 5 | 2.º build | `cue-5` |
| 6 | 2.º drop | `cue-6` |
| 7 | Puente / voz | `cue-7` |
| 8 | Outro | `cue-8` |

La paleta de cues es editable por el usuario en Ajustes; estos son los valores por defecto. Los segmentos en la forma de onda son una franja de 4 px bajo la onda con el color de su sección al 70 %. Encima van los nombres de sección; si una sección es más estrecha que su nombre (en los decks), se abrevia («Brk», «Int») y, si ni así cabe, queda solo la franja.

### Stems (§2.6)
Voz `stem-vocals` · Batería `stem-drums` · Bajo `stem-bass` · Otros/melodía `stem-other` · Instrumental (suma) `stem-instrumental`. Al elegir una stem en un deck, su forma de onda se recolorea con ese color.

### Forma de onda (§2.7)
Tres bandas apiladas al estilo RGB de las cabinas: graves `wave-low`, medios `wave-mid`, agudos `wave-high` (en claro, las variantes `*-light`; los agudos en claro son un gris lavanda y no casi negro, que pesaba como una barra). La parte ya reproducida se atenúa al 45 %. La curva de energía superpuesta es una línea de 1,5 px con el degradado de la escala de energía y relleno inferior al 8 %.

### Named Rules
**The Música Primero Rule.** El color saturado es información musical. La interfaz (botones, navegación, paneles) vive en neutros y violeta; si un elemento de interfaz «compite» con un chip de tonalidad o un medidor, está mal.

**The Aurora Rule.** El degradado aurora aparece como mucho en uno o dos sitios por pantalla. Su rareza es el punto.

**The Solo Tokens Rule.** Ningún componente usa un color suelto: todo sale de `tokens.css` a través de los nombres de Tailwind. Las mezclas se hacen con `color-mix()` sobre tokens.

**The AA Rule.** Todo texto cumple WCAG AA 4,5:1 en los dos temas; lo comprueba `styles/contrast.test.ts`. Un color musical (deck, cue, sección, stem) usado como texto pasa por `inkOf` (`lib/keyStyle.ts`), la misma mezcla que el texto de los chips de tonalidad: con blanco en oscuro y con negro en claro. Cuando un valor del brief no llegaba, se oscureció o aclaró el token (nunca se bajó el listón).

## Typography

**Display Font:** Bricolage Grotesque (variable, con tamaño óptico; con system-ui)
**Body Font:** Instrument Sans (variable; con system-ui)
**Label/Mono Font:** Martian Mono (variable, al 87,5 % de ancho; con ui-monospace)

**Character:** Bricolage Grotesque pone la voz cálida y con carácter en los títulos: sus remates de tinta y su tamaño óptico la alejan de la grotesca genérica. Instrument Sans es la interfaz: precisa, compacta y legible a 13 px en tablas densas. Martian Mono, estrechada al 87,5 % y con el cero tachado, convierte tonalidades, BPM y tiempos en la pantalla de un equipo de cabina. Las tres son OFL y van empaquetadas en la app (`@fontsource-variable`), sin cargarse de internet. Sustituyeron a Inter, Space Grotesk y JetBrains Mono el 2026-10-12 para que la tipografía no fuera genérica.

### Hierarchy
- **Display** (600, 32 px, 40 px): bienvenida y títulos grandes.
- **Headline** (600, 22 px, 28 px): títulos de pantalla y título del tema en el detalle.
- **Title** (600, 15 px, 22 px; Instrument Sans): títulos de sección y de tarjeta.
- **Body** (400, 13 px, 20 px): texto corrido, descripciones y guías.
- **Control** (400–500, 13 px, 18 px): tabla, botones y campos.
- **Label** (600, 11 px, 16 px, +4 % de interletrado, MAYÚSCULAS): encabezados de la barra lateral y etiquetas pequeñas.
- **Data** (Martian Mono 450 al 87,5 % de ancho, 13 px, 18 px, cifras tabulares y cero tachado): tonalidad, BPM, tiempos, energía y contadores.
- **Data grande** (Martian Mono 600, 28 px, 32 px): BPM y tonalidad en los decks y en la cabecera del detalle.

### Named Rules
**The Cifra Quieta Rule.** Todo número que pueda cambiar o alinearse en columna va en mono con cifras tabulares, para que no «baile». La mono es solo para datos y medidas: nunca para frases (un recuento como «10 temas» o un «Se elegirá al exportar» van en Instrument Sans).

**The Formato Local Rule.** En texto, números y fechas en formato del idioma (1.204 · 124,00); en la tabla y los decks el BPM usa punto decimal por convención DJ (`124.00`).

## Layout

- **Ventana:** mínima 1200 × 760; diseñada a 1440 × 900. Barra de título nativa integrada (semáforo de macOS a la izquierda, dentro de la barra lateral; en Windows, botones a la derecha).
- **Ventana estrecha** (de 1200 a 1440 px): nada se parte en dos líneas y el título del tema conserva su sitio.
  - **Tabla:** el título nunca baja de 240 px; para lograrlo se apartan columnas en este orden: Añadido → Duración → Género (`features/library/columns.ts`).
  - **Cabecera de la biblioteca:** por debajo de 1280 px, Tags y «Editar playlist inteligente» quedan solo con icono, Filtros con filtros activos queda en icono + contador, los controles se separan 8 px y el buscador mide 180 px; si aun así el título no cabe, el buscador cede primero (hasta 120 px) y solo después se corta el título.
  - **Constructor:** con la columna del set por debajo de 704 px, las acciones de cada tema (subir, bajar, reemplazar, quitar) flotan sobre el final de la fila al pasar el ratón o con el foco.
  - **Detalle:** cuando la cabecera grande sale de la vista, la barra superior muestra play, título, tonalidad, BPM y tiempo.
- **Ventana baja** (hasta 880 px de alto, variante `short:` de `styles/index.css`): la ventana nunca se desplaza entera.
  - **Modo Pro:** los decks se compactan (relleno de 12 px, carátula de 44 px, forma de onda de 72 px) y el volumen va en la cabecera del deck, junto a su nombre, para que los cue pads quepan en una fila. La lista de ideas conserva siempre al menos 3 filas: si no cabe todo (por ejemplo, con el Filtro de ideas abierto), es la zona de los decks la que se desplaza, con una sombra que lo indica. Los motivos y las acciones (Guardar favorito, Exportar stems, Añadir a playlist, Mover B → A) quedan fuera de esa zona, siempre a la vista; los motivos pasan a una segunda línea en vez de cortarse.
  - **Atajos de Pro** (mano izquierda para el deck A, derecha para el B): Q / W bajan y suben un semitono el deck A, O / P el B, E / I ponen o quitan un loop de 4 compases, ⇧← / ⇧→ mueven el crossfader en décimas y M hace «Mover B → A» en DJ Mix; además de Espacio (probar / parar) y ← → (ideas). Están en el diálogo «Atajos de teclado».
- Al entrar en Pro se pausa el tema de la biblioteca (allí no hay reproductor inferior que lo pare); sigue cargado al volver.
- **Estructura general (modo estándar):**

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

- **Reproductor inferior** (72 px, `surface-1`, `features/player/PlayerBar.tsx`): aparece al reproducir un tema desde la tabla (botón ▶ en la columna «#» al pasar el ratón, o Espacio en la fila enfocada) y se queda mientras se navega. Lleva carátula y título (clic = abrir el detalle), cue anterior · play/pausa · cue siguiente, la forma de onda mini (40 px, sin nombres de sección pero con su franja de color y los cues; clic = saltar) con el tiempo, y tonalidad, BPM y energía. Es el mismo reproductor que el del detalle: abrir el detalle del tema que suena no lo corta. Se oculta y se pausa en la sección Pro (Pro, Favoritos y Constructor: los decks y los favoritos suenan por su cuenta, y lo que quedara sonando no se podría parar) y en el detalle del propio tema; en el detalle de otro tema se reduce a una franja de 40 px «Sonando: título · artista» con pausa, «Ir al tema» y cerrar, para que en pantalla haya un solo transporte. La fila que suena lleva la barra violeta de 2 px y el ecualizador animado (§5.5).
- **Barra lateral** de 240 px sobre `surface-1` (en ventana baja, una sombra marca lo que queda debajo y el elemento activo se desplaza a la vista; Exportar, Guías y Ajustes no cambian el interruptor Biblioteca | Pro); **panel deslizante** lateral de 420 px; **popover** de filtros de 380 px; **constructor de sets** con configuración de 360 px a la izquierda.
- **Escala de espacios:** 4 · 8 · 12 · 16 · 24 · 32 · 48.
- **Densidad de tabla:** filas de 36 px (cómoda, con el artista debajo del título) o 28 px (compacta), conmutables en la cabecera. Tabla virtualizada para 100 000 filas.
- **Movimiento:** 150 ms *ease-out* en hovers (`--duration-hover`), 220 ms en paneles deslizantes (`--duration-panel`), curva `cubic-bezier(0.16, 1, 0.3, 1)`, sin rebotes. El cabezal y los medidores se mueven en tiempo real. Con «reducir movimiento», todas las duraciones pasan a 0.
- **Micro-interacciones** (todas en `styles/index.css`):
  - **Pulsar:** todo botón habilitado se hunde 1 px mientras se mantiene pulsado, como una tecla de un equipo.
  - **Colores:** los botones y los campos funden color, fondo y borde en 150 ms.
  - **Selectores segmentados:** la pastilla `surface-3` se desliza hasta la opción elegida en 220 ms (`components/SegmentThumb.tsx`).
  - **Modal:** el velo aparece en 150 ms y el diálogo se asienta desde el 98 % y 6 px más abajo en 220 ms.
  - **Popover y menús:** caen 4 px desde su ancla en 150 ms.
  - **Toasts:** entran 16 px desde el borde de la pantalla en 220 ms.
  - **Superposición de arrastre:** aparece en 150 ms y su icono baja 4 px.
  - **Estrellas:** al valorar, las que se encienden laten una tras otra (escala 1,28 y 30 ms entre estrellas); también late la estrella de «Guardar favorito» al guardar. Una valoración que llega de la base de datos no se anima.
  - **No se anima** la entrada de las pantallas ni de las filas: es una herramienta de trabajo y nada debe hacer esperar.

**The Instrumento Denso Rule.** Se diseña para pantallas de escritorio y sesiones largas: densidad antes que aire. Los espacios grandes (32–48 px) solo separan zonas, nunca rellenan.

## Elevation & Depth

En oscuro el sistema es **plano por capas**: la profundidad se expresa con el escalón de superficie (`bg` → `surface-3`) y bordes de 1 px, sin sombras en reposo (`--shadow-card: none`). Solo lo que flota sobre la ventana (modales, menús, popovers, el botón aurora) lleva sombra. En claro, las tarjetas reciben una sombra suave para no perderse sobre el blanco.

### Shadow Vocabulary
- **Flotante oscuro** (`box-shadow: 0 12px 40px rgba(0,0,0,.45)`): modales, menús contextuales, popovers y el botón «Probar mashup».
- **Flotante claro** (`box-shadow: 0 1px 2px rgba(20,18,40,.06), 0 8px 24px rgba(20,18,40,.08)`): lo mismo en modo claro, y también las tarjetas.

**The Capas No Sombras Rule.** En oscuro, si algo necesita separarse, sube un escalón de superficie o gana un borde; la sombra se reserva para lo que flota.

## Shapes

Esquinas suaves y contenidas, con una sola forma redonda de verdad: la píldora para los datos musicales y las acciones de marca.

- **6 px** (`rounded.sm`): botones, campos, ítems de navegación, chips cuadrados.
- **10 px** (`rounded.md`): tarjetas, paneles y tarjetas de opción en Ajustes.
- **14 px** (`rounded.lg`): modales y la gran zona de arrastre de bienvenida (borde discontinuo de 2 px).
- **999 px** (`rounded.pill`): chips de tonalidad, interruptores, el botón aurora y contadores.
- Los selectores segmentados usan un carril de 7 px con opciones de 5 px, para que el radio interior case con el exterior.
- Iconos **Lucide** de trazo 1,5 px: 16 px en controles y 20 px en la barra lateral.
- La rueda armónica (dos anillos de 12 segmentos) y la onda sinusoidal son la geometría de la marca: aparecen en el logotipo y en las ilustraciones lineales de los estados vacíos.

## Components

Botones y controles sobrios y táctiles, con la marca en los detalles; los componentes de datos musicales son los protagonistas. Números de la biblioteca de componentes del brief entre paréntesis.

### Buttons (§5.1)
- **Shape:** esquinas suaves (6 px), 32 px de alto.
- **Primary:** violeta Aurora con texto blanco semibold, 12–16 px de relleno horizontal; el hover oscurece a `primary-hover`; deshabilitado al 40–50 % de opacidad.
- **Secondary:** `surface-3` con borde de 1 px `border` y texto `text`; en hover el borde pasa a `border-strong`.
- **Icon:** cuadrado de 32 px con el mismo tratamiento que el secundario (28 px en zonas compactas).
- **Ghost:** solo texto `text-2`/`text-3`, que sube a `text` en hover.
- **Danger:** `danger-fill` con texto blanco.
- **Aurora:** solo «Probar mashup» y «Probar mezcla»: píldora de 36 px con el degradado aurora, texto blanco en mayúsculas con +4 % de interletrado, icono ▶ y sombra flotante; hover al 90 % de opacidad.
- **Focus:** anillo de 2 px `primary` con 2 px de separación en todo elemento enfocable.

### Chips (§5.2–5.4)
- **Chip de tonalidad:** píldora de 22 px, fondo = color de la tonalidad al 20 %, borde de 1 px al 60 %, texto en mono semibold mezclado con blanco (oscuro) o negro (claro) lo justo para AA. **Nunca solo color:** el texto de la tonalidad siempre está visible.
  - **Baja confianza:** borde discontinuo + icono ⚠ a la derecha.
  - **Editado a mano:** icono de lápiz.
  - Los dos estados son del chip, no de una pantalla: salen en la tabla, el detalle, el reproductor, el selector y los decks de Pro, la lista de ideas, los favoritos y el resumen de la cola (`keyStates` en `components/KeyChip.tsx`).
  - **Desplazado:** `8A → 10A` con flecha y etiqueta «+2 st» (`components/ShiftedKey.tsx`: el mismo en los decks, la lista de ideas y los favoritos).
- **Medidor de energía:** 10 barritas verticales (3 × 12 px con 2 px de separación en tabla; 6 × 24 px en grande); las encendidas toman el color de su nivel y las apagadas son un velo de `text-3` al 28 % (con `surface-3` desaparecían sobre una fila seleccionada); a la derecha, el número en mono.
- **Signos musicales:** la interfaz escribe ♯ y ♭ (F♯m, G♭m; `displayKey` en `lib/keys.ts`); los tags y el motor siguen en ASCII (F#m, Gbm). Martian Mono no trae esos dos signos, que salen de la fuente del sistema.
- **Píldora BPM:** mono (`124.00`), con variante «×2 / ÷2».
- **Filtros activos:** chips eliminables («BPM 122–128 ✕»).

### Cards / Containers
- **Corner Style:** 10 px.
- **Background:** `surface-2` (tarjetas, decks, tabla) sobre `surface-1` o `bg`.
- **Shadow Strategy:** ninguna en oscuro, flotante clara en claro (ver Elevation & Depth).
- **Border:** 1 px `border`. Los decks llevan una franja de 2 px en su color a lo largo del borde superior, metida 16 px por cada lado para no chocar con las esquinas redondeadas.

### Inputs / Fields (§5.8)
- **Style:** 32 px de alto, `surface-3`, borde de 1 px `border`, 6 px de radio; los campos numéricos en mono.
- **Focus:** el borde pasa a `primary`.
- **Error / Disabled:** borde `danger` con `aria-invalid`; deshabilitado al 40 %.
- **Búsqueda** con el atajo `⌘F` visible; **slider de rango** con dos asas (BPM, energía con la escala de color de fondo; la energía está implementada en `components/EnergyRange.tsx`, con los niveles dentro del rango encendidos y el resto al 25 %, y 1 y 10 significan «sin límite». El BPM sigue en dos campos numéricos porque pide precisión decimal); **interruptor** de 36 × 20 px (violeta encendido, `surface-3` apagado, pomo blanco de 16 px); **selector segmentado** sobre carril `bg` con la opción activa en `surface-3`; **stepper de semitonos** (− `+2` +); **selector de emoji**.

### Navigation (§5.7)
- **Barra lateral** de 240 px en `surface-1`: logo arriba; conmutador grande **Biblioteca | Pro** (segmentado, Pro con un punto coral); secciones con título en `label` mayúsculas `text-3`; ítems de 30 px con icono de 20 px o **emoji**, contador en mono a la derecha; carpetas desplegables; playlists inteligentes con icono de varita.
- **Estados:** reposo `text-2`; hover `surface-2` + `text`; activo `primary-soft` + `text`, con el icono en `primary-ink`.
- Abajo: Guías, Ajustes y el estado del motor (punto verde «Motor listo»).

### Fila de tabla y estado de análisis (§5.5–5.6)
- **Fila:** normal, hover, seleccionada (`row-selected`), reproduciéndose (barra de 2 px violeta a la izquierda + icono ecualizador animado) y arrastrándose.
- **Estado de análisis:** pendiente (círculo vacío), analizando (anillo de progreso con %), listo (✓ `success`), listo con un problema de calidad (medidor ámbar, el mismo icono que «Revisar calidad»; el ⚠ queda para la tonalidad de baja confianza y los errores), error (⚠ `danger` con el motivo debajo del título en todas las listas, no solo en Analizar; el motivo abre un popover con el texto entero y «Reintentar»).

### Forma de onda (§5.9)
Tres tamaños: miniatura de tabla (opcional, 120 × 20), detalle (ancho completo × 120) y deck (ancho del deck × 96), con cabezal, cues numerados en banderitas de su color y la región de loop sombreada.

### Cue pads (§5.10)
8 pads en 2 × 4 o 1 × 8. Cada pad asignado lleva la misma banderita numerada y coloreada que su marcador en la forma de onda, el tiempo en mono y el nombre de la sección; el vacío es un hueco de borde discontinuo. Nunca una franja de color en el lateral.

### Rueda armónica (§5.11, componente estrella)
Dos anillos concéntricos de 12 segmentos (exterior = mayores B, interior = menores A) con sus colores y el número/letra en cada segmento (nombre clásico opcional). Estados: tonalidad actual (segmento pleno + halo + contorno de 2,5 px en `text`, para que una relativa clara como 8B no la supere), compatibles (pleno al 70 % con etiqueta de relación: «misma», «±1», «relativa», «+2 energía»; los movimientos débiles, diagonal, +2 energía y +7, al 38 % (al 50 % el dorado del 3A aún destacaba), para que un tono claro como 3A o 9B no brille más que la tonalidad actual) y resto atenuado al 25 %. En claro los pasteles quedan muy juntos, así que los valores cambian por tema (tokens `--wheel-*`): compatibles al 80 %, débiles al 45 % y resto al 12 %. En los filtros los movimientos débiles se atenúan igual (si todos los movimientos desde las tonalidades elegidas son débiles); sin nada elegido, la rueda reposa al 55 %. Tamaños 280 px (detalle) y 120 px (mini en deck). Clic en una tonalidad = filtrar compatibles; navegable con teclado.

### Piano (§5.12)
Dos octavas; teclas blancas `piano-white` y negras `piano-black` en ambos modos; las notas de la escala con un punto del color de la tonalidad (la tónica, el más grande); tecla pulsada iluminada en `primary`; etiquetas del teclado del ordenador (A, W, S, E…) en mono pequeño. Debajo, «Octava del teclado» (Z · C3 / X · C4) dice en qué octava están las letras y la cambia también con el ratón.

### Tarjeta de idea y barra de transición (§5.13–5.14)
- **Tarjeta de idea** (modo Pro): puntuación grande (p. ej. **92**) en anillo de progreso, motivo en chips («Misma tonalidad», «Voz A + Instr. B», «+1 st en B»), flechas ◀ ▶ y «3 / 48». Si el DJ cambia a mano el tono de B, la tonalidad de esa fila de la lista sigue al deck («8A → 3A +1 st») y la puntuación se recalcula con los pesos que envía el motor (solo cambian la parte de tonalidad y el coste por semitono) y se lee «~~100~~ → 65», en el anillo y en la fila de la lista de ideas, cuyos motivos también siguen el cambio. La relación +7 se llama «Medio tono arriba (+7 en la rueda)», para no confundirla con el chip del cambio de tono. Un «?» tras los motivos abre la guía de Mezcla armónica (`features/guides/GuideLink.tsx`). La relación de tonalidad y el cambio de tono de B son un solo chip («Relativa · −1 st en B»), y en Mashup la franja de motivos reserva dos filas, para que cambiar el tono no mueva los decks ni la lista. El motivo de stems («Instr. A + Voz B») es un botón: pone esas stems en los dos decks y queda marcado (✓); pulsado otra vez, vuelve al tema completo.
- **Barra de transición** (constructor de sets): conector entre dos temas con puntuación y color verde/ámbar/rojo **más** icono (✓, ~, ✕), y los datos tonalidad → tonalidad, ΔBPM y Δenergía. Un choque en un set generado que era inevitable se marca en su barra con la ✕ y la palabra «Inevitable» en `text-3` (sin píldora roja), y el porqué se dice una sola vez encima del set, en el aviso «Lo que limita este set», que reúne también el set corto («El set dura 44 min de los 60 pedidos…») y lleva el siguiente paso como botones: «Analizar N pendientes» (si el origen tiene temas sin analizar) y «Cambiar origen», más un «?» a la guía. Uno evitable dice cuántos temas que quedaron fuera encajarían con los dos vecinos («… prueba Reemplazar»).

### Superposiciones y estados (§5.15–5.16)
- **Modal:** `surface-1`, 14 px, borde de 1 px y sombra flotante sobre un velo de `bg` al 72 %; Escape o clic fuera cierran; el foco queda atrapado dentro y vuelve al cerrar.
- **Panel deslizante** de 420 px que entra en 220 ms; **toasts**, **menús contextuales**, **tooltips**; **barra de progreso global** con el degradado aurora.
- **Estados vacíos** con una ilustración lineal sencilla de la rueda + onda.
- **Carátula generada** (`components/Artwork.tsx`): un tema sin carátula (o cuya imagen no carga) muestra una mini rueda armónica (anillo exterior mayores, interior menores) con el segmento de su tonalidad encendido y la onda de la marca encima, sobre un fondo plano teñido con el color de esa tonalidad; sin tonalidad, en neutros. Por debajo de 40 px la rueda se reduce a un anillo. Se usa en la tabla, el detalle, el reproductor, los decks, los favoritos y el constructor.
- **Tabla «antes → después»** (vista previa de tags y limpieza): valor antiguo tachado en `text-3`, nuevo en `text` y solo la parte que cambia resaltada con `success` al 16 % (`features/tags/textDiff.ts`: lo que el valor nuevo conserva del principio y del final del antiguo queda sin resaltar). Si el valor nuevo es solo un trozo del antiguo (una limpieza que borra), no se resalta nada nuevo: en el valor antiguo, lo que se va lleva un velo `danger` al 15 %.

## Do's and Don'ts

### Do:
- **Do** usar solo tokens (`tokens.css` / nombres de Tailwind) y `color-mix()` sobre tokens para las transparencias.
- **Do** escribir siempre la tonalidad, el número de energía y el icono de la transición: la información nunca va solo por color (§7).
- **Do** poner todo dato musical en Martian Mono con cifras tabulares, y nada más que datos.
- **Do** separar superficies en oscuro con el escalón de superficie y bordes de 1 px.
- **Do** mantener AA 4,5:1 en los dos temas (también los chips de tonalidad en claro) y comprobarlo con `styles/contrast.test.ts`.
- **Do** dar foco visible a todo (anillo de 2 px `primary` + 2 px de separación) y un área de clic ≥ 24 px.
- **Do** truncar los títulos largos con elipsis y tooltip.
- **Do** usar el color de su deck para todo lo que pertenece a Deck A (cian) o Deck B (coral).
- **Do** respetar «reducir movimiento»: sin animaciones ni transiciones.

### Don't:
- **Don't** usar colores sueltos en componentes.
- **Don't** usar el degradado aurora más de una o dos veces por pantalla, ni como fondo de interfaz general.
- **Don't** usar la palabra «Camelot»: la notación es «Alfanumérica» y la rueda, «Rueda armónica».
- **Don't** parecerse a otras aplicaciones para DJs: ni sus logos ni sus colores corporativos ni su disposición. Los programas de destino se nombran en texto con iconos genéricos de disco o archivo.
- **Don't** caer en estética «gamer»: neones agresivos, biseles, brillos exteriores o fuentes futuristas.
- **Don't** usar rebotes ni elasticidad en el movimiento.
- **Don't** poner sombras en reposo en el modo oscuro.
- **Don't** marcar tarjetas, pads o avisos con una franja de color lateral de más de 1 px: el color va en una banderita, un punto o un chip.
- **Don't** usar negro puro ni gris puro como fondo: la noche es ligeramente violeta.

## Pantallas (§6)

Referencia de cada pantalla, tal como se encargó en el brief de diseño. Las marcadas con ☀︎ existen también en modo claro. Los textos de ejemplo están en español; la app los toma de i18n.

**Barra lateral (240 px, `surface-1`):** logo arriba; conmutador grande **Biblioteca | Pro** (segmentado, Pro con un punto coral); secciones:
- BIBLIOTECA: 🎵 Todos los temas (12 480), ⏳ Analizar (cola, con contador), ✨ Recién añadidos, ⚠️ Revisar calidad (37).
- PRO: ⭐ Favoritos (24; mashups y mezclas de DJ Mix, así que no se llama «Mashups favoritos»), 🧭 Constructor de sets. **Implementado** justo después de BIBLIOTECA (no al final): las playlists crecen sin límite y en una ventana baja lo empujaban fuera de la vista.
- PLAYLISTS: carpetas y playlists anidadas con emoji (ver datos de ejemplo), botón "+".
- INTELIGENTES: 🔮 "Compatibles con 8A", 🔥 "Energía 8+", 🕓 "Sin analizar".
- Abajo: Guías, Ajustes, estado del motor (punto verde "Motor listo").

### 6.1 Bienvenida / primera ejecución ☀︎
Pantalla limpia sobre `bg` con un gran halo aurora difuminado detrás del símbolo animado (la rueda gira despacio). Título "Bienvenido a Tonalia", lema, y una **zona de arrastre** enorme (borde discontinuo de 2 px, radio 14) "Arrastra aquí tu carpeta de música" + botón "Elegir carpeta…". Debajo, tres pasos ilustrados: *Analiza → Organiza → Mezcla en armonía*. Pie: "Gratis y de código abierto · Todo se procesa en tu ordenador".

### 6.2 Biblioteca (pantalla principal) ☀︎
- Barra superior: título "Todos los temas" + recuento; búsqueda; botón "Filtros" (con contador de filtros activos); selector de notación con las cuatro de Ajustes, mostradas sobre F♯m para que sostenidos y bemoles se distingan (11A / 4m / F♯m / G♭m); conmutador de densidad; botón primario "Analizar".
- Fila de **filtros activos** como chips eliminables: "Tonalidad: compatible con 8A ✕", "BPM 122–128 ✕", "Energía ≥ 6 ✕".
- **Tabla** con columnas: ▶ (al hover), carátula 28 px, Título (+ artista debajo en `text-2` en modo cómodo), Tonalidad (chip), BPM, Energía (medidor), Cues (número + mini puntos de colores: uno por cue, en su color, `cueDots` del motor), Género, Duración, Estado, Añadido. Cabeceras ordenables con flecha.
- Mostrar: 1 fila reproduciéndose, 1 seleccionada, 1 analizando al 64 %, 1 con baja confianza, 1 con error.
- **Barra de selección** (`features/library/SelectionBar.tsx`, flotando sobre la tabla y no sobre el resumen de la cola; con pocas filas, justo debajo de la última y no al pie de la ventana): las mismas acciones para uno o varios temas — Tags…, Reanalizar, Añadir a playlist, Crear set y «Más acciones» (Editar info, Abrir en Pro, Preparar stems, Exportar stems…, Quitar de la playlist). Lo que no aplica se desactiva con el motivo, no desaparece; en «Más acciones» el motivo se lee debajo de la opción, no solo en el tooltip.
- La selección pertenece a su lista: al pasar a otra (otra playlist, Analizar, Revisar calidad) se limpia; al volver del detalle, Tags o Exportar a la misma lista se conserva.
- **Revisar calidad** cambia Cues y Estado por una columna «Problema» con chips ámbar que lo dicen escrito («Bitrate bajo · 128 kbps», «Clipping», «Muy bajo de volumen»); la descripción de cada chip dice qué hacer («… busca el tema en 320 kbps o sin pérdida»). Es una lista de tareas: Tonalia no puede arreglar el audio (lo dice una línea bajo la cabecera), así que cada fila acaba en ✓ «Marcar como revisado» (también en «Más acciones» para varios), con un aviso que lo deshace. Un tema revisado sale de la lista y se lee como analizado sin más, hasta que aparece un problema que no estaba (motor: `quality.review`, columna `analysis.quality_reviewed`).
- Reproductor inferior activo.

### 6.3 Biblioteca con filtros avanzados abiertos
Popover anclado a "Filtros" (380 px): mini rueda armónica clicable para elegir tonalidad + interruptor "Incluir compatibles"; slider BPM con casilla "Incluir ×2 / ÷2"; slider de energía 1–10 con la escala de color de fondo; selector de géneros (chips multiselección); playlist; estado. Botones "Limpiar" y "Aplicar".
- **Implementado:** en ventana baja la rueda mide 184 px para que Estado y Calidad quepan; si aun así queda contenido por debajo, una sombra sobre el borde (`components/ScrollArea.tsx`, token `scroll-shade`) lo indica y desaparece al llegar al final.

### 6.4 Análisis en curso
La vista "Analizar": cabecera con barra de progreso global (degradado aurora), "Analizando 342 de 1.200 · quedan ~6 min", botones Pausar / Cancelar, y ajuste "Procesos en paralelo: 7". Lista de temas con su fase actual (Decodificando → Tonalidad → Tempo → Energía → Estructura → Forma de onda) como mini *stepper* de puntos. Panel lateral derecho con un **resumen en vivo**: distribución de tonalidades (mini rueda tipo mapa de calor) y distribución de energía (histograma con la escala de color).
- **Implementado** (2026-10-12): «Analizar» en la barra lateral (icono de reloj de arena, contador de temas pendientes, analizándose o con error) abre la tabla con solo esos temas y, en la cabecera, «Analizar N pendientes» (primario) y «Reintentar N con error» (solo icono por debajo de 1280 px), desactivados mientras hay un análisis en marcha. Durante el análisis, bajo la cabecera: «Analizando 3 de 12 · quedan ~6 min» (el tiempo sale del ritmo hasta ahora), la barra aurora y «Cancelar» (`features/analysis/QueueProgress.tsx`). La tabla de la cola cambia tonalidad, BPM, energía y cues (vacíos en temas sin analizar) por un Estado ancho de 184 px (el motivo de un error, subrayado con puntos bajo el título, abre en un popover el texto entero) con el *stepper* de 7 puntos (los hechos encendidos, el actual latiendo) y el nombre de la fase (`StageSteps.tsx`). A la derecha, un panel de 280 px con el resumen en vivo de la biblioteca (`QueueSummary.tsx`, método del motor `library.stats`): «8 de 10 temas analizados», la rueda como mapa de calor con el nombre de cada tonalidad y, debajo, su número de temas y las tres tonalidades más frecuentes, el histograma de energía en sus colores con el número de temas sobre cada barra (las tonalidades más frecuentes, como chips seguidos de su número) y «Procesos en paralelo». No hay «Pausar»: el motor no lo admite y cancelar deja el resto pendiente, así que «Analizar N pendientes» sigue donde se paró. Sin nada pendiente, ese botón desaparece (no queda «Analizar 0 pendientes» apagado). Al terminar, en lugar de la barra queda una línea fija, «✓ Análisis completo · 2 temas analizados · 1 con error», con «Ver en la biblioteca» y cerrar, hasta el siguiente análisis.

### 6.5 Detalle del tema ☀︎
Abre al hacer doble clic (pantalla completa del área de contenido con botón "← Volver").
- Cabecera: carátula 120 px, título (22 px), artista, álbum · año · sello; a la derecha, tres **datos grandes**: Tonalidad (chip grande + "Confianza 92 %" + alternativas "9A, 8B" pequeñas), BPM `124.00`, Energía `7` con medidor grande. Si hay tonalidad secundaria: "Cambia a 9A en 3:12".
- **Forma de onda de detalle** a todo el ancho con: segmentos coloreados (Intro, Build, Drop, Breakdown, Drop 2, Outro) etiquetados encima, curva de energía superpuesta, 8 banderitas de cue numeradas, cabezal de reproducción y regla de compases (1, 17, 33…) debajo.
- Fila de **cue pads** (1 × 8) con botón "Fijar cue aquí" (Snap Cue), que dice dónde caerá («#6 · 1:18»: la primera ranura libre y el tiempo ajustado al beat) o, si ya hay un cue en ese tiempo, «Ya está el cue 1» y se desactiva; y menú "Restablecer automáticos". Borrar un cue deja un aviso con «Deshacer».
- Abajo, en dos columnas (Stems y Calidad van bajo el piano, junto a la rueda, que es más alta): **Rueda armónica** (280 px) con la tonalidad y sus compatibles, y **Piano** con los botones "Tocar acorde" y "Tocar escala" y el interruptor "Tocar con el tema".
- Panel inferior de calidad: chips "320 kbps ✓", "−8,2 LUFS ✓", "Sin clipping ✓" o avisos en ámbar.
- Botón "Editar info" (abre 6.6) y "Abrir en Pro" (coral).

### 6.6 Panel "Info del tema" (deslizante, 420 px)
Formulario: Título, Artista, Álbum, Género (autocompletar), Año, Tonalidad (selector con la rueda), BPM (con botones ×2 / ÷2 y "tap tempo"), Energía (1–10 seleccionable con el medidor), Comentario. Indicador "Editado a mano" junto a los campos cambiados. Botones Guardar / Cancelar.

### 6.7 Escritura y limpieza de tags ☀︎
Pantalla en dos pestañas: **Escribir resultados** y **Limpiar tags**.
- Escribir: a la izquierda, opciones (campos a escribir con interruptores; plantilla de comentario con variables como chips arrastrables `{key}` `{energy}` `{bpm}`; posición: delante / detrás / sustituir). A la derecha, **vista previa antes → después** de los temas seleccionados (componente 16). Pie con aviso tranquilizador: "🛟 Se guarda una copia de los tags originales. Puedes deshacerlo." + botón primario "Escribir en 248 temas".
- Limpiar: lista de reglas con interruptores y ejemplo de cada una ("Quitar URLs — *www.promo-site.com* → ∅"), lista editable de frases promocionales y vista previa. «MAYÚSCULAS → Tipo Título» viene apagada (cambiaría nombres estilizados como «SOPHIE» o «DJ»). En «Editar en lote» cada campo muestra un ejemplo y escribir en él lo marca.
- Mostrar también el toast tras escribir: "Tags escritos en 248 temas · Deshacer".
- **Historial** (cuarta pestaña, tras «Editar en lote»; añadida el 2026-10-12): cada lote escrito, del más reciente al más antiguo, con tipo, fecha, número de temas, primeros títulos, campos escritos y **Deshacer** (o «Deshecho el …»). El pie «🛟 … Puedes deshacerlo» enlaza a esta pestaña y el toast lo recuerda. Una franja bajo la cabecera dice a qué temas se aplicará la escritura («1 tema seleccionado: Golden Hour Tide · Cambiar»).

### 6.8 Exportar a software de DJ
Tarjetas en rejilla (Rekordbox, Traktor, Serato, VirtualDJ y, desde la tarea 10.5, Engine DJ) **con iconos genéricos** (no logos oficiales; usar nombre en texto + icono de disco/archivo). Cada tarjeta: qué se exporta (checkboxes: cues, colores, beatgrid, tonalidad, playlists), estado detectado ("Colección encontrada en ~/Documents/Native Instruments…" / "Traktor está abierto — ciérralo para exportar" en ámbar), botones "Simular" y "Exportar". Panel de resultado tras exportar: "1.204 temas · 8.916 cues · 0 errores" con lista desplegable y "Abrir copia de seguridad". Para Rekordbox, un mini paso a paso de 3 pasos de cómo importar el XML.
- **Implementado** (2026-10-12): en vez de la rejilla de 5 tarjetas, una lista de destinos a la izquierda (260 px; cada uno con lo que escribe o lo que encontró: «Crea rekordbox.xml», «Colección encontrada», «Abierto: ciérralo para exportar» en ámbar) y un solo panel a la derecha: descripción, estado, **Qué temas** (Toda la biblioteca · Una playlist · N seleccionados), qué se exporta en tres columnas, destino, «Simular» y «Exportar» (el único botón primario) y, justo debajo, el resultado (resumen en Instrument Sans, no en mono; en una colección existente, también cuántos temas son nuevos y cuántos ya estaban y se actualizan). El paso a paso de Rekordbox va al final, como «Después de exportar». Se recuerda el último destino. El panel llega a 880 px. Una simulación sin destino elegido no enseña la ruta por defecto del motor, sino «Al pulsar Exportar eliges dónde se guarda».

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
- **Filtro de ideas** desplegado como barra: energía, rango BPM, playlists, géneros, interruptor "Permitir cambio de tono (±2)". El botón se ve como Filtros de la biblioteca: velo violeta y contador en píldora cuando acota las ideas (el cambio de tono desactivado cuenta como un filtro) y una flecha que dice si la barra está abierta; «Limpiar» lo devuelve todo, también el cambio de tono.
- Estado de stems: si aún no hay stems, botón "Separar stems" con progreso circular en el propio deck ("Separando voz… 42 %").
- **Implementado:** sin tema en A, Pro abre un buscador de temas analizados (`features/decks/TrackPicker.tsx`) con filas de 48 px separadas por un filo: carátula, título y artista, tonalidad, BPM y medidor de energía, para que la primera elección ya sea informada. «Sin stems: suena el tema completo · Separar stems» flota sobre la esquina inferior derecha de la forma de onda (arriba están las banderitas de los cues), sin añadir una fila que descuadre los decks. El loop lleva además una barra sólida de 4 px en el color del deck a lo largo del borde inferior, para que uno corto sobre el cue 1 no quede tapado. Cambiar el tono de A conserva la idea de B si sigue entre las nuevas. Cambiar entre Mashup y DJ Mix empieza de cero: stems en «Tema», sin loops ni puntos de inicio. La franja del crossfader queda fuera de la zona que se desplaza (el diagrama de DJ Mix nunca se corta) y en Mashup su centro lleva los motivos; en DJ Mix los motivos van en la fila de las acciones. La posición del comentario en Tags se explica con la plantilla en uso («{key} - Energy {energy} | comentario que ya tenía»). La cabecera de la lista de ideas dice solo «6 candidatos» (el tiempo del cálculo, en el tooltip).

### 6.10 Modo Pro — DJ Mix
Misma estructura que 6.9 con el interruptor en **DJ Mix**: Deck A muestra el final del tema con la región de **outro** resaltada; Deck B la entrada con la región de **intro**; entre ambos, un **diagrama de transición** (dos formas de onda alineadas con la zona de crossfade de 32 compases sombreada en degradado cian → coral). Botón aurora "▶ Probar mezcla", botones "Mover B → A" y "+ Añadir a playlist". Indicador de energía de la transición: "E7 → E8 ↑".
- **Implementado** (`features/decks/TransitionLane.tsx`): en DJ Mix, la franja del crossfader lleva a la izquierda el selector 16/32 compases y el crossfader, y en el centro el diagrama: lo que sonará con «Probar mezcla» en un solo reloj (sale del mismo plan que el reproductor), A arriba en cian y B abajo en coral, cada onda encogiendo o creciendo con su ganancia de potencia constante, la zona de crossfade sombreada de cian a coral con sus compases encima, el cabezal mientras suena y «E7 → E8 ↑» a la derecha. En los decks, fuera del outro de A y de la intro de B la forma de onda se atenúa, y la región queda marcada con una línea del color del deck. El crossfader va de cian a coral con un pomo claro, en los dos modos.
- Las acapellas (por título o género) quedan las últimas en las ideas de DJ Mix, con el motivo «Acapella: sin base para mezclar»; en Mashup siguen siendo una gran idea.

### 6.11 Favoritos
Rejilla de tarjetas (3 columnas): cada tarjeta muestra los dos temas (carátulas solapadas, una con borde cian y otra coral), tonalidades con desplazamiento, BPM común, estrellas 0–5 editables, notas, modo (Mashup / DJ Mix), botones ▶, "Abrir en decks" y "Exportar". Barra superior con orden (valoración, fecha) y búsqueda.

### 6.12 Constructor de sets ☀︎
- Izquierda (360 px): configuración — origen (toda la biblioteca, la selección de la biblioteca o una playlist; la barra de selección de la biblioteca tiene «Crear set», que abre el constructor con esos temas), duración objetivo "60 min" o "20 temas", tema inicial opcional, y **editor de curva de energía**: gráfico de 0 a 10 con puntos arrastrables y plantillas (Calentamiento → Pico → Cierre, Plana, Ascenso), con el fondo en la escala de color de energía. Botón primario "Generar set".
- Derecha: **línea de tiempo vertical** del set: cada tema como fila (nº, carátula, título, chip de tonalidad, BPM, energía) unida a la siguiente por la **barra de transición** (componente 14) verde/ámbar/rojo. Encima, una mini gráfica que compara la curva objetivo (discontinua) con la real. Acciones por tema: arrastrar para reordenar, "Reemplazar" (abre alternativas), quitar. Pie: "Media de transición 0,86 · 0 choques de tonalidad · 58 min" + "Guardar como playlist" + "Exportar ▾".
- El cambio de tono (±2) viene permitido, como en el Filtro de ideas de Pro. Si el set tiene choques con el cambio de tono apagado, encima de la lista se ofrece «Permitir cambio de tono (±2) y regenerar»; si «Generar set» da el mismo orden, un aviso lo dice, y si da otro, cuántas posiciones cambian y cómo pasan la media y los choques («Media de transición 0,33 → 0,41 · choques 5 → 3»). El origen empieza en «Toda la biblioteca», así que «Generar set» no llega desactivado (y, si lo está, es un botón neutro, no violeta). La minigráfica marca 2, 4, 6, 8 y 10, como el editor. Si el set queda más corto de lo pedido (menos del 90 % de los minutos o menos temas), un aviso ámbar encima de la lista lo dice con cuántos temas analizados tiene el origen y cuántos faltan por analizar. El origen agrupa «Playlists» e «Inteligentes» y nombra las carpetas («Bolos › Warm-up Ibiza»). El fondo del editor de curva es la escala de energía en diez franjas: un velo suave (al 16 %) y el color pleno en una tira de 4 px junto a los números. El pie son tres cifras que se parten entre ellas, nunca por dentro.

### 6.13 Ajustes ☀︎
Navegación por secciones a la izquierda (se recuerda la última abierta): General (idioma, tema Claro/Oscuro/Sistema con miniaturas: una ventana diminuta en cada tema, Sistema partida en diagonal), Análisis (notación con vista previa 8A / Am / 1m, rango BPM, redondeo, nº de cues 0–8, paleta de colores de cues editable, procesos en paralelo), Carpetas vigiladas (lista + añadir), Tags (plantilla por defecto), Stems (modelo Calidad máxima / Rápido, aceleración CPU / GPU, ubicación de caché con tamaño usado y botón "Vaciar"), Actualizaciones (interruptor), Acerca de (versión, licencia AGPL, código fuente, créditos y atribuciones con «Licencias de terceros», "Abrir carpeta de logs").

### 6.14 Guías
Pantalla de lectura con índice a la izquierda (Mezcla armónica, Niveles de energía, Cue points y saltos de frase, Mashups con stems) y artículo a la derecha con ilustraciones: la rueda armónica explicada con flechas de movimientos compatibles, ejemplos de curva de energía de un set y diagrama de compases/frases de 8, 16 y 32.

### 6.15 Estados y diálogos (hoja de componentes)
- Estado vacío de biblioteca, de playlist, de favoritos y de resultados de búsqueda ("Ningún tema coincide · Quitar filtros").
- Error del motor: banner superior ámbar "El motor de análisis se ha reiniciado" con "Ver detalles".
- Diálogo de descarga del modelo de stems (tamaño, progreso, "Solo se descarga una vez").
- Diálogo de confirmación de exportación a Traktor con copia de seguridad.
- Menú contextual de una fila de la tabla: Reproducir, Abrir detalle, Cargar en Deck A / B, Añadir a playlist ▸, Reanalizar, Editar info, Mostrar en Finder/Explorador, Quitar de la biblioteca.
- Arrastrando archivos sobre la ventana: superposición con borde aurora "Suelta para añadir y analizar".

## Datos de ejemplo (§8)

Para maquetas, capturas y la vista previa en el navegador, usar temas **inventados** (nunca artistas reales):

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

Biblioteca: 12.480 temas · 37 en "Revisar calidad" · 24 favoritos.

## Correspondencias con el brief original

El brief de diseño (§9 pedía: sistema de diseño, biblioteca de componentes, pantallas 6.1–6.15 en oscuro y las ☀︎ en claro, logo e icono) está implementado en `app/`. Los comentarios del código citan su numeración:

| Número antiguo | Dónde está ahora |
|---|---|
| §1, §1.1 | Overview › Marca y logotipo |
| §2.1–2.2 | Colors (Primary, Secondary, Tertiary, Neutral, Estado, Decks) |
| §2.3 | Colors › Rueda armónica; Components › Chips |
| §2.4 | Colors › Energía; Components › Chips (medidor) |
| §2.5–2.7 | Colors › Cues, Stems, Forma de onda |
| §3 | Typography |
| §4 | Layout, Elevation & Depth y Shapes |
| §5.1–5.16 | Components (cada subsección lleva su número) |
| §6, §6.1–6.15 | Pantallas (§6) |
| §7 | Do's and Don'ts |
| §8 | Datos de ejemplo (§8) |

**Valores que el código cambió respecto al brief, todos por contraste AA:** `primary` (`#7C6CFF` → `#7162E8`, hover más oscuro en vez de más claro), `text-3` (`#6F6D88` → `#8C8AA1` en oscuro, `#8A879E` → `#67647C` en claro), el texto violeta (`primary-ink`), los rellenos con texto blanco (`accent-fill`, `danger-fill`), los extremos del degradado aurora y los colores de estado en modo claro.
