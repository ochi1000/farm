# Offscreen viewport smoke test 0.3.3

Experimental, source-reviewed only. User runs all commands. Existing enabled service and private provisioning are prerequisites; do not clear data or uninstall.

1. Build and stop on failure:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-gecko-probe.ps1
```

2. With USB connected, update without opening the Activity:

```powershell
adb -s R5CR90G9C9X install -r .\android-gecko-probe\app\build\outputs\apk\debug\app-debug.apk
```

3. Keep phone unlocked, do not tap app or notification, wait20 seconds, export:

```powershell
adb -s R5CR90G9C9X exec-out run-as com.ocorp.geckoprobe cat files/report.json | Out-File -Encoding utf8 .\results\gecko-viewport-033.json
Get-Content .\results\gecko-viewport-033.json -Raw
```

This is package-update cold-start evidence, NOT reboot proof. Require version0.3.3, new process, no activity_started and offscreen_attached with720x1280 surface pixels; actual DOM viewportHeight must be positive (CSS pixels may differ). Surface success alone does not prove layout or timeline readiness. Inspect content_crashed/content_killed/bridge_disconnected/offscreen_failed. If startup did not run, report that without manually opening the app.

4. Only after viewport/bridge succeed, disconnect USB, send read via existing gecko-command.mjs and fetch status after10 seconds. Require completed, hidden Activity, home and nonzero text. Then scroll must move measured offset. Separately verify visible Activity handoff and Hide-browser return, then unplugged reboot/first unlock with no Activity launch.

The session remains inactive while hidden. Surface output is drained and discarded; no screenshots saved. No automatic recovery/replay is introduced. Controlled local-page fixture remains a follow-up if the X-only result cannot distinguish website rendering behavior. Stop service disables future startup as before.
