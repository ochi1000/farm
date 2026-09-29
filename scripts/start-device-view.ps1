param(
    [Parameter(Mandatory = $true)]
    [string]$Serial,
    [int]$MaxFps = 30,
    [switch]$Detached
)

$ErrorActionPreference = "Stop"
$scrcpy = Get-Command scrcpy -ErrorAction SilentlyContinue
if ($scrcpy) {
    $scrcpyPath = $scrcpy.Source
} else {
    $packageRoot = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages"
    $scrcpyPath = Get-ChildItem $packageRoot -Recurse -Filter scrcpy.exe -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*Genymobile.scrcpy*" } |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $scrcpyPath) { throw "scrcpy is not installed." }

$arguments = "--serial `"$Serial`" --no-audio --window-title `"Remote Android Device`" --max-fps $MaxFps"
if ($Detached) {
    Start-Process -FilePath $scrcpyPath -ArgumentList $arguments
} else {
    & $scrcpyPath --serial $Serial --no-audio --window-title "Remote Android Device" --max-fps $MaxFps
}
