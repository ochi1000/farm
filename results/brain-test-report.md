# Local brain and live account test report

Status: **Incomplete live validation. Smooth end-to-end automation is not yet achieved.**

## Implemented

- Installed Qwen3.5 9B in Ollama; observed local inference running 100% on the GPU with an 8,192-token context.
- Added a replaceable brain interface, strict action validation, local-only endpoint configuration, CLI previews, and desktop AI draft controls.
- Added pinned comment targets, mobile account identification, DOM control activation for background Chrome, and authored-timeline verification.
- Preserved approval checks, daily limits, and idempotency. No automatic mutation retry.

## Verification

| Check | Outcome |
|---|---|
| Build / TypeScript | Passed |
| Brain tests | 3 passed |
| X tests | 13 passed |
| Desktop regression and draft routing | Passed |
| Live enrolled phone / wireless ADB | Connected |
| Live feed reading | Passed; two samples of 3 posts |
| Local draft generation | Passed after review and revision |
| Post preview | Passed |
| Live test post | One commit workflow attempted; page readiness timed out |
| Publication verification | Inconclusive: follow-up timeline returned zero posts |
| Live comment | Not attempted |

The post may or may not have been submitted. Do not duplicate it until its existence has been checked. No successful live post or comment is claimed. No live like or follow was attempted in this milestone.

## Remaining work

Resolve profile/compose readiness in the background Chrome session, reconcile the possible test post, then finish the authorized comment test. The planner currently proposes one action at a time; it is not a persistent conversational agent or unattended account manager.

Machine-readable evidence: `results/brain-live-report.json`. X test evidence: `results/brain-x-tests-final.log`. Private draft and account binding remain in `.automation/brain-live-plan.json`; no authentication material is included in this report.
