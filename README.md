# Android X Invisible Automation POC

Small proof of concept for determining whether one real Android Chrome/X session can be observed and minimally navigated from a Windows PC while the phone is screen-on, screen-off, Chrome-backgrounded, and screen-off plus backgrounded.

This project deliberately does not post, reply, like, follow, change account settings, store browser credentials, extract cookies, bypass lock screens, or add AI infrastructure. Remote access is limited to authenticated device-lab administration.

## Project Continuity

Repository memory is kept in these files instead of relying on one long chat:

- `AGENTS.md`: stable implementation, verification, security, and credit-usage rules.
- `docs/PROJECT_STATE.md`: current architecture, implemented capabilities, evidence, limitations, and next objective.
- `docs/RUNBOOK.md`: concise setup, operation, verification, and recovery steps.
- `results/README.md`: report and detached long-test conventions.

To continue in a fresh chat, use:

```text
Read AGENTS.md, docs/PROJECT_STATE.md, and docs/RUNBOOK.md. Continue from the recorded next objective. Verify live device and VPS state instead of assuming it.
```

Agents signal unusually expensive work with `CREDIT NOTE:` and signal a clean context boundary with `FRESH CHAT RECOMMENDED:`. Before recommending a fresh chat, the agent updates `docs/PROJECT_STATE.md` so the next chat does not need the prior transcript.

## Prerequisites

- Windows 10/11
- Node.js 20+ and npm
- Android Platform Tools with `adb` on `PATH`
- One Android phone connected over USB
- Developer Options and USB debugging enabled
- The Windows PC approved in the phone's RSA debugging prompt
- Chrome installed on the phone
- X already logged in manually in Chrome

Run:

```powershell
adb version
adb devices -l
node --version
npm --version
```

## Setup

```powershell
npm install
```

Optional environment:

```powershell
Copy-Item .env.example .env
```

`X_START_URL` defaults to `https://x.com/home`.

## Commands

```powershell
npm run preflight
npm run test:baseline
npm run test:background
npm run test:locked
npm run test:matrix
npm run test:screen-off-view -- <adb-serial>
npm run test:matrix -- --serial <adb-serial>
npm run test:matrix -- --pause-ms 3000
```

### Screen-Off Viewing Behavior

Run the Chrome screen-off capability check with an authorized ADB serial:

```powershell
npm run test:screen-off-view -- 10.0.0.214:5555
```

The test turns the physical display off, verifies that Chrome's DOM remains accessible through CDP, attempts a browser-frame capture, and restores the display in a `finally` block. These are separate capabilities:

- CDP DOM inspection and automation can continue while the display is off.
- Chrome's compositor may stop producing screenshot/screencast frames while the display is truly asleep.
- For continuous visual monitoring with the physical panel dark, use scrcpy with `--turn-screen-off`. This keeps Android's capture and network path active while turning off the device panel.

Example:

```powershell
scrcpy --serial 10.0.0.214:5555 --turn-screen-off --max-fps 30
```

Full device sleep is not compatible with a continuous live stream because the device must continue encoding and transmitting frames.

The All in foreground service holds a partial CPU wake lock so relay heartbeats, reconnection, and streaming support can continue while the physical display is off. `Run ADB Setup` also adds `com.ocorp.xrunner` to Android's device-idle whitelist when the connected device permits it. This increases battery use and does not bypass an explicit force-stop, user service stop, OEM task killer, or device shutdown.

Pressing the hardware lock button still locks and powers off the primary display. A normal full-display mirror may therefore go black. Use the isolated Chrome virtual-display command below when Chrome must remain independently visible.

To give Chrome its own live display while the owner uses another app on the primary display, start an ADB-backed virtual display:

```powershell
npm run view:background-chrome
```

If multiple ADB devices are connected:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-background-chrome-view.ps1 -Serial YOUR_DEVICE_SERIAL
```

This launches Chrome on a separate 720x1600 virtual display and streams that display with scrcpy. CDP can control the Chrome DOM on the virtual display while the primary display remains on another app or is turned off. The device must remain powered and connected; only the physical panel may be off during a live stream.

## Phone Relay Android App POC

The `android-x-runner/` project is now a relay/supervisor app. X stays in the real Chrome app because WebView login is blocked by X.

- package: `com.ocorp.xrunner`
- app label: `All in`
- keeps a foreground service running
- holds a partial CPU wake lock while the relay is active
- requests restart after reboot and a device-idle exemption during ADB setup
- exposes a localhost-only HTTP API on port `8765`
- supports `/health`, `/chrome/open`, `/home`, `/adb-probe`, `/relay/start`, `/relay/stop`, and `/relay/status`
- does not host X in WebView
- does not control Chrome DOM by itself

Build:

```powershell
npm run android:build
```

Install/start with one ADB device attached:

```powershell
npm run android:install
npm run android:start
npm run android:forward
npm run android:health
npm run android:adb-probe
npm run android:chrome-open
```

Chrome remains the authenticated browser. The relay app helps start Chrome, send the phone home, report status, probe local ADB, and maintain an outbound server connection. DOM control of X still happens through ADB/CDP from the external controller.

### Phone-Side Relay Client

The app includes a first relay-client milestone. It can:

- probe whether local ADB TCP is reachable at `127.0.0.1:5555`
- open an outbound mutually authenticated TLS connection to your server
- send a `hello` message
- send periodic heartbeats with ADB-probe status
- reconnect automatically with exponential backoff after Wi-Fi/mobile-data loss
- keep a persistent device ID and saved relay configuration across app process restarts
- respond to an ADB probe frame from the relay server

Start the secure relay through the local ADB-forwarded app API after provisioning its certificates:

```powershell
npm run android:forward
Invoke-RestMethod "http://127.0.0.1:8765/relay/start?host=YOUR_SERVER_HOST&port=8443&token=DEV_TOKEN&tls=true"
npm run android:relay-status
```

`tls=false` is no longer used by the deployed relay. The server permits plaintext only when explicitly started with `ALLOW_PLAINTEXT_RELAY=true` for an isolated local test.

### Secure VPS Relay

Generate a private CA, a VPS certificate, and one client identity tied to the phone's persistent device ID:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/new-relay-pki.ps1 `
  -ServerHost 102.68.84.191 `
  -DeviceId YOUR_DEVICE_UUID
```

The files are created under `.desktop-data/pki`, which is excluded from source control. Back up `ca.key.pem` securely and never copy it to the VPS or phone.

Copy only these files to `/opt/all-in-relay/pki` on the VPS:

```text
ca.cert.pem
server.cert.pem
server.key.pem
```

The phone receives only `ca.cert.pem`, its own `devices/<device-id>/client.p12`, and the generated `client-password.txt`. The desktop app's `Provision mTLS to Phone` button installs them in the app-private directory over the initial authorized ADB connection.

On the Linux VPS, install Node.js 20+, copy `scripts/relay-server.mjs`, and configure `/etc/all-in-relay.env`:

```bash
RELAY_HOST=0.0.0.0
RELAY_PORT=8050
STATUS_HOST=0.0.0.0
STATUS_PORT=8051
CONTROLLER_HOST=127.0.0.1
CONTROLLER_PORT=15555
DEVICE_ID=YOUR_DEVICE_UUID
TLS_CERT_PATH=/opt/all-in-relay/pki/server.cert.pem
TLS_KEY_PATH=/opt/all-in-relay/pki/server.key.pem
TLS_CA_PATH=/opt/all-in-relay/pki/ca.cert.pem
RELAY_DEVICE_TOKENS='{"YOUR_DEVICE_UUID":"YOUR_UNIQUE_RANDOM_TOKEN"}'
```

Create the service account and directories before copying the files:

```bash
sudo useradd --system --home /opt/all-in-relay --shell /usr/sbin/nologin allin-relay
sudo install -d -o allin-relay -g allin-relay /opt/all-in-relay/pki
```

Run it with systemd so it restarts after failure or reboot:

