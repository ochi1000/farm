param(
    [string]$PkiDirectory = ".desktop-data\pki",
    [string]$OutputDirectory = "dist\vps-relay"
)

$ErrorActionPreference = "Stop"
$pki = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $PkiDirectory))
$output = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
$outputPki = Join-Path $output "pki"

$required = @("ca.cert.pem", "server.cert.pem", "server.key.pem")
foreach ($name in $required) {
    if (-not (Test-Path (Join-Path $pki $name))) { throw "Missing PKI file: $name" }
}

New-Item -ItemType Directory -Force -Path $outputPki | Out-Null
Copy-Item scripts\relay-server.mjs (Join-Path $output "relay-server.mjs") -Force
Copy-Item scripts\relay-enroll.mjs (Join-Path $output "relay-enroll.mjs") -Force
Copy-Item scripts\relay-remove.mjs (Join-Path $output "relay-remove.mjs") -Force
Copy-Item deploy\all-in-relay.service (Join-Path $output "all-in-relay.service") -Force
foreach ($name in $required) {
    Copy-Item (Join-Path $pki $name) (Join-Path $outputPki $name) -Force
}

Write-Output "VPS_BUNDLE_READY=$output"
Write-Output "The CA private key and all phone client keys were excluded."
