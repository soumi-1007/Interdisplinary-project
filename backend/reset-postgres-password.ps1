# Resets local PostgreSQL password without knowing the old one.
# Requires Administrator privileges to edit pg_hba.conf and restart the service.

$ErrorActionPreference = 'Stop'

$pgHba = 'C:\Program Files\PostgreSQL\18\data\pg_hba.conf'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$serviceName = 'postgresql-x64-18'
$newPassword = 'CoopLocal2026!'
$backup = "$pgHba.bak.coop-reset"

if (-not (Test-Path $pgHba)) {
  throw "pg_hba.conf not found at $pgHba"
}

Copy-Item $pgHba $backup -Force

$content = Get-Content $pgHba -Raw
$content = $content -replace '(?m)^(host\s+all\s+all\s+127\.0\.0\.1/32\s+)scram-sha-256', '${1}trust'
$content = $content -replace '(?m)^(host\s+all\s+all\s+::1/128\s+)scram-sha-256', '${1}trust'
Set-Content -Path $pgHba -Value $content -NoNewline

try {
  Restart-Service $serviceName -Force
  Start-Sleep -Seconds 3

  $env:PGPASSWORD = ''
  & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "ALTER USER postgres WITH PASSWORD '$newPassword';"
  & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'cooperative_db'" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to connect after trust auth change' }

  $exists = & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'cooperative_db'"
  if ($exists -ne '1') {
    & "$pgBin\psql.exe" -U postgres -h 127.0.0.1 -d postgres -c "CREATE DATABASE cooperative_db;"
  }

  Write-Output "PASSWORD_RESET_OK"
}
finally {
  Copy-Item $backup $pgHba -Force
  Restart-Service $serviceName -Force
  Start-Sleep -Seconds 2
}
