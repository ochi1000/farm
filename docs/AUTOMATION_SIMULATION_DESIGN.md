# Automation simulation: start/stop milestone

Status: simulation lifecycle implementation delivered 2026-09-15; broader adapter design remains planned. This does not enable a live account run.

## Outcome

One Start automation button launches an independent batch. The controller displays progress as events arrive. Stop prevents further actions, performs bounded cleanup, and produces a report. Any execution error stops the batch and sends the error to the controller. Codex is needed for implementation or later diagnosis, not scheduling, monitoring, or reporting.

The first milestone proves lifecycle behavior using synthetic account data. It simulates application workflows, not concealment of automation or imitation of human timing. Long tests run detached after a short smoke test. No paid model calls or Codex monitoring occur during a run; optional Ollama generation consumes local compute.

## Controller flow

Select device or simulated device -> select test preset -> Start automation.

Show Start, Stop, and View report. Start is disabled while a run is active; Stop remains available during startup, inference, actions, and waits. An adjacent mode badge always says Simulation, Live read-only, or Live approved. Default for this milestone is Simulation.

Display run ID, state, elapsed time, current action, completed/total steps, simulated or verified action counts, latest event, heartbeat age, and last error. Keep the latest 200 events in the UI. On failure, show a persistent error banner with the failed step, outcome certainty, and report link. Do not open screenshots or stream video automatically.

Closing the controller does not stop the worker. Reopening restores active runs and catches up on missed events. Start/Stop requests carry command IDs so double-clicks and reconnection cannot create duplicate work. After termination, Start creates a new run; it never implicitly resumes an uncertain mutation.

## Process ownership

Controller renderer -> Electron main -> local supervisor -> one action worker at a time.

- A detached hidden Node supervisor owns run state, deadlines, cancellation, reports, and the action child process. It is independent of Electron and Codex.
- A short-lived child executes one step using either the simulated adapter or the live adapter. A hung action cannot block the supervisor heartbeat or Stop handler.
- For live remote runs, the supervisor owns its SSH tunnel. Extract shared connection logic from `desktop/fleet.cjs`; do not borrow a tunnel that Electron closes on exit.
- Acquire exclusive leases for both device and account before startup. Manual desktop mutations and other runners must honor the same leases. Reject duplicate starts rather than queueing them invisibly.
- Store PID plus a per-process instance ID; never kill a process merely because a stale file contains its PID. Reconcile ownership before reclaiming a lease.

Reuse the concepts in `scripts/long-run.mjs`, but preserve its existing command behavior during migration. Its current between-cycle stop flag, desktop-owned tunnel, and generic failure report do not satisfy the new acceptance criteria.

## Simulation sequence

The default preset is a fixed, reproducible sequence over synthetic posts and comments:

1. Initialize the simulated device/account and load a feed fixture.
2. View a post and record an observation.
3. Like that post; verify its simulated liked state.
4. Draft and submit one comment; verify its simulated parent post and text.
5. Read a fixture comment thread; select a comment by configured topic relevance.
6. Reply to that comment; verify its simulated parent comment and text.
7. Draft and create one standalone post; verify it in the simulated timeline.
8. Scroll and view another post; wait at an interruptible checkpoint.
9. Repeat until the preset cycle/action/duration limit, or stop/error.

Use a seed for fixture selection so a failed run can be reproduced. Default lifecycle tests use deterministic drafts and short fixed waits. An optional local-brain preset uses Ollama through the existing Brain interface, recording model tag and latency. Lifecycle correctness must not depend on model availability.

Future realistic workload presets may assign action weights and topic interests. Observe current state, choose an eligible action, validate it, execute once, verify, and then wait. No eligible target is a recorded skip, not an error. Every enabled action must have finite per-run limits; duration and action count both bound the run. Configurations are immutable once started.

## Adapter and planner contracts

Use versioned RunConfig, ActionRequest, ActionResult, RunEvent, and RunReport types. Configuration contains mode, device/account references, preset version, seed, enabled actions, limits, timeouts, and optional brain settings. Reports never contain secret values from configuration.

Action adapters implement prepare, execute, verify, and cleanup with an AbortSignal and an event emitter. Planning returns proposals only. The supervisor and policy layer retain authority over execution and budgets.

Actions: view_post, read_feed, scroll_feed, like_post, comment_post, read_comments, reply_to_comment, create_post. Map existing supported actions to XWorkflowRunner; implement missing view/thread/reply capabilities as separate adapters. Replying to a comment is not equivalent to commenting on a root post: persist and verify its exact parent identifier.

Result certainty is one of simulated, verified, skipped, failed_before_submission, or unknown_after_submission. Record a durable submission-intent entry before sending any live mutation and a verification entry afterward. Never retry an uncertain mutation automatically. Synthetic verification never counts as a live success.

## State and cancellation

States: starting -> running -> stopping -> stopped. Normal exhaustion produces completed. Any execution failure enters stopping with an error reason and ends failed after cleanup. A failure concurrent with Stop remains a failure in the report.

Proposed acceptance targets:

