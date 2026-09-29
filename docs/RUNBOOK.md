# Device Lab Runbook

This is the short operational entry point. See `README.md` for feature details and troubleshooting.

## Start a New Chat

Use this prompt from the repository root:

```text
Read AGENTS.md, docs/PROJECT_STATE.md, and docs/RUNBOOK.md. Continue from the recorded next objective. Verify live device and VPS state instead of assuming it.
```

For a narrower task, append one measurable outcome, for example:

```text
Implement the detached long-run launcher. Success means it can start, report status, stop, and write a final JSON report without keeping this chat active.
```

## Local Prerequisites

```powershell
node --version
npm --version
adb version
adb devices -l
npm install
```

Required versions and tools:

- Windows 10/11
- Node.js 20+
- Android Platform Tools
- Authorized USB debugging for initial setup
- Chrome on the Android phone
- SSH public-key access to the VPS for unattended desktop tunnels

## Start the Desktop Controller

```powershell
npm run desktop
```

For a launch without a visible terminal, run `scripts\start-desktop-hidden.vbs`.

Normal device setup flow:

1. Connect one USB-authorized phone.
2. Open Add device and select the discovered model.
3. Enter only a friendly name.
4. Run setup. The controller discovers identity, installs `All in`, enables ADB TCP, creates credentials, enrolls the VPS route, provisions the phone, and verifies relay status.
5. Disconnect USB only after remote relay and ADB status are verified.

## Focused Verification

```powershell
npm run typecheck
npm run test:x
npm run test:desktop
node scripts/test-fleet-relay.mjs
```

These checks do not prove a phone or VPS is online.

Live checks:

```powershell
adb devices -l
npm run preflight -- --serial <adb-serial>
```

Use the desktop dashboard for authenticated VPS status, per-device remote ADB connection, and embedded viewing. Do not place tokens or passwords in command history when the desktop can pass them through protected configuration or process environment.

## VPS Service

The expected Linux service name is `all-in-relay`:

```bash
sudo systemctl status all-in-relay
sudo systemctl restart all-in-relay
sudo journalctl -u all-in-relay -n 100 --no-pager
```

Expected network exposure:

- Relay ingress and status ports are protected by mTLS.
- The enrollment/admin port is loopback-only and reached through SSH.
- Every ADB controller route is loopback-only and reached through SSH forwarding.

## Evidence and Reports

Write generated reports under `results/`. Reports must omit credentials, cookies, authorization headers, full account content, and private device configuration.

For a long test:

1. Run a short smoke test using the same device and code path.
2. Start the long run as a detached process.
3. Record start time, PID, device ID, action class, and report path in a status file.
4. Let the process update its own heartbeat and bounded log.
5. Return in a later turn or chat to inspect status or the final report.
6. Do not continuously poll through the model.

## Recovery Order

When a device is unavailable, check in this order:

1. VPS status: `Offline`, `Relay only`, or `Ready`.
2. Phone relay heartbeat and local ADB probe.
3. SSH local-forward process on the desktop.
4. `adb devices -l` for the loopback route.
5. Chrome/CDP target discovery.
6. scrcpy server and decoder state, if viewing is requested.

If local ADB is off, reconnect the authorized phone by USB and repeat device setup. Do not attempt to bypass Android authorization or secure lock state.


## Detached read-only runs

Select a ready device and choose **Run read-only smoke test**. Use **Test status** to inspect the outcome. After a successful cycle, **Start 3-hour read-only test** starts at most 18 alternating read/scroll cycles, with ten-minute waits. A successful run on the same device within the last hour is required for runs of 30 minutes or longer. **Stop test** requests cooperative shutdown after the active cycle; waiting stops within about one second.

The worker is detached and hidden on Windows. Chat closure does not stop it. Keep the desktop open for remote runs because its SSH tunnel is still required. Status is refreshed on demand, and the worker writes a heartbeat every 30 seconds. A cycle can run past the requested duration while browser cleanup finishes.

CLI: `node scripts/long-run.mjs start '<JSON options>'`, `node scripts/long-run.mjs status <run-id>`, or `node scripts/long-run.mjs stop <run-id>`. Start options are `serial`, `deviceId`, optional `accountId`, `durationSeconds`, `waitSeconds`, and `maxCycles`. Use a short duration and one cycle for the smoke test. PowerShell users should pass JSON as a single quoted argument.

