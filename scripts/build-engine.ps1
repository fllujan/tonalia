# Build the engine sidecar with PyInstaller for the current (or given) target. See build_engine.py.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
uv run --project engine --quiet python scripts/build_engine.py @args
exit $LASTEXITCODE