- Controller receives Start/Stop acknowledgement within one second under normal local load.
- Stop during a wait or model request cancels it; no next action starts after the supervisor accepts Stop.
- Before each submission, the worker requests a one-use submission permit from the supervisor. Stop revokes unused permits. If submission has already been dispatched, Stop cannot undo it; finish bounded verification and report the actual outcome.
- Allow up to 15 seconds of cooperative verification/cleanup after Stop. Then terminate only the owned action process tree and record forced termination. Unresolved submissions become unknown, never successful or safely cancelled.
- Simulation stops within two seconds at non-submission checkpoints. Live stop has a target upper bound of 20 seconds, including forced cleanup; record any overrun as a test failure.
- Ordinary action deadline: configurable, default 90 seconds; model request default 60 seconds. Exceeding either fails the run. Do not queue more actions after an error.
- Release leases only after confirming child termination. Close owned tabs/tunnels and restore supported device state where feasible. Record incomplete cleanup explicitly.

## Live updates and durable reports

Use a current-user-restricted Windows named pipe between Electron main and the supervisor. Forward events through the preload API. Pipe names contain a run instance ID; the handshake validates that instance. No broadly listening network API is needed.

Persist each event before emitting it. Events contain schemaVersion, runId, monotonically increasing sequence, timestamp, stepId, type, state, and sanitized summary. Types include starting, ready, action_started, draft_ready, submission_started, action_verified, action_skipped, waiting, stop_requested, error, cleanup, and finished. Heartbeat every 10 seconds; meaningful events are pushed immediately, not polled by Codex.

Reconnection requests events after the last acknowledged sequence. Delivery may repeat; the controller deduplicates by runId/sequence. Slow/disconnected clients cannot block execution: cap the outbound buffer and recover from the journal. If older events have rotated, send a snapshot plus a gap marker. Journal write failure is a run error and prevents new submissions.

Artifacts in `results/automation/<run-id>/`:

- `status.json`: atomically replaced snapshot, PID/instance, phase, heartbeat, counters, last error and report path.
- `events-*.jsonl`: bounded event journal, proposed maximum five 2 MB segments.
- `report.json`: structured final outcome, requested limits, timings, action counts, skips/errors, stop latency, cleanup state, and unresolved submissions.
- `report.md`: short human-readable summary generated by code from the JSON.

Use hashes and counts in exported reports instead of full account content. Exclude credentials, cookies, authorization headers, private connection configuration, and raw model prompts. On supervisor crash, a later controller start detects stale ownership and writes an interrupted/recovered report from durable events. A report cannot be guaranteed at the instant of total process or power failure; never fabricate a clean stop.

## First automated batch

A deterministic test launcher executes these cases and emits one aggregate report without interactive monitoring:

| Case | Required result |
| --- | --- |
| Normal sequence | Every simulated action verified; completed report |
| Stop immediately after Start | Startup cancelled; no action submitted |
| Stop while waiting | Stop within two seconds; no next action |
| Stop during inference | Request cancelled; no generated action executed |
| Stop before submit | Permit denied; no mutation |
| Stop after submit | Verification or explicit unknown; no duplicate |
| Inject failure at a chosen step | Error pushed; no later actions; failed report |
| Hung action child | Deadline enforced; owned child terminated; report saved |
| Repeated Start/Stop | One run per lease; idempotent command responses |
| Close/reopen controller | Worker continues; event replay restores display |
| Kill supervisor | Recovered interrupted report; no automatic mutation replay |

Acceptance requires process-level integration tests, not just mocked button callbacks. Each failure case must assert zero later submissions. Run a short simulated smoke first; extended repetition is detached with an aggregate progress file. Codex reads the completed report once when asked.

## Delivery order and live boundary

1. Supervisor, simulated adapter, event journal, Start/Stop UI, reports, fault-injection batch. No phone or Ollama required.
2. Optional local Ollama drafting with the same simulation. Test cancellation and invalid proposals.
3. Live read-only adapter and supervisor-owned connectivity. Verify controller closure and device disconnect behavior.
4. Bounded live mutations after resolving existing uncertain publication, with explicit run policy, reviewed content or approved content-generation scope, existing daily budgets and idempotency. Add thread/reply targeting before enabling replies.

The prior live post remains unconfirmed. This design does not repeat it or turn the earlier one-post/one-comment authorization into unlimited account activity. First-milestone simulation exercises all action categories without publishing them to X.


## Implemented first-milestone accommodations

The simulation uses an Electron-main file watcher (250 ms) over atomic status snapshots and a sequenced JSONL journal, forwarding events through preload IPC. This replaces the proposed named pipe for this filesystem-local milestone: no network endpoint or extra credential handling is introduced. Controller reconnection replays the latest 200 events; full bounded history remains on disk. A single synthetic-device/account lease serializes simulations; real-device leases and SSH ownership will be added with live adapters.

A maximum of 700 steps and finite events per step bound each run journal without rotation. Each child receives/returns the synthetic fixture state, keeping likes, comments, reply parents and timeline additions across steps. Cancellation tests include a simulated inference delay; actual Ollama planning is not part of this milestone. The supervisor polls its stop marker every 50 ms, cancels cooperative children, and kills only its owned child after a one-second grace period. Simulated children create no descendant processes. Supervisor disconnect makes children exit; a later status read recovers a dead supervisor as interrupted after its heartbeat becomes stale. Recovery does not claim confirmed cleanup.

Normal run, start/wait/inference/pre-submit/post-submit cancellation, injected error, hung action, event replay/reconnection and supervisor crash recovery have process-level checks. Actual controller event routing, reopening, Stop, report display and error banner have a browser integration check. Windows atomic snapshot replacement retries transient sharing violations for at most 205 ms.