Evidence lives in `results/long-runs/<run-id>/`: status, final report, and a stop marker. Reports contain counts and outcomes, with at most 100 cycle entries; raw output is discarded. Temporary local configuration is removed on normal completion. Existing workflow audit storage still applies. A stale heartbeat is reported as `unresponsive`; an abrupt process termination may leave no final report and a device lock. Verify the recorded PID has exited before manually removing that device's `.lock` file in `results/long-runs/`. Locks deliberately prevent automatic overlapping recovery runs.

Verification: `node scripts/test-long-run.mjs` exercises real detached startup and cooperative stop without device operations. It is not a live smoke test.


## Automation simulation controls

Restart the desktop to load the new **Automation - Simulation** panel. It is independent of phone selection. Click **Start automation** for three synthetic cycles (view, like, comment, read comments, reply to a comment, create post, scroll). **Stop automation** interrupts the run; **View report** shows its final JSON. Enable **Test stop-on-error at step 3** to exercise the error banner and failed report. No phone, X account or SSH connection is used. Persona rules select targets; local Ollama now generates and reviews contextual drafts.

The hidden supervisor survives controller/chat closure. Reopening the controller restores the latest run and up to 200 recent events. Updates arrive through the Electron event bridge from a local journal watcher, normally within 250 ms; heartbeat snapshots update every ten seconds. Logs and JSON/Markdown reports are under `results/automation/<run-id>/`. The UI shows simulated counts; live submissions are always zero.

Commands:

```powershell
npm.cmd run simulation:status
npm.cmd run test:simulation
npm.cmd run test:simulation:ui
npm.cmd run test:simulation:batch
```

Run tests while no manual simulation is active. The first command inspects the latest run. The lifecycle check tests real child processes, cancellation, failures, reconnect/replay and supervisor crash recovery. The UI check uses the actual supervisor/controller bridge with a headless browser. The batch command starts ten repetitions detached and prints its PID/report path; inspect `results/simulation-batch.json` later for state, completed cases, failures, and final timestamp. `results/simulation-smoke.json` preserves the initial passed ten-case run. Do not continuously poll with Codex.

This milestone supports synthetic execution with local Ollama generation. Inference cancellation is checked with real local HTTP requests; live ADB and account mutations remain separate adapters. The prior live post remains unconfirmed.


## Reconnect / Recover

Each relay device route accepts one controller connection. An existing desktop/ADB session can block a separate diagnostic even when the phone's TLS probe succeeds. Release the existing device connection before running an independent remote smoke test; do not infer a phone or USB dependency from that failure. On 2026-09-21, releasing only SM-A426U's occupied controller socket restored unplugged remote ADB/Chrome without phone changes. The current status API does not report controller occupancy.

All in 0.9.0 re-arms its wireless-debugging enable attempt after a discovered TLS listener remains ready for 30 seconds. A later disabled setting can then recover without reconnecting Wi-Fi. An unsuccessful enable request is not repeated until recovery is explicitly reset or Wi-Fi disconnects; Android network approval remains manual. Disable the app's recovery switch to intentionally keep wireless debugging off. This version's live drop-recovery check is separate from reboot acceptance.

All in 0.7.0 adds relay startup before first unlock using `LOCKED_BOOT_COMPLETED` and a Direct Boot aware service. On upgrade, unlock once and start All in to migrate existing relay configuration and mTLS files into app-private device-protected storage. Confirm the same enrolled identity reconnects before rebooting. Browser account data is not moved; Chrome/home launch endpoints require manual user unlock. Explicitly stopped relays remain disabled across boot. Existing desktop certificate provisioning is migrated when the relay starts again.

For a relay-specific reboot test, run `node scripts/verify-relay-boot.mjs <enrolled-device-id>` for preflight, then append `--reboot`. This requires an identity-verified USB device and at least 25% battery, issues one reboot, and observes authenticated VPS status for up to three minutes without launching the app or repairing ADB. Leave the phone locked. The report is `results/relay-boot-<device-id>.json`; preserve it before another run. A passing relay connection is separate from the reported ADB probe and does not establish full device readiness.

Remote restart acceptance requires power and internet only; USB-assisted recovery does not qualify. See [REBOOT_RECOVERY.md](REBOOT_RECOVERY.md) for the current platform constraint, observed test failure, and required provisioning decision. The diagnostic `node scripts/verify-reboot-readiness.mjs --reboot <enrolled-device-id>` explicitly reboots one identity-verified USB device and records unassisted state before USB repair.

After restarting the desktop to load the updated UI, select the phone and click **Reconnect / Recover** (available even for Offline). It first reconnects through the relay. If that fails, it tries only the enrolled USB/wireless ADB addresses, verifies the device hardware serial, restores All in's battery exemption and launches its supervisor via the app. Refresh status shortly afterward. Successful app launch is reported as recovery requested, not proof of relay connectivity.

