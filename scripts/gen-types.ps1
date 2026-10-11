# Regenerate app/src/lib/rpc.types.ts from the pydantic RPC schema. Pass --check to verify only.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\app")
node scripts/gen-types.mjs @args
exit $LASTEXITCODE
