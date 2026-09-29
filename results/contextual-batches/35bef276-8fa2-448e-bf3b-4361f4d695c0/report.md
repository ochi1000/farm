# Contextual batch

State: **passed**

Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.

Aggregate:

```json
{
  "qualitySessions": 1,
  "fullyCompletedSessions": 1,
  "completedCycles": 1,
  "requestedCycles": 1,
  "validSkips": 0,
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
    "medianMs": 1995,
    "p95Ms": 8719,
    "maxMs": 8719
  },
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 21046,
    "inputTokens": 3852,
    "outputTokens": 551
  },
  "liveSubmissions": 0
}
```

- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/a2b55b28-5311-422f-a149-2e982c0ebcdb/report.md)