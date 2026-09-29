# GeckoView / X feasibility probe

2026-09-28: user confirmed an unplugged phone reboot, manual unlock/app launch and no new credentials. Version 0.2 report reached home in a new app process, read 491 characters / 3 post-text elements and scrolled 0 -> 396 -> 792. Reboot login persistence passed once; automatic startup/background/remote execution remain untested. Next: network-change test with fresh Open X navigation.

## Version 0.2: persistent-session check (pending)

The new source uses GeckoView's normal app-private profile, with backup disabled. Gecko manages its own cookies; no code reads or exports browser authentication material. The user authorized persistent browser login as the next step. Earlier private-mode descriptions below apply to version 0.1 only. No automatic startup, background service or remote command channel is included in 0.2.

Build with the same command, then install with `adb install -r` as below (do not uninstall or clear data). Sign in once on the phone: version 0.1 private login is not migrated. Open X now loads `/home`. Record Outcome, Read and Save, then extract `report.json` to `results/gecko-persistence-before.json`. Tap **Close browser**, reopen Gecko Probe from its launcher icon and do not sign in again. If the timeline appears, record Outcome and Read/Save and extract to `results/gecko-persistence-reopen.json`. Share both reports and whether credentials were required. Each extraction uses the existing ADB command with the destination filename changed.

Reports have schema 2, appVersion 0.2, privateSession=false, random runId (new Activity) and processId (new app process), plus Activity lifecycle events. These identifiers contain no account/device identity. A new runId with the same processId proves Activity/session recreation only, not process restart. Changed processId is required for process-restart evidence. The report is replaced on each Activity creation: export baseline before reopening.

Acceptance for this step: new runId, user-confirmed signed-in timeline without re-entering credentials, and nonzero Read text counts after Close browser/reopen. Next user-run stages are process restart/reboot with manual launch after unlock, then network change. Manual launch after reboot would prove profile persistence, not automatic boot recovery. Successful reopening does not guarantee indefinite login retention; X can expire/revoke sessions. No claims about background command execution follow from this test.

Latest result (2026-09-22, user-provided report): initial feasibility PASSED. Manual sign-in confirmed, home route reached, Read extracted 519 characters across 4 rendered post-text elements, Scroll moved from 461 to 891. One unsupported popup occurred; its purpose is unknown. No login persistence/reboot/remote-control proof. Historical build status below is superseded by this live result.

User-run build succeeded (2026-09-22): Gradle SHA-256 verified, assembleDebug completed in 1m16s. Installation, X login and DOM access are NOT verified. Separate app: `com.ocorp.geckoprobe`. Existing All in and relay are unchanged. The earlier custom browser's rejection reason is unknown.

## Scope

Pass requires manual sign-in with a visible timeline, Read reporting nonzero visiblePosts/extractedCharacters, and Scroll changing scrollBefore/scrollAfter. If X scrolls an internal container, report observed movement separately. Loading a page is not login success. No posting, liking, replying, remote control or reboot test is included.

The session is private and does not intentionally persist login cookies. This tests compatibility, not sign-in retention. Private mode can affect login; failure does not prove GeckoView generally incompatible. Use X's direct manual login on the phone. Provider popups/passkeys are outside this minimal shell; their failure must not be described as X rejecting GeckoView.

## User-run steps

Run each stage and share results before continuing. Assistant must not start autonomous device/watch/fix sequences.

1. Build from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-gecko-probe.ps1
```

Build uses AGP 9.1.1, Gradle 9.3.1 and compileSdk 37; targetSdk remains 36 and minSdk 26. The launcher downloads/checksums Gradle into .tools when absent and reuses the existing SDK path. SDK platform 37 must be available (Gradle can download missing SDK packages when SDK licenses are already accepted). If a license/platform error occurs, share it before proceeding. GeckoView 155.0.20260903215306 resolved in the user's first build, but its AAR metadata rejected the initial SDK 36/AGP 8.10.1 setup. The corrected toolchain is pending user verification. Share the last 60 lines of `results/gecko-probe-build.log`, including `What went wrong` if above the tail.

2. After build succeeds, install and launch on the user-confirmed Samsung:

```powershell
adb -s R5CR90G9C9X install -r .\android-gecko-probe\app\build\outputs\apk\debug\app-debug.apk
adb -s R5CR90G9C9X shell am start -n com.ocorp.geckoprobe/.MainActivity
```

3. Tap Capture before sign-in. Enter credentials only on the phone. On an error, tap Capture while visible, then Outcome and the appropriate observation. Share the error wording with identifiers removed; do not repeatedly retry rejected login.

4. On successful sign-in, select Outcome > Signed in and timeline visible. Tap Read, Scroll, wait one second, then Capture and Save. Read measures rendered text extraction but exports only counts, not account content. Content export/assessment quality is a later milestone.

5. Extract only the report:

```powershell
adb -s R5CR90G9C9X exec-out run-as com.ocorp.geckoprobe cat files/report.json | Out-File -Encoding utf8 .\results\gecko-probe-report.json
Get-Content .\results\gecko-probe-report.json -Raw
```

Share ADB errors separately; they are not browser results.

## Reporting limits

- Engine version, userAgent, language, webdriver and secureContext describe local browser identity, not every signal X sees. No identity spoofing.
- page_start/page_stop indicate engine loading; load_error contains Gecko numeric error category/code, not an X rejection code.
- DOM snapshots contain visible post/text counts, password-field presence (never value), scroll positions and fixed English error-category flags from visible alerts/dialogs. Heuristics may miss errors or match unrelated text. Manual outcome remains separate evidence.
- bridge_unavailable/extension errors mean instrumentation failed; popup_not_supported/non_https_navigation_blocked mean this small shell lacks the requested navigation behavior.
- Report holds at most 100 events for the current Activity lifetime, overwritten on a new run. No credentials, cookies, tokens, field values, headers/bodies, account names, post text, full URLs or HTML. Do not share raw logcat, profiles or HAR files for this test.
- No HTTP login response inspection or knowledge of X's internal risk rules. IP reputation, account history and server-side decisions cannot be inferred from this report. If rejection reproduces, compare stock Firefox on the same phone/network with the same manual flow.

Built-in extension provides fixed capture/read/scroll commands using [Mozilla's native messaging bridge](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/web-extensions.html). See also the [GeckoView quick start](https://firefox-source-docs.mozilla.org/mobile/android/geckoview/consumer/geckoview-quick-start.html). This is not CDP. Passing does not establish reboot startup, background operation, network recovery or durable login.