All in 0.6.0 uses connectedDevice foreground service for persistent external-controller connectivity, replacing the time-limited dataSync declaration. The APK was installed and relay connectivity verified on the known Android 16 phone. Extended idle and reboot recovery remain to be validated. If the device has no reachable ADB route and its relay is offline, the controller cannot send a wake request; power/internet and an available phone-side supervisor are still required.

Focused check: `node scripts/test-recovery.mjs`. Live verification (requires exactly one identity-matched enrolled device): `node scripts/verify-relay-recovery.mjs`; append `--install` only when deploying the built APK. Evidence is saved to `results/recovery-live.json` without credentials.


## Simulation persona

The default simulation now uses Alex, the practical technology enthusiast. Restart the controller to load the new persona display. Edit `config/personas/practical-tech.json` between runs to change interests, exclusions, thresholds and voice. Templates are used only by explicit deterministic regression tests. Configuration is frozen per run. The event list explains decisions and skipped actions; only synthetic fixtures are affected. See `docs/SIMULATION_PERSONA.md`. Focused check: `npm.cmd run test:persona`.


## Contextual model sessions

Reviewer checks: `npm.cmd run test:contextual:review` and `npm.cmd run eval:contextual:review`. The latter uses the installed local model and writes `results/contextual-review-eval.json`. Reviewer evidence failures allow one review-only retry, then stop as `INVALID_REVIEW`; valid draft rejections are not retried. Batch reports separate reviewer failures from rejected drafts. Restart the controller to use the updated prompt in new sessions.

Start Ollama with an installed local model (default `qwen3.5:9b`) and restart the controller. Start automation now uses contextual generation; model/validation failures stop and produce a report without template fallback. Set `OLLAMA_MODEL` and `OLLAMA_BASE_URL` in `.env` to change the next session; only a loopback endpoint is accepted. The panel displays the selected brain. Refresh sessions and Load session report open previous runs. Full data flow, limits, report locations and commands are in [CONTEXTUAL_SIMULATION.md](CONTEXTUAL_SIMULATION.md).

## Detached contextual quality batch

For an unattended one-hour run: `node scripts/contextual-batch.mjs hour`. This launches a detached worker that first runs a fresh installed-model smoke, then the cancellation check, then repeats the varied scenarios until its one-hour wall-clock deadline. Failed smoke aborts the extended run. Session failures are recorded without within-session retries; subsequent independent sessions continue. The deadline cancels active work, allowing brief cleanup. Status/Stop use the same commands below.

Keep manual simulations idle while running this batch. All inputs are synthetic; only the configured local Ollama model is used.

```powershell
npm.cmd run test:contextual:batch
npm.cmd run contextual:batch:smoke
node scripts/contextual-batch.mjs status <smoke-id>
npm.cmd run contextual:batch:start
npm.cmd run contextual:batch:status
npm.cmd run contextual:batch:stop
```

Smoke and Start return a hidden detached worker PID and report path. Inspect the smoke once it has finished; Start requires a passing smoke with identical model settings and fixture version within the last hour. The batch first tests Stop during an active model request, then runs eight independent scenarios with two cycles each. Each session is limited to four minutes, so the full batch is bounded to roughly 39 minutes including completion margins; typical completion can be much faster. No model monitoring is required. Stop writes a durable marker, cancels the active owned session, and prevents further scenarios. The desktop Stop button controls only the current session; use the batch Stop command to stop the whole batch.

Evidence: `results/contextual-batches/<batch-id>/config.json`, `launch.json`, `report.json` and final `report.md`. The JSON report updates after each session and every ten seconds, with PID, active run ID, and heartbeat. Each session retains its ordinary JSON/Markdown report in `results/automation/<run-id>/`; the aggregate links them. `latest.json` identifies the latest full batch and `smoke.json` the latest smoke. The batch lease prevents duplicate launchers. An abrupt launcher exit may leave no final report; inspect launch PID, heartbeat and active session before recovery. Do not infer completion from a stale heartbeat or delete a lease while its worker is alive.

`passed` requires full scheduled completion, all three writing categories, valid skips and no within-session duplicate pairs, plus the initial cancellation check. `completed_with_failures` means scenarios finished but at least one acceptance condition failed. A model rejection stops its session; independent scenarios continue once each without retry or fallback. The report categorizes quality, duplication, validation and execution failures. Review the recorded drafts and reviewer reasons before any live-adapter work. Model review judgments are not human quality ratings.
