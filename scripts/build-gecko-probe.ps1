$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$tools = Join-Path $root '.tools'
$gradleVersion = '9.3.1'
$gradle = Join-Path $tools "gradle-$gradleVersion\bin\gradle.bat"
$project = Join-Path $root 'android-gecko-probe'
if (!(Test-Path -LiteralPath $gradle)) {
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    $zip = Join-Path $tools "gradle-$gradleVersion-bin.zip"
    $download = "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip"
    Write-Host "Preparing Gradle $gradleVersion for Gecko Probe..."
    if (!(Test-Path -LiteralPath $zip)) {
        $partial = "$zip.partial"
        Invoke-WebRequest -UseBasicParsing -Uri $download -OutFile $partial
        Move-Item -LiteralPath $partial -Destination $zip -Force
    }
    # Read as text from a file: Invoke-WebRequest.Content can be byte[] for
    # binary-labelled responses; casting that array to string is not decoding.
    $checksumFile = "$zip.sha256"
    Invoke-WebRequest -UseBasicParsing -Uri "$download.sha256" -OutFile $checksumFile
    $expected = (Get-Content -LiteralPath $checksumFile -Raw -Encoding UTF8).Trim()
    if ($expected -notmatch '^[a-fA-F0-9]{64}$') {
        throw "Invalid Gradle checksum response (expected 64 hexadecimal characters; received $($expected.Length) characters). Archive retained; nothing extracted."
    }
    $actual = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if ($actual -ine $expected) {
        $archiveBytes = (Get-Item -LiteralPath $zip).Length
        throw "Gradle archive checksum mismatch. Expected=$expected Actual=$actual Bytes=$archiveBytes Archive=$zip. Archive retained; nothing extracted. Share this error."
    }
    Write-Host 'Gradle archive SHA-256 verified.'
    Expand-Archive -LiteralPath $zip -DestinationPath $tools -Force
}
$jbr = 'C:\Program Files\Android\Android Studio\jbr'
if (Test-Path -LiteralPath "$jbr\bin\java.exe") { $env:JAVA_HOME = $jbr }
$sdkConfig = Join-Path $root 'android-x-runner\local.properties'
if (!(Test-Path "$project\local.properties") -and (Test-Path -LiteralPath $sdkConfig)) {
    Copy-Item -LiteralPath $sdkConfig -Destination "$project\local.properties"
}
New-Item -ItemType Directory -Force -Path (Join-Path $root 'results') | Out-Null
$log = Join-Path $root 'results\gecko-probe-build.log'
# Redirect compiler stderr as well; the native exit code determines success.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    & $gradle -p $project assembleDebug --console=plain *> $log
    $buildExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previous }
Get-Content -LiteralPath $log -Tail 60
if ($buildExit -ne 0) { throw "Build failed (exit $buildExit). Share the failure section of $log" }
Write-Host "APK ready: $project\app\build\outputs\apk\debug\app-debug.apk"
