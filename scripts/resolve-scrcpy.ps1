$ErrorActionPreference = 'Stop'
$command = Get-Command scrcpy -ErrorAction SilentlyContinue
if ($command) { Write-Output $command.Source; exit 0 }
$found = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages') -Recurse -Filter scrcpy.exe -ErrorAction SilentlyContinue | Where-Object FullName -like '*Genymobile.scrcpy*' | Select-Object -First 1
if (-not $found) { throw 'scrcpy not installed' }
Write-Output $found.FullName
