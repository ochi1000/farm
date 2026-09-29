$ErrorActionPreference = 'Stop'

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$tools = Join-Path $root '.tools'
$gradleVersion = '8.11.1'
$gradleDir = Join-Path $tools "gradle-$gradleVersion"
$gradleZip = Join-Path $tools "gradle-$gradleVersion-bin.zip"
$studioJbr = 'C:\Program Files\Android\Android Studio\jbr'

New-Item -ItemType Directory -Force -Path $tools | Out-Null

if (!(Test-Path (Join-Path $gradleDir 'bin\gradle.bat'))) {
    if (!(Test-Path $gradleZip)) {
        Invoke-WebRequest -Uri "https://services.gradle.org/distributions/gradle-$gradleVersion-bin.zip" -OutFile $gradleZip
    }
    Expand-Archive -LiteralPath $gradleZip -DestinationPath $tools -Force
}

if (Test-Path (Join-Path $studioJbr 'bin\java.exe')) {
    $env:JAVA_HOME = $studioJbr
}

& (Join-Path $gradleDir 'bin\gradle.bat') -p (Join-Path $root 'android-x-runner') assembleDebug
