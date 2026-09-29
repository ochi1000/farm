param(
    [string]$Serial = "",
    [string]$Resolution = "720x1600/320",
    [int]$MaxFps = 30,
    [switch]$Detached
)

$ErrorActionPreference = "Stop"

if (-not $Serial) {
    $devices = @(adb devices | Select-Object -Skip 1 | ForEach-Object {
        $parts = ($_ -split "\s+")
        if ($parts.Count -ge 2 -and $parts[1] -eq "device") { $parts[0] }
    } | Where-Object { $_ })

    if ($devices.Count -eq 0) {
        throw "No authorized ADB device found."
    }
    if ($devices.Count -gt 1) {
        throw "Multiple ADB devices found. Pass -Serial with the device to use: $($devices -join ', ')"
    }
    $Serial = $devices[0]
}

$scrcpy = Get-Command scrcpy -ErrorAction SilentlyContinue
if ($scrcpy) {
    $scrcpyPath = $scrcpy.Source
} else {
    $packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $scrcpyPath = Get-ChildItem $packageRoot -Recurse -Filter scrcpy.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*Genymobile.scrcpy*" } |
        Select-Object -First 1 -ExpandProperty FullName
}

if (-not $scrcpyPath) {
    throw "scrcpy is not installed. Install it with: winget install --id Genymobile.scrcpy -e"
}

Write-Host "Starting isolated Chrome display on $Serial"
$scrcpyArguments = @(
    "--serial", $Serial,
    "--new-display=$Resolution",
    "--start-app=com.android.chrome",
    "--no-audio",
    "--window-title", "Background Chrome Virtual Display",
    "--max-fps", "$MaxFps"
)

if ($Detached) {
    $argumentLine = "--serial `"$Serial`" --new-display=$Resolution --start-app=com.android.chrome --no-audio --window-title `"Background Chrome Virtual Display`" --max-fps $MaxFps"
    Start-Process -FilePath $scrcpyPath -ArgumentList $argumentLine
} else {
    & $scrcpyPath @scrcpyArguments
}