```ini
[Unit]
Description=All in secure phone relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=allin-relay
EnvironmentFile=/etc/all-in-relay.env
ExecStart=/usr/bin/node /opt/all-in-relay/relay-server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Store this as `/etc/systemd/system/all-in-relay.service`, restrict the private files, and start it:

```bash
sudo chown -R allin-relay:allin-relay /opt/all-in-relay
sudo chmod 600 /opt/all-in-relay/pki/server.key.pem /etc/all-in-relay.env
sudo systemctl daemon-reload
sudo systemctl enable --now all-in-relay
sudo systemctl status all-in-relay
```

Allow public inbound TCP `8050` and `8051`. Do not allow public inbound `15555`; it remains reachable only through SSH. The status endpoint uses HTTPS and bearer authentication:

```text
GET https://VPS:8051/devices/DEVICE_UUID/status
Authorization: Bearer DEVICE_TOKEN
```

The relay ingress and status API both require a trusted client certificate plus the matching per-device token. The certificate CN must equal the requested or claimed device ID.

The relay server now includes the first byte-for-byte ADB tunnel:

```text
phone app -> VPS public port 8050
VPS localhost controller port 15555 -> phone local ADB 127.0.0.1:5555
```

### Remote ADB and scrcpy

Configure public-key SSH login to the VPS. In the desktop app enter the VPS SSH username and local private-key path, then select `Connect VPS ADB`. It runs the hidden tunnel equivalent of:

```powershell
ssh -N -T -i PATH_TO_PRIVATE_KEY -L 15555:127.0.0.1:15555 SSH_USER@102.68.84.191
adb connect 127.0.0.1:15555
```

Create a dedicated key on Windows if one is not already available. The public key goes in the VPS account's `~/.ssh/authorized_keys`; the private key stays on this PC:

```powershell
ssh-keygen -t ed25519 -f "$HOME\.ssh\all_in_relay"
ssh -i "$HOME\.ssh\all_in_relay" SSH_USER@102.68.84.191
```

The second command must log in successfully without prompting for an account password before the desktop app can create a hidden, non-interactive tunnel. A private-key passphrase requires an active `ssh-agent` with that key loaded.

Once connected, the local forwarded port is a normal ADB serial. The desktop app starts the matching scrcpy server through that serial and renders the stream inside its Live views panel.

```powershell
npm run test:locked -- --serial 127.0.0.1:15555
```

Keep `CONTROLLER_HOST=127.0.0.1`. SSH authenticates the desktop and encrypts the controller hop; mTLS authenticates and encrypts the phone hop.

### Why USB Is Still Needed Initially

USB is still needed for bootstrap:

```powershell
adb -s YOUR_DEVICE_SERIAL tcpip 5555
```

That command tells Android's ADB daemon to listen on TCP port `5555`. A normal Android app cannot enable or pair ADB by itself. After that, the phone-side relay app tests whether it can reach `127.0.0.1:5555`; if it can, it can relay that ADB connection outward to your server.

The controller flow then becomes:

```text
Node controller
  -> VPS localhost controller port 15555
  -> encrypted outbound tunnel from phone app
  -> phone local ADB TCP :5555
  -> adb forward to Chrome DevTools socket
  -> CDP
  -> real Chrome X tab DOM
