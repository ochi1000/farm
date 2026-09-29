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
    "p95Ms": 166,
    "maxMs": 166
  },
  "modelMetrics": {
    "requests": 6,
    "responses": 6,
    "latencyMs": 963,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/bbb68126-c240-4bac-b305-20654219b343/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/0da01c1a-12cd-44ac-a90b-8b354e24b4fb/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/6c451d65-71f5-4ea6-ba65-dc06dc66132f/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/3197bd55-d637-4eba-916e-4c1e6059aeb4/report.md)