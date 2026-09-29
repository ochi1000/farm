# Contextual batch

State: **stopped**

Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.

Aggregate:

```json
{
  "qualitySessions": 1,
  "fullyCompletedSessions": 0,
  "completedCycles": 0,
  "requestedCycles": 1,
  "validSkips": 0,
  "invalidSkips": 0,
  "rejectedDrafts": 0,
  "failureCategories": {},
  "writingCategories": [],
  "withinSessionDuplicatePairs": 0,
  "crossSessionDuplicatePairs": 0,
  "responseLatency": {
    "count": 0,
    "medianMs": null,
    "p95Ms": null,
    "maxMs": null
  },
  "modelMetrics": {
    "requests": 0,
    "responses": 0,
    "latencyMs": 0,
    "inputTokens": 0,
    "outputTokens": 0
  },
  "liveSubmissions": 0
}
```

- garden (quality): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/ed76fa30-a44e-4367-976b-c4eb536e82cf/report.md)