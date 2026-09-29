param(
    [Parameter(Mandatory = $true)]
    [string]$ServerHost,
    [Parameter(Mandatory = $true)]
    [string]$DeviceId,
    [string]$OutputDirectory = ".desktop-data\pki"
)

$ErrorActionPreference = "Stop"

if ($DeviceId -notmatch '^[A-Za-z0-9._-]+$') {
    throw "DeviceId may contain only letters, numbers, dots, underscores, and hyphens."
}

$openssl = Get-Command openssl -ErrorAction Stop
$output = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
$deviceDirectory = Join-Path $output "devices\$DeviceId"
New-Item -ItemType Directory -Force -Path $deviceDirectory | Out-Null

$caKey = Join-Path $output "ca.key.pem"
$caCert = Join-Path $output "ca.cert.pem"
$serverKey = Join-Path $output "server.key.pem"
$serverCsr = Join-Path $output "server.csr.pem"
$serverCert = Join-Path $output "server.cert.pem"
$serverExt = Join-Path $output "server.ext"
$clientKey = Join-Path $deviceDirectory "client.key.pem"
$clientCsr = Join-Path $deviceDirectory "client.csr.pem"
$clientCert = Join-Path $deviceDirectory "client.cert.pem"
$clientP12 = Join-Path $deviceDirectory "client.p12"
$clientPasswordFile = Join-Path $deviceDirectory "client-password.txt"
$clientExt = Join-Path $deviceDirectory "client.ext"

if (-not (Test-Path $caKey) -or -not (Test-Path $caCert)) {
    & $openssl.Source req -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 `
        -keyout $caKey -out $caCert -subj "/CN=All In Relay CA"
    if ($LASTEXITCODE -ne 0) { throw "Could not create the relay CA." }
}

$sanType = if ([System.Net.IPAddress]::TryParse($ServerHost, [ref]([System.Net.IPAddress]$null))) { "IP" } else { "DNS" }
@"
subjectAltName=$sanType`:$ServerHost
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
"@ | Set-Content -Encoding ascii $serverExt

if (-not (Test-Path $serverKey) -or -not (Test-Path $serverCert)) {
    & $openssl.Source req -newkey rsa:2048 -nodes -sha256 -keyout $serverKey -out $serverCsr -subj "/CN=$ServerHost"
    if ($LASTEXITCODE -ne 0) { throw "Could not create the server key." }
    & $openssl.Source x509 -req -sha256 -days 825 -in $serverCsr -CA $caCert -CAkey $caKey `
        -CAcreateserial -out $serverCert -extfile $serverExt
    if ($LASTEXITCODE -ne 0) { throw "Could not sign the server certificate." }
}

@"
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature
extendedKeyUsage=clientAuth
"@ | Set-Content -Encoding ascii $clientExt

& $openssl.Source req -newkey rsa:2048 -nodes -sha256 -keyout $clientKey -out $clientCsr -subj "/CN=$DeviceId"
if ($LASTEXITCODE -ne 0) { throw "Could not create the device key." }
& $openssl.Source x509 -req -sha256 -days 825 -in $clientCsr -CA $caCert -CAkey $caKey `
    -CAcreateserial -out $clientCert -extfile $clientExt
if ($LASTEXITCODE -ne 0) { throw "Could not sign the device certificate." }
if (-not (Test-Path $clientPasswordFile)) {
    $passwordBytes = New-Object byte[] 24
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($passwordBytes)
    $rng.Dispose()
    $password = (($passwordBytes | ForEach-Object { $_.ToString('x2') }) -join '')
    Set-Content -LiteralPath $clientPasswordFile -Value $password -Encoding ascii -NoNewline
}
& $openssl.Source pkcs12 -export -out $clientP12 -inkey $clientKey -in $clientCert `
    -certfile $caCert -passout "file:$clientPasswordFile"
if ($LASTEXITCODE -ne 0) { throw "Could not create the Android PKCS#12 bundle." }

Remove-Item -Force $serverCsr, $serverExt, $clientCsr, $clientExt -ErrorAction SilentlyContinue

Write-Output "PKI_READY"
Write-Output "VPS_CA=$caCert"
Write-Output "VPS_CERT=$serverCert"
Write-Output "VPS_KEY=$serverKey"
Write-Output "PHONE_CA=$caCert"
Write-Output "PHONE_P12=$clientP12"
Write-Output "PHONE_P12_PASSWORD=$clientPasswordFile"
