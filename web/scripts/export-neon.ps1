# Export Neon Postgres backup (run after setting NEON_DATABASE_URL)
# Usage:
#   $env:NEON_DATABASE_URL = "postgresql://..."
#   .\export-neon.ps1

param(
  [string]$OutputFile = "..\..\outreach_backup.dump"
)

if (-not $env:NEON_DATABASE_URL) {
  Write-Error "Set NEON_DATABASE_URL first (Neon connection string from console.neon.tech)."
  exit 1
}

$pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
if (-not $pgDump) {
  Write-Error "pg_dump not found. Install PostgreSQL client tools: https://www.postgresql.org/download/windows/"
  exit 1
}

Write-Host "Exporting to $OutputFile ..."
& pg_dump $env:NEON_DATABASE_URL -F c -f $OutputFile
if ($LASTEXITCODE -ne 0) {
  Write-Error "pg_dump failed. Neon may be suspended — try again after monthly reset or from Neon dashboard export."
  exit 1
}

$size = (Get-Item $OutputFile).Length
Write-Host "Done. Backup size: $size bytes"
if ($size -lt 1000) {
  Write-Warning "Backup looks very small — verify export succeeded."
}
