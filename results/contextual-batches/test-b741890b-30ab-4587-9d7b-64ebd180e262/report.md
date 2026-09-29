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
    "latencyMs": 961,
    "inputTokens": 120,
    "outputTokens": 60
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/95e9ef9c-a354-4ea3-b6a5-4f27c1a95440/report.md)
- garden (quality): completed; 1/1 cycles; 0 skips; no failure — [session](../../automation/59d273fc-2cac-4618-8df8-1de71c2c26c1/report.md)
- excluded (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/b77e51c7-3ad3-4e4b-a8e8-40053f5e151f/report.md)
- empty (quality): completed; 1/1 cycles; 7 skips; no failure — [session](../../automation/2f654ba1-8dc5-4272-8872-1fce3b58b6d6/report.md)