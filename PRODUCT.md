# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

App de escritorio para macOS (Apple Silicon e Intel) y Windows 10/11 x64, hecha con Tauri 2: la interfaz es React + TypeScript dentro del webview del sistema. No hay versión web pública, móvil ni Linux (Linux no es objetivo, pero no se bloquea).

## Users

**Principal: DJ aficionado o semiprofesional.** Prepara sus sets en casa, normalmente de noche, con una biblioteca de cientos a unos miles de temas. Quiere tonalidad, BPM, energía y cues fiables sin pagar una suite comercial, y llevar ese trabajo al programa de DJ que ya usa (Rekordbox, Serato, Traktor, VirtualDJ o Engine DJ).

Otros perfiles a los que también sirve, sin prioridad: el DJ de club con bibliotecas grandes (la tabla soporta 100 000 temas) y quien hace mashups y edits con el modo Pro (stems, cambio de tono, exportación al DAW).

## Product Purpose

Tonalia analiza la música del DJ en su propio ordenador (tonalidad, BPM y beatgrid, energía 1–10, estructura, cue points automáticos, calidad y forma de onda), escribe esos resultados en los tags y en las colecciones de su software de DJ, y le ayuda a mezclar en armonía: sugerencias de mashup y de transición, dos decks sincronizados, separación de stems, cambio de tono y un constructor de sets por curva de energía.

**Éxito en el primer año:** una comunidad abierta. Que otros DJs la descarguen, la usen y contribuyan en GitHub (`github.com/fllujan/tonalia`).

## Positioning

Cuatro cosas juntas, confirmadas por el autor:

1. **Libre y gratis:** AGPL-3.0, sin licencias ni suscripciones.
2. **Todo local y privado:** sin cuentas, sin telemetría y sin servidores. Las únicas conexiones son la descarga opcional de los modelos de stems y la comprobación de actualizaciones, que se puede desactivar.
3. **Todo en una app:** análisis, tags, limpieza, playlists, exportación a cinco programas de DJ, modo Pro con mashups y stems, y constructor de sets.
4. **Seguridad de los datos:** cada escritura en archivos del usuario o en colecciones de otros programas tiene copia de seguridad, simulación previa, deshacer y escritura atómica.

## Operating Context

- Flujo típico: arrastrar una carpeta → analizar (cola en paralelo, cancelable) → revisar y corregir (detalle del tema, info del tema, piano y rueda armónica para comprobar de oído) → escribir tags y exportar al software de DJ → preparar el set (modo Pro, constructor de sets) → tocar en el programa de DJ de siempre.
- Tonalia no reproduce en directo: es la herramienta de **preparación**, no la de la cabina.
- Convive con Rekordbox, Serato, Traktor, VirtualDJ y Engine DJ, y con DAWs (Ableton y otros) para las stems exportadas. Algunos destinos exigen que el otro programa esté cerrado.
- Sesiones largas y densas, a menudo a oscuras: el modo oscuro es el principal.

## Capabilities and Constraints

- Especificación completa en `SPEC.md` (fases 0–10, todas implementadas). Estado y decisiones en `PROGRESS.md`.
- Arquitectura: frontend React ⇄ núcleo Rust (Tauri) ⇄ motor Python como sidecar por JSON-RPC sobre stdio. Los tipos RPC se definen solo en `engine/tonalia_engine/rpc_schema.py`.
- **Terminología obligatoria:** la notación 1A–12B se llama «Alfanumérica» y la rueda, «Rueda armónica». No usar nunca la palabra «Camelot» (marca registrada) en la interfaz, el código ni la documentación. Otras notaciones: Open Key, Clásica y Clásica con bemoles.
- Interfaz en español e inglés desde el primer día; toda cadena visible pasa por i18n. Código, identificadores y commits en inglés; documentación de usuario en los dos idiomas.
- Todas las dependencias deben ser compatibles con AGPL-3.0; nada de modelos ni librerías «no comerciales».
- Nunca se sube audio con copyright al repositorio; los fixtures se generan por script.
- Rendimiento comprometido: análisis de un tema de 6 min en < 10 s, arranque < 3 s, sugerencias < 200 ms con 20 000 temas, tabla fluida con 100 000 filas.
- Distribución: `.dmg` con firma ad-hoc (sin notarización) e instalador de Windows sin firmar; actualizador de Tauri vía GitHub Releases.
- Decisiones de producto aún abiertas (ver `PROGRESS.md` → «Decisiones pendientes»): modelo de stems por defecto, PyTorch solo CPU en Windows, la estimación de voz sin stems y la licencia de los pesos de Demucs.

## Brand Commitments

- Nombre: **Tonalia**, siempre con mayúscula inicial. Lema: «Mezcla en armonía.» / «Mix in harmony.»
- Personalidad: musical, nocturna, precisa y cálida; un instrumento profesional, no un juguete. Libre y de la comunidad: cercana, sin agresividad comercial.
- Identidad propia: no parecerse a Mixed In Key, Rekordbox, Serato ni Traktor; no usar sus nombres como marca, logos, colores corporativos, textos ni capturas. Los programas de destino se nombran en texto, con iconos genéricos.
- El sistema visual vinculante (colores, tipografía, componentes y pantallas) está en `DESIGN.md` y en `app/src/styles/tokens.css`; las pantallas exportadas de referencia están en `design/`.

## Evidence on Hand

- Precisión medida de tonalidad y tempo: `docs/accuracy.md`.
- Guías de usuario: `docs/user-guide.es.md` y `docs/user-guide.en.md`; checklists manuales en `docs/manual-tests.md`.
- Atribuciones de terceros generadas en cada build (Ajustes → Acerca de).
- **No existen** testimonios, usuarios reales, cifras de descargas, prensa ni casos de estudio. Los programas de DJ de destino aún no se han verificado a mano con la app real (checklists pendientes). No inventar nada de esto.
- Los datos de ejemplo de las maquetas (sección 8 de `DESIGN.md`) son temas y artistas inventados.

## Product Principles

1. **Los datos del DJ son sagrados.** Nada se escribe sin vista previa, copia de seguridad y deshacer; ante la duda, la opción más conservadora.
2. **Local por defecto, siempre.** Ninguna función nueva puede exigir cuenta, nube ni telemetría.
3. **La información musical manda.** Tonalidad, energía, cues y decks son lo importante de cada pantalla; la interfaz no compite con ellos.
4. **Preparar para tocar en otro sitio.** Tonalia vale lo que valga su resultado dentro del programa de DJ del usuario; la exportación fiable es parte del producto, no un extra.
5. **Abierta a la comunidad.** Documentación bilingüe, código legible y contribuir fácil, porque el éxito es que otros DJs la usen y la mejoren.

## Accessibility & Inclusion

- Navegación completa con teclado y foco visible; contraste WCAG AA (comprobado por test, también en los chips de tonalidad en modo claro).
- La información nunca va solo por color: la tonalidad siempre con texto, la energía con número y las transiciones con icono.
- Respetar «reducir movimiento». Objetivos de clic ≥ 24 px.
- Español e inglés con paridad de claves comprobada por test.