```

So the DOM control is still Chrome/CDP. The relay only replaces the physical USB/network reachability piece.

## Desktop ADB Connector

The desktop now keeps an inventory in `.desktop-data/devices.json`, migrating the previous single-device configuration on first use. Select a row to view that phone or Chrome, open All in, or connect remotely. Add/edit dialogs contain the preparation and certificate tools. Status refresh distinguishes offline devices from unavailable status checks. Explicit ADB selections never fall back to another phone.

Each enrolled phone now has a persistent VPS loopback route and an independent SSH/ADB connection. Existing devices retain port 15555; additional devices receive unused ports. The mTLS status response supplies the route for that device, so the desktop never guesses the destination.

Use Add device, choose the detected USB-authorized phone by model, enter a friendly name, and click Set up device. The dialog rescans automatically while it is open. Enrollment discovers the persistent device identity and wireless address, installs All in, creates or reuses the token and certificates, registers an independent VPS route, provisions the phone, and verifies mTLS connectivity. Technical connection values remain in the local inventory instead of being exposed in the normal setup flow. Failed enrollment retains a pending record for retry. The VPS registry is saved at `/opt/all-in-relay/relay-devices.json`; back it up with the server configuration. Adding devices does not restart existing connections. The enrollment API listens only on VPS loopback port 8052 and is reached through the SSH helper, not a public firewall port.

Use Remove device from the selected-device panel to de-enroll a phone. After confirmation, the desktop stops its viewer and SSH tunnel, stops the phone relay when the phone is locally reachable, revokes the VPS token and route, removes the local inventory entry, and deletes that device's local client credentials. The VPS keeps a token-free revocation marker so legacy seed settings cannot restore access after restart. A deliberately re-enrolled phone receives a new token and can reuse its previous controller port.

Viewing is off after enrollment, dashboard startup, and ADB connection. Phone and Chrome explicitly start an embedded stream for the selected device; switching modes replaces that device's existing stream. Chrome uses an isolated Android virtual display. View all starts a physical-screen stream for every registered online phone and shows the streams together in the Live views gallery. Mouse or touch input on a canvas is sent to its corresponding Android display. Stop / Stop all views close the streams while leaving the relay available. Closing the desktop closes its viewers and SSH tunnels. Streams use a 1280-pixel maximum dimension, 20 FPS limit, no audio, and hardware decoding; practical capacity depends on network bandwidth and desktop GPU resources.

Validation commands: `node scripts/test-fleet-relay.mjs` exercises multiple simulated phones, routing isolation, reconnect and registry persistence; `node scripts/test-fleet-ui.mjs` checks the dashboard. `node scripts/test-fleet-live.mjs` reinstalls/provisions the connected lab phone and briefly opens then closes live viewers.

The `desktop/` app is the Electron device inventory, connection, and viewing controller. It can:

- detect whether an Android device is connected
- report friendly states like `No devices found`, `Device found`, and `ADB TCP connected`
- check whether `com.ocorp.xrunner` is installed during setup
- install or update the Phone Relay APK during USB setup
- start the Phone Relay app during setup
- enable ADB TCP mode on port `5555`
- open the All in app on the connected device
- open Chrome on an isolated, remotely viewable virtual display
- generate and provision per-device mTLS credentials
- configure and persist the secure phone-to-VPS relay connection
- open a key-authenticated SSH tunnel to VPS-local ADB port `15555`
- connect ADB and render phone or isolated-Chrome scrcpy streams inside the desktop UI
- display and control multiple device streams in one gallery
- show VPS-backed device online/offline status, refreshed every 15 seconds

Run it on Windows:

```powershell
npm install
npm run desktop
```

To launch without a visible terminal, double-click:

```text
scripts\start-desktop-hidden.vbs
```

Device selection:

```text
ADB serial: automatically uses the single authorized phone connected over USB
```

The serial field can be left blank. If an old serial is entered but only one authorized phone is connected, the desktop app switches to that phone automatically. Enter a serial explicitly only when multiple physical devices are attached.

Recommended flow:

```text
Check Device
Run ADB Setup
Open All in
```

`Run ADB Setup` performs the bootstrap sequence in this order:

```text
detect authorized phone
check Phone Relay install
install/update the APK
open Phone Relay
save the relay host, per-device token, and persistent device ID
enable ADB TCP on port 5555
```

Setup also adds both All in and Chrome to Android's device-idle allowlist. This is required for Chrome to load a newly opened X tab while the physical display is off; the All in wake lock alone does not exempt Chrome. The setting allows additional background CPU/network use and can increase battery consumption, so it is intended for enrolled lab devices.

Fresh X tabs can take longer to populate while the display is off. `X_READY_TIMEOUT_MS` defaults to 45 seconds and controls feed-readiness waiting separately from the normal CDP/navigation timeout.

Readiness uses one-second timer polling instead of animation-frame polling because Android Chrome can suspend animation frames for background or screen-off tabs even while their DOM continues loading.

`CHROME_SCREEN_OFF_LAUNCH_DELAY_MS` defaults to eight seconds. It gives Android Chrome time to create and initialize its fallback page target before the controller navigates that target to X through CDP.

### Android Background Service Notice

Observed on the S22+: when `Phone Relay` is minimized, Android shows a system notice/modal that the app is running in the background, with options to stop it or leave it running.

This is expected Android foreground-service behavior. The relay app uses a foreground service so it can keep an outbound relay/status connection alive. Android intentionally makes that visible to the device user and may let the user stop it from the foreground-service task manager on Android 13+.

Operational implications:

- The app cannot be fully invisible on a normal, unmanaged Android phone while using a foreground service.
- The user may be able to stop the service from Android system UI.
- For dedicated phones, use device-owner/MDM policy if tamper resistance is required.
- For reliability, request battery optimization exemption and keep the service notification clear and boring.
- If the service is stopped, remote relay/heartbeat stops until the app/service is restarted by user, ADB, FCM allowance, boot receiver, or device-owner policy.

POC finding: X rejected WebView login with `Sorry, you are not allowed to login at this time`, even after the app used a normal Chrome mobile user agent. Treat WebView login as blocked for this project.

Viable pivots:

- Use the already-authenticated Chrome/CDP path. This passed background and screen-off DOM control tests.
- Use a dedicated-device/kiosk style setup where Chrome remains installed/running and a controller keeps it in a known state.
- Use official X API/OAuth for account actions if the goal becomes API automation rather than browser-session observation.

## Test Behavior

The matrix runs:

- `T1 baseline`: screen on, Chrome foreground, observe -> scroll -> observe -> open post -> back
- `T2 screen off`: screen off, observe -> scroll -> observe
- `T3 Chrome background`: screen on, Chrome backgrounded, observe -> attempt scroll/open -> observe
- `T4 screen off + background`: screen off and Chrome backgrounded, observe -> attempt scroll -> observe

`npm run test:background` is a focused visible-debug command for the real background question. It opens X only long enough to make Chrome/X ready, presses Home to background Chrome, then observes and scrolls via CDP/DOM without opening a post or sending foreground input clicks.

`npm run test:locked` uses the same CDP/DOM approach, then backgrounds Chrome and turns the screen off before observing and scrolling. It does not unlock the phone or bypass lock-screen security.

If the baseline fails, the matrix stops because the background findings would not be meaningful.

At the end, the runner attempts to wake the phone and bring Chrome back to a normal reachable state. It does not unlock the phone or bypass Android security.

## X Workflow Controller

The controller can inspect an authenticated X session in Android Chrome and run bounded, semantic operations. Feed reads and scrolling run immediately. Follow, like, comment, and post operations are previews by default and require an approval token for commit mode.

The phone relay carries ADB bytes only. Task validation, daily budgets, idempotency, audit records, Chrome/CDP control, and screen-state restoration remain on the controller.

Fleet status distinguishes `Ready` (relay and ADB both available), `Relay only` (phone heartbeat available but its local ADB daemon is off), and `Offline`. A `Relay only` phone needs one USB setup pass to re-enable ADB TCP before remote viewing or browser tasks can start.

Current operations:

- `read_feed`: return summaries of visible posts.
- `scroll_feed`: perform one to five DOM scrolls, then return visible posts.
- `follow_user`: inspect or follow one allowlisted username.
- `like_post`: inspect or like one visible post.
- `comment_post`: inspect or submit reviewed text to one visible post.
- `create_post`: inspect or submit reviewed post text.

Run a read-only task against the SM-A156U after its remote ADB route is connected:

```powershell
npm run x:task -- --serial 127.0.0.1:15566 --device 6345c448-d036-465a-a784-3ba5842cf024 --account x-lab-account --action read_feed --limit 5 --close-tab
```

Preview an account-changing operation without clicking the control:

```powershell
npm run x:task -- --serial 127.0.0.1:15566 --device 6345c448-d036-465a-a784-3ba5842cf024 --account x-lab-account --action follow_user --username example
```

Commit mode requires `X_AUTOMATION_APPROVAL_TOKEN`. Follow commits also require the normalized target in `X_ALLOWED_USERS`; comment and post commits require a unique `--idempotency-key`. The desktop app passes the entered approval token through the child-process environment instead of exposing it in the command arguments.

The intermittent test is deliberately read-only. It alternates feed reads and a single scroll, closes the X tab after each cycle, waits 7-15 minutes, stops on login/security/rate-limit interruptions, and writes a JSON report under `results/`:

```powershell
npm run x:test:intermittent -- --serial 127.0.0.1:15566 --device 6345c448-d036-465a-a784-3ba5842cf024 --account x-lab-account --duration-minutes 180 --min-wait-seconds 420 --max-wait-seconds 900 --max-cycles 18
```

If the physical display was off when a task started, the runner leaves it off. CDP can operate a loaded Chrome page while the display is off, provided Android has not stopped Chrome or the relay; screen streaming still shows the lock screen or a blank frame and cannot reveal a background Chrome tab. Secure lock screens are never bypassed.

Operational rules:

- Use the existing Chrome profile without fingerprint or user-agent modification.
- Keep one active controller session per account and device.
- Observe before account changes and verify afterward.
- Use idempotency and strict daily action budgets.
- Do not automatically retry account-changing operations.
- Stop for login, identity, security, rate-limit, or account-status prompts.
- Keep X authentication manual and do not store X passwords.
- Use varied scheduling only to distribute work, not to conceal automation.
- Require human review of comments and posts before submission.
- Prefer supported X APIs when they cover the authorized workflow.

## Results

Each run writes a timestamped JSON file in `results/`. Visible text samples are truncated. Cookies, local storage, authorization headers, and credentials are never logged.

Result shape:

```json
{
  "runId": "run-2026-08-25T12-00-00-000Z",
  "serial": "R58M...",
  "startedAt": "2026-08-25T12:00:00.000Z",
  "finishedAt": "2026-08-25T12:01:00.000Z",
  "results": [
    {
      "testName": "T1 baseline",
      "startedAt": "2026-08-25T12:00:01.000Z",
      "finishedAt": "2026-08-25T12:00:20.000Z",
      "phoneState": { "screen": "on", "chrome": "foreground" },
      "steps": [
        { "name": "observe initial", "status": "PASS", "startedAt": "...", "finishedAt": "...", "details": {} }
      ],
      "status": "PASS"
    }
  ]
}
```

## Troubleshooting

- If `preflight` cannot find exactly one device, pass `--serial`.
- If the phone is locked, unlock it manually before running baseline. The POC will not bypass lock screens.
- For the first visible/debug run, close unrelated Chrome tabs on the phone if possible. The controller prefers a loaded X tab, but fewer tabs make CDP target selection easier to verify by eye.
- If Playwright cannot attach to Android Chrome, the result is a platform limitation for this control mechanism. Replace the browser adapter before expanding the platform.
- If background tests fail while baseline passes, that is useful output. The goal is to identify actual Android/Chrome behavior, not force every condition to pass.


## Local Ollama action planner

Install a local model with `ollama pull qwen3.5:9b`. Configure `OLLAMA_MODEL` to swap model tags and `OLLAMA_BASE_URL` to change the loopback endpoint (default `http://127.0.0.1:11434`). Inference uses the local Ollama chat API with a validated JSON schema; no account credentials or approval tokens are included in prompts. Observed post text is sent only to the local model. Cloud tags and non-loopback endpoints are rejected.

