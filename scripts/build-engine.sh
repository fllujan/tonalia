#!/usr/bin/env bash
# Build the engine sidecar with PyInstaller for the current (or given) target. See build_engine.py.
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run --project engine --quiet python scripts/build_engine.py "$@"
