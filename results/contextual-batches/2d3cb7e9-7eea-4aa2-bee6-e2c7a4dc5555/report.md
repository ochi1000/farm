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
    "medianMs": 2138,
    "p95Ms": 3536,
    "maxMs": 3536
  },
  "invalidReviewAttempts": 0,
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 16458,
    "inputTokens": 3893,
    "outputTokens": 574
  },
  "liveSubmissions": 0
}
```

- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/55bb7346-a8c4-4121-9c13-07b549ce69b0/report.md)