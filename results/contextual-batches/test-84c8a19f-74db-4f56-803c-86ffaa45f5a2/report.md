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
    "medianMs": 156,
    "p95Ms": 158,
    "maxMs": 158
  },
  "invalidReviewAttempts": 0,
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 938,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/2b8e7be6-e868-4fb7-800d-0aebdaad091b/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/f61b355a-bfb0-4504-9156-026146dc94dd/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/8dd714bf-f311-4139-9200-bef413e65423/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/d6d97b87-ae20-48e9-8ba3-edc42f7a0ee3/report.md)