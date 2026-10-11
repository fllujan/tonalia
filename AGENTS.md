# AGENTS.md — instrucciones para el agente de código (Claude Code)

Estás construyendo "Tonalia", descrito por completo en `SPEC.md`. Lee `SPEC.md` entero antes de empezar y vuelve a consultarlo antes de cada fase. Para cualquier trabajo de interfaz, sigue `DESIGN.md` (y las pantallas de la carpeta `design/` si existen).

## Cómo trabajar

1. **Orden estricto.** Implementa las fases y tareas de la sección 4 de `SPEC.md` en orden (0.1, 0.2, …). No empieces una fase hasta que la anterior cumpla todos sus criterios de aceptación.
2. **Una tarea cada vez.** Para cada tarea:
   - Explica en 2–3 líneas qué vas a hacer.
   - Escribe primero los tests cuando la tarea tenga lógica (motor, `keys`, `suggest`, `tags`, `export`).
   - Implementa.
   - Ejecuta lint, tipos y tests de las partes tocadas (`ruff`, `mypy`, `pytest`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `cargo clippy`, `cargo test`).
   - Haz commit con un mensaje en inglés estilo Conventional Commits (`feat(engine): add key ensemble`), referenciando la tarea (`[2.2]`).
   - Marca la tarea en `PROGRESS.md` con la fecha y cualquier nota relevante.
3. **`PROGRESS.md`** existe desde la tarea 0.1. Contiene: fase actual, checklist de tareas copiada de `SPEC.md`, decisiones tomadas, problemas abiertos y resultados de precisión. Léelo al comenzar cada sesión para saber dónde continuar.
4. **Si algo del spec es imposible o ambiguo,** no lo inventes en silencio: anota la duda en `PROGRESS.md` (sección "Decisiones pendientes"), elige la opción más conservadora y sigue. Si bloquea la fase, para y pregunta.
5. **No rompas lo que funciona.** Toda la suite de tests debe pasar antes de cada commit. Nunca desactives un test para hacerlo pasar.

## Reglas del proyecto

- Respeta la sección 0 de `SPEC.md` (nombre propio, nada de marcas de terceros, todo local, nunca destruir datos, AGPL-3.0).
- No añadas dependencias con licencias incompatibles con AGPL-3.0 ni modelos con licencia "no comercial". Al añadir una dependencia, regístrala en `docs/third-party.md` con su licencia.
- No subas audio con copyright. Genera los fixtures por script.
- Tipos JSON-RPC: se definen solo en `engine/tonalia_engine/rpc_schema.py`; regenera `app/src/lib/rpc.types.ts` con `scripts/gen-types` después de cambiarlos.
- Toda cadena visible en la UI va por i18n con traducción a español e inglés.
- Rutas de archivo: usa siempre `pathlib` (Python) y las APIs de ruta de Tauri. Prueba rutas con tildes, emojis y espacios.
- Cualquier escritura en archivos del usuario o en colecciones de otros programas: backup + simulación + undo, y escritura atómica.
- Mantén el código en inglés (identificadores, comentarios y commits). La documentación de usuario, en español e inglés.

## Comandos (créalos en la fase 0 y mantenlos actualizados aquí)

```
# Motor
cd engine && uv sync            # o pip install -e .[dev]
cd engine && uv run pytest
cd engine && uv run ruff check . && uv run mypy tonalia_engine

# App
cd app && pnpm install
cd app && pnpm tauri dev
cd app && pnpm lint && pnpm typecheck && pnpm test
cd app/src-tauri && cargo clippy --all-targets -- -D warnings && cargo test

# Sidecar y builds
./scripts/fetch-binaries.sh     # ffmpeg + rubberband para la plataforma actual (Windows: .ps1)
./scripts/build-engine.sh       # PyInstaller → app/src-tauri/binaries/engine + tauri.bundle.conf.json
cd app && pnpm tauri build --config src-tauri/binaries/tauri.bundle.conf.json
```

macOS con el repo en un Escritorio sincronizado con iCloud: exporta `CARGO_TARGET_DIR="$HOME/Library/Caches/tonalia/target"` (ver `PROGRESS.md`, problemas abiertos).

## Al terminar cada fase

Escribe en `PROGRESS.md` un resumen de la fase: qué se hizo, cómo probarlo a mano, resultados de los criterios de aceptación y lo que queda pendiente. Después continúa con la siguiente fase.
