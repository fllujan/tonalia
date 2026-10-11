# Download pinned FFmpeg + Rubber Band for the current (or given) target. See fetch_binaries.py.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
uv run --project engine --quiet python scripts/fetch_binaries.py @args
exit $LASTEXITCODE
