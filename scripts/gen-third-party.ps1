# Regenerate the third-party attributions (app/src-tauri/binaries/licenses/). See third_party.py.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
uv run --project engine --quiet python scripts/third_party.py @args
exit $LASTEXITCODE
