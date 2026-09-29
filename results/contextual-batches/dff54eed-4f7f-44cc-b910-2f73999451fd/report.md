# Contextual batch

State: **completed_with_failures**

Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.

Aggregate:

```json
{
  "qualitySessions": 8,
  "fullyCompletedSessions": 6,
  "completedCycles": 12,
  "requestedCycles": 16,
  "validSkips": 42,
  "invalidSkips": 0,
  "rejectedDrafts": 2,
  "failureCategories": {
    "review_rejection": 2
  },
  "writingCategories": [
    "comment_post",
    "reply_to_comment",
    "create_post"
  ],
  "withinSessionDuplicatePairs": 0,
  "crossSessionDuplicatePairs": 0,
  "responseLatency": {
    "count": 36,
    "medianMs": 2891,
    "p95Ms": 3662,
    "maxMs": 4428
  },
  "modelMetrics": {
    "requests": 36,
    "responses": 36,
    "latencyMs": 99490,
    "inputTokens": 25162,
    "outputTokens": 3557
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/dfb0ac16-fd70-4533-8f24-bac5864af5b6/report.md)
- garden (quality): completed; 2/2 cycles; 3 skips; no failure — [session](../../automation/197639d7-c9d2-4a83-9871-10aeac80829d/report.md)
- notes (quality): completed; 2/2 cycles; 3 skips; no failure — [session](../../automation/ad2689e8-1286-4334-af21-d511e26d9d38/report.md)
- android (quality): failed; 0/2 cycles; 0 skips; review_rejection — [session](../../automation/4f76b0d4-9af4-474e-bbe5-319d0d3dc5e3/report.md)
- repair (quality): failed; 0/2 cycles; 0 skips; review_rejection — [session](../../automation/ba7744f4-c090-4b07-8569-eef451514b4a/report.md)
- science (quality): completed; 2/2 cycles; 5 skips; no failure — [session](../../automation/2d0e7567-b69a-4619-80ca-df5047bb1827/report.md)
- thread (quality): completed; 2/2 cycles; 3 skips; no failure — [session](../../automation/a35b905a-3d45-45bd-b4ed-be3d32cca73a/report.md)
- excluded (quality): completed; 2/2 cycles; 14 skips; no failure — [session](../../automation/cba6d06b-d986-4426-8ce2-2e84b81e84f3/report.md)
- empty (quality): completed; 2/2 cycles; 14 skips; no failure — [session](../../automation/6d12c8df-744e-4d88-b5f4-b735079302ba/report.md)