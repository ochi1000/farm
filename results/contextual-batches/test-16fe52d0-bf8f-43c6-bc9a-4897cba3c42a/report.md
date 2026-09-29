# Contextual batch

State: **passed**

Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.

Aggregate:

```json
{
  "qualitySessions": 3,
  "fullyCompletedSessions": 3,
  "completedCycles": 3,
  "requestedCycles": 3,
  "validSkips": 14,
  "invalidSkips": 0,
  "rejectedDrafts": 0,
  "failureCategories": {},
  "writingCategories": [
    "comment_post",
    "reply_to_comment",
    "create_post"
  ],
  "withinSessionDuplicatePairs": 0,
  "crossSessionDuplicatePairs": 0,
  "responseLatency": {
    "count": 6,
    "medianMs": 160,
    "p95Ms": 170,
    "maxMs": 170
  },
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 968,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/51165301-804c-45b8-a3bc-3014391707a2/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/1ed37209-e4a6-46bc-bb37-16b8e699eb53/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/e75fb05f-5950-439e-bf0a-6c19f78a5ec5/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/f1426e17-0a32-4a6f-9a62-23f475f45139/report.md)