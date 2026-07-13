# Import backup into Supabase Postgres
# Usage:
#   $env:SUPABASE_DATABASE_URL = "postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres"
#   .\import-supabase.ps1

param(
  [string]$InputFile = "..\..\outreach_backup.dump"
)

if (-not $env:SUPABASE_DATABASE_URL) {
  Write-Error "Set SUPABASE_DATABASE_URL first (Supabase → Settings → Database → URI)."
  exit 1
}

if (-not (Test-Path $InputFile)) {
  Write-Error "Backup not found: $InputFile — run export-neon.ps1 first."
  exit 1
}

$pgRestore = Get-Command pg_restore -ErrorAction SilentlyContinue
if (-not $pgRestore) {
  Write-Error "pg_restore not found. Install PostgreSQL client tools."
  exit 1
}

Write-Host "Importing $InputFile into Supabase ..."
& pg_restore -d $env:SUPABASE_DATABASE_URL --no-owner --no-acl --clean --if-exists $InputFile
if ($LASTEXITCODE -ne 0) {
  Write-Warning "pg_restore returned errors (often safe for existing objects). Verify with SQL:"
  Write-Host "  SELECT COUNT(*) FROM campaigns; SELECT COUNT(*) FROM lead_sends;"
} else {
  Write-Host "Import finished. Open Supabase SQL Editor and verify row counts."
}
