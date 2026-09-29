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
    "medianMs": 163,
    "p95Ms": 199,
    "maxMs": 199
  },
  "invalidReviewAttempts": 0,
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 1013,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/7025dce7-2ab4-4405-a3dc-02c7a790f43b/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/7c192309-dc8b-4580-be02-351b159149ac/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/b04774c9-8a39-422e-88a9-43c4b6386ca8/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/19be8b6a-37e0-4210-978b-8ed76315bd42/report.md)