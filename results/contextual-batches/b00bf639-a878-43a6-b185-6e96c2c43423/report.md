# Contextual batch

State: **completed_with_failures**

Synthetic execution with local model judgments. Rejected drafts stop their session. Independent scenarios continue once each, without retry or fallback. Cross-session similarity is measured, not prevented. Response latency excludes failed/cancelled requests.

Aggregate:

```json
{
  "qualitySessions": 8,
  "fullyCompletedSessions": 6,
  "completedCycles": 13,
  "requestedCycles": 16,
  "validSkips": 45,
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
    "count": 41,
    "medianMs": 2925,
    "p95Ms": 3584,
    "maxMs": 3997
  },
  "invalidReviewAttempts": 1,
  "modelMetrics": {
    "requests": 41,
    "responses": 41,
    "latencyMs": 111423,
    "inputTokens": 27716,
    "outputTokens": 4128
  },
  "liveSubmissions": 0
}
```

- garden (cancellation): stopped; 0/1 cycles; 0 skips; no failure — [session](../../automation/b23e82d8-a9db-4062-9165-bfd4bd4d05bb/report.md)
- garden (quality): failed; 0/2 cycles; 0 skips; review_rejection — [session](../../automation/2781f821-e9ed-4a93-ac1c-6ba6ca80d48e/report.md)
- notes (quality): completed; 2/2 cycles; 3 skips; no failure — [session](../../automation/e5fc5525-bd98-48e6-b38e-d08aaf67659a/report.md)
- android (quality): failed; 1/2 cycles; 3 skips; review_rejection — [session](../../automation/7f961503-82b0-49a5-b0a5-66ff2be1560e/report.md)
- repair (quality): completed; 2/2 cycles; 3 skips; no failure — [session](../../automation/2e42f182-9678-41eb-9f7c-787aa3593672/report.md)
- science (quality): completed; 2/2 cycles; 5 skips; no failure — [session](../../automation/e3c381ef-6c80-4836-979f-a84a55c22a86/report.md)
- thread (quality): completed; 2/2 cycles; 3 skips; no failure — [session](../../automation/77747ad6-55d6-4d00-ab99-a42c4e42e554/report.md)
- excluded (quality): completed; 2/2 cycles; 14 skips; no failure — [session](../../automation/59565e86-fc7e-4632-8ad1-d0fe1b6d26fb/report.md)
- empty (quality): completed; 2/2 cycles; 14 skips; no failure — [session](../../automation/6b81d526-f48d-4a7a-9ae4-97ed7be4b431/report.md)