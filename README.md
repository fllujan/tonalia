<p align="center"><strong>Tonalia</strong> — <em>Mezcla en armonía. · Mix in harmony.</em></p>

## Español

Tonalia es una aplicación de escritorio **libre y de código abierto** (AGPL-3.0) para DJs en macOS y Windows. Detecta la tonalidad, el BPM y la energía de cada tema, coloca cue points automáticos, escribe y limpia tags, exporta a tu software de DJ, sugiere mashups y transiciones, separa stems y construye sets.

Todo se procesa en tu ordenador: sin cuentas, sin telemetría y sin servidores.

**Estado:** en desarrollo. Consulta [`PROGRESS.md`](PROGRESS.md) para ver la fase actual.

## English

Tonalia is a **free and open-source** (AGPL-3.0) desktop app for DJs on macOS and Windows. It detects the key, BPM and energy of every track, places automatic cue points, writes and cleans tags, exports to your DJ software, suggests mashups and transitions, separates stems and builds sets.

Everything runs on your computer: no accounts, no telemetry, no servers.

**Status:** in development. See [`PROGRESS.md`](PROGRESS.md) for the current phase.

## Development

Requirements: [uv](https://docs.astral.sh/uv/), Node.js ≥ 20 with [pnpm](https://pnpm.io/), and stable [Rust](https://rustup.rs/).

```sh
# Engine (Python 3.11)
cd engine && uv sync
cd engine && uv run pytest
cd engine && uv run ruff check . && uv run mypy tonalia_engine

# App (Tauri 2 + React)
cd app && pnpm install
cd app && pnpm tauri dev
cd app && pnpm lint && pnpm typecheck && pnpm test

# Sidecar and builds
./scripts/fetch-binaries.sh     # ffmpeg + rubberband for the current platform (Windows: .ps1)
./scripts/build-engine.sh       # PyInstaller → app/src-tauri/binaries/engine + tauri.bundle.conf.json
cd app && pnpm tauri build --config src-tauri/binaries/tauri.bundle.conf.json
```

Architecture, functional spec and design system: [`SPEC.md`](SPEC.md), [`DESIGN.md`](DESIGN.md). Agent workflow: [`AGENTS.md`](AGENTS.md).

## License

[GNU Affero General Public License v3.0](LICENSE). Third-party components: [`docs/third-party.md`](docs/third-party.md).
