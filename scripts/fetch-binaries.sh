#!/usr/bin/env bash
# Download pinned FFmpeg + Rubber Band for the current (or given) target. See fetch_binaries.py.
set -euo pipefail
cd "$(dirname "$0")/.."
exec uv run --project engine --quiet python scripts/fetch_binaries.py "$@"
