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
    "medianMs": 157,
    "p95Ms": 168,
    "maxMs": 168
  },
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 962,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/f82c1226-e02d-407e-bcff-7058c131c330/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/3203ce9d-55a0-47b0-810d-2853379109ce/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/3a0bd202-3bef-4f23-b1f9-18856e6e5fb2/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/39634d9a-cb33-47e1-a90f-322b8670bac0/report.md)