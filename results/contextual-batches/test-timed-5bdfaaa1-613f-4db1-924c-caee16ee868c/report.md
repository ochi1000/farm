# Contextual batch

State: **completed_with_failures**

Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.

Aggregate:

```json
{
  "qualitySessions": 1,
  "fullyCompletedSessions": 1,
  "completedCycles": 1,
  "requestedCycles": 1,
  "validSkips": 7,
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
  "invalidReviewAttempts": 0,
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

- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/82d7aa54-d1b0-43dd-90ae-170f4a578fbe/report.md)