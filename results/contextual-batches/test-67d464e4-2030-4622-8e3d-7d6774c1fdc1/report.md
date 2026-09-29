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
    "medianMs": 155,
    "p95Ms": 168,
    "maxMs": 168
  },
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 959,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/463b028f-cff2-4f1c-88ca-0d2428d6aa1d/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/cefd6e06-1c42-45ac-b437-8c0800a0ad68/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/00788c4f-9d52-484c-9c75-d7870a21bc7a/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/a48e00a2-c8fe-4821-ba8b-3343b92be540/report.md)