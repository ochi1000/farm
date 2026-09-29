# Repository Agent Instructions

Read `docs/PROJECT_STATE.md` and `docs/RUNBOOK.md` before changing or operating this project. Treat those files as the durable handoff between chats. Use `README.md` for detailed feature documentation.

## Project Boundary

This repository implements a distributed physical Android device lab:

- Android supervisor app (`All in`) for relay connectivity, health, reconnection, and wake-lock support.
- VPS relay with mTLS phone ingress, authenticated status, per-device ADB routes, enrollment, and revocation.
- Windows Electron controller for enrollment, online/offline status, SSH-backed remote ADB, and embedded scrcpy views.
- ADB and Chrome DevTools Protocol workflows for authorized browser testing on enrolled lab devices.

Keep changes aligned with remote device administration and authorized application or browser testing. Do not bypass Android secure locks, capture credentials, or store browser authentication material.

## Required Workflow

1. Read the current state and the files relevant to the requested subsystem.
2. Inspect existing changes before editing. Do not overwrite unrelated user work.
3. State the expected outcome and concrete success criteria for substantial work.
4. Make the smallest coherent implementation that matches existing patterns.
5. Run focused tests first. Broaden testing only when risk or failures justify it.
6. Update `docs/PROJECT_STATE.md` after a meaningful implementation, deployment, live-device test, changed blocker, or architecture decision.
7. Put verbose logs and machine-readable test evidence in `results/`; summarize only high-signal results in chat.

Never write secrets to documentation, source control, command output summaries, or reports. This includes relay tokens, SSH passwords, private keys, PKCS#12 passwords, X credentials, cookies, and authorization headers. `.env.example` must contain placeholders only.

## Credit-Aware Execution

Before work expected to consume substantial model or tool usage, emit this exact prefix in a short user update:

`CREDIT NOTE: `

Use it when a request includes any of these:

- More than about 15 minutes of active investigation or interactive monitoring.
- A full-repository audit, broad redesign, or many independent implementation areas.
- Multiple physical devices, repeated GUI inspection, or extensive screenshots.
- A test lasting 30 minutes or more.
- Repeated network polling, large logs, or an expected high number of tool calls.

After the note, reduce usage by splitting the work into a focused milestone, using deterministic scripts for repetition, and writing evidence to files. Long tests must run as detached processes with periodic machine-written status and a final report. Do not keep a model turn open to watch an idle timer or poll continuously. Run a short smoke test before an extended test.

Use `FRESH CHAT RECOMMENDED: ` when any of these are true:

- A major milestone is complete and the next request moves to another subsystem.
- The conversation has accumulated several completed implementation phases or has already required context compaction.
- Reconstructing current truth from chat is less reliable than reading repository state.
- The next request is independently large and does not need detailed turn-by-turn history.

Before emitting that signal, update `docs/PROJECT_STATE.md` with:

- completed work and changed files;
- verification commands and results;
- live infrastructure or device state that was actually observed;
- unresolved failures or blockers;
- the next concrete objective and its acceptance criteria.

Do not paste the old conversation into memory. Record only current facts and decisions. Do not interrupt an unfinished, feasible implementation solely to recommend a new chat.

## Test Strategy

Use these focused checks where applicable:

```powershell
npm run typecheck
npm run test:x
npm run test:desktop
node scripts/test-fleet-relay.mjs
```

Live-device and VPS tests require explicit device availability and configured credentials. Never interpret a unit or simulated test as proof that live infrastructure is online.

For long runs, write a heartbeat/status file no more frequently than needed and a final JSON report. A later chat should inspect that report instead of replaying the run.

