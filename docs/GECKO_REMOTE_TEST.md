# Gecko Probe 0.3: remote/background/boot test

Update 0.3.1: background read passed on the test Samsung. A scroll response timed out, but a subsequent hidden-page capture measured the expected 0 -> 392 movement. The prepared fix uses instant scrolling and an immediate measured snapshot instead of a page timer. User must rebuild/install -r and repeat background scroll; fix is not yet live-verified. A completed reply requires changed offsets to count as a movement pass; it does not prove new content loaded.

Prepared source only. User runs the steps and shares each result; assistant does not build, deploy, operate or monitor devices autonomously. Network-change testing is deferred by user. No new login, posting, liking or replying is part of this milestone.

## Design and limits

BrowserEngine owns the persistent GeckoSession independently of MainActivity. An explicitly enabled foreground service keeps the process eligible for background work, displays an ongoing Stop notification, and polls an isolated HTTPS broker every five seconds. A boot receiver starts it after first unlock if enabled; it never opens an Activity or bypasses the lock. Stop disables future boot startup. Android force-stop is outside automatic-recovery acceptance. Samsung/Android scheduling, Doze and unseen Gecko layout are being tested, not assumed reliable. A wake lock is held only during a bounded command (20 seconds max), not continuously. No battery-exemption setting is silently changed.

The test uses Android's `specialUse` foreground-service declaration with the stated lab-browser use case; no claim of Play Store approval or cross-device compatibility. References: [Android service types](https://developer.android.com/develop/background-work/services/fgs/service-types), [Gecko session visibility](https://mozilla.github.io/geckoview/javadoc/mozilla-central/org/mozilla/geckoview/GeckoSession.html). Session starts inactive without an attached display; it is not forced to appear visible. Cold-boot scroll may fail with a zero viewport; that is evidence to fix, not a successful background test.

The new broker listens on TCP 8053 and uses existing VPS TLS paths, CA and enrollment registry. It does not change relay-server.mjs or All in, or use ADB forwarding. Each device request AND controller request requires its enrolled device certificate (CN match) plus token. For this bounded single-device probe the controller and phone share the enrollment identity; separate controller authorization is a production follow-up. Only status/read/capture/scroll exist; no arbitrary JS, shell, URL or publication command.

One job per device, 60-second expiry, no replay after delivery, 15-second DOM deadline. Status reports delivery versus actual completion separately. A lost response becomes delivery_outcome_unknown: do not infer success or retry automatically. Broker memory is not a durable production queue; restart loses pending/result history. Exported reports contain only selected metadata/counts, not auth material or post text. Reports capture Activity visibility, screen interactive/lock state, process/session IDs, start reason, documentHidden and viewportHeight. These plus observed UI behavior establish the test outcome.

## Stage 1: local checks and APK build

From repository root, run and share results:

```powershell
node scripts/test-gecko-broker.mjs
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-gecko-probe.ps1
```

The Node checks cover queue isolation, command allowlist, expiry, no replay and report redaction. They do not prove TLS/device behavior. No tests/build were executed by the assistant for 0.3.

## Stage 2: user-run broker deployment

After successful local checks, use the existing enrolled Samsung ID:

```powershell
node scripts/deploy-gecko-broker.mjs 9249e2cf-ef48-4985-a862-34603eba74e4 install
node scripts/deploy-gecko-broker.mjs 9249e2cf-ef48-4985-a862-34603eba74e4 status
node scripts/gecko-command.mjs 9249e2cf-ef48-4985-a862-34603eba74e4 status
```

Installer reads existing protected SSH settings, requires strict known-host checking and passwordless sudo, copies only broker source/unit and creates a separate systemd service. Uses repository-standard /etc/all-in-relay.env and /opt/all-in-relay/relay-devices.json. Existing relay stays running. If deployment differs or sudo is unavailable, stop and report the error. The installer does not open a firewall. TCP 8053 must be allowed in the VPS/provider firewall before phone/controller reachability can pass; if status fails, diagnose that before provisioning/reboots. Do not dump the environment file or private configuration.

Expected initial broker status: online=false and job=null is valid before the phone is provisioned. TLS/auth success is what this step proves.

## Stage 3: one-time USB installation/configuration

```powershell
adb -s R5CR90G9C9X install -r .\android-gecko-probe\app\build\outputs\apk\debug\app-debug.apk
node scripts/provision-gecko-remote.mjs 9249e2cf-ef48-4985-a862-34603eba74e4
adb -s R5CR90G9C9X shell am start -n com.ocorp.geckoprobe/.MainActivity
```

Provisioning verifies hardware serial and writes existing CA/client PKCS12/password/token through stdin into app-private remote-config.json. No secret is put into command arguments, reports or console. Do not print/pull that file. Browser profile is retained via install -r. Tap Enable service; allow notifications when requested. If previously enabled before provisioning, Stop then reopen/Enable to reload configuration. Verify the persistent notification appears and X remains signed in. Then disconnect USB.

## Stage 4: actual remote execution

With the browser visible, enqueue one command:

```powershell
node scripts/gecko-command.mjs 9249e2cf-ef48-4985-a862-34603eba74e4 read
```

Wait about 10 seconds yourself, then fetch once:

```powershell
node scripts/gecko-command.mjs 9249e2cf-ef48-4985-a862-34603eba74e4 status
```

Command acceptance is NOT success. Require job.status=finished, result.outcome=completed, home route and nonzero extractedCharacters. CLI writes each response to results/gecko-remote-<device>-<time>.json. If no result yet, one later manual status check is sufficient; do not start a monitoring loop. Export each result before queuing the next job (broker retains only latest job). `device-status` queues a fresh device-generated status; plain `status` reads broker state.

Repeat with `scroll` and verify scrollAfter differs from scrollBefore. Then repeat read/scroll after pressing Home while another app is visible, and after Hide browser (Activity removed). Require activityVisible=false at both command start and result. Test screen-off separately and report lock state. A timeout/zero viewport/bridge_unavailable is a failed execution test even if broker reports online=true.

## Stage 5: automatic startup

Only after foreground/background smoke succeeds: leave service enabled, disconnect USB, reboot manually, unlock once, and DO NOT open Gecko Probe or tap its notification. Wait for internet and check broker status from computer. Require fresh lastSeenAt, changed processId, startReason=boot_completed, activityVisible=false. Enqueue read and scroll as above; successful DOM results without app launch demonstrate actual browser readiness after boot. No claim of before-unlock browser operation. No wireless-debugging approval should be needed for this HTTPS path.

## Stop / diagnostics

Use notification Stop (or app Stop service) to disable polling and future boot starts. On VPS, `sudo systemctl disable --now gecko-probe-broker` stops only the new broker. Do not force-stop before the boot test.

If remote startup fails, preserve broker status first, then reconnect USB ONLY for report inspection without opening the app:

```powershell
adb -s R5CR90G9C9X exec-out run-as com.ocorp.geckoprobe cat files/report.json | Out-File -Encoding utf8 .\results\gecko-background-diagnostic.json
Get-Content .\results\gecko-background-diagnostic.json -Raw
```

If report is stale, receiver startup may have failed; inspect only its saved exception type via a targeted follow-up, not raw profile/log dumps. UI launch after a failure invalidates automatic-startup evidence for that attempt; mark it as assisted recovery.