In **X operation**, enter an instruction and choose **Prepare local AI draft**. The planner reads up to ten posts and prepares one action. Review the proposed text and target, then use the existing preview/approved-action controls. Generating a draft clears commit selection and never submits a mutation. Comment targets are pinned to an observed post URL. Instructions needing clarification do not execute an action.

CLI preview:

```powershell
npm.cmd run brain:task -- --serial <adb-serial> --device <device-id> --instruction "Read the feed and draft a relevant comment"
```

The brain CLI is preview-only. Commit reviewed text through the existing X operation controls or `x:task`; existing tokens, daily limits, allowlisted follows and idempotency remain enforced. `x:task` accepts `--post-url https://x.com/<handle>/status/<id>` for a pinned comment target. Posts and comments require matching authored text on the signed-in account's timeline before reporting verified success. An unverified submission may already exist: inspect the timeline and never retry automatically.

Checks: `npm.cmd run test:brain`, `npm.cmd run test:x`, and `npm.cmd run test:desktop`. The `Brain` interface in `src/brain/ollama.ts` separates planning from execution. This milestone is a single-action planner, not a persistent conversational agent or unattended account manager.


Contextual simulation: the controller Start/Stop panel now runs persona target selection and local Ollama reviewed writing against synthetic fixtures, with per-session reports and history. See [contextual simulation architecture and operation](docs/CONTEXTUAL_SIMULATION.md).

