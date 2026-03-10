# Adaptive Rate Limit Backoff for PDF Import

## Problem

Importing a 19-page statement with Haiku triggers rate limits because 3 concurrent batches of 5 pages each front-load ~15 pages of image tokens in a single burst, exceeding TPM on lower API tiers.

## Solution

Smooth token consumption with inter-batch delays, and handle 429s gracefully with exponential backoff and increased retry patience. Provider-agnostic — works for Anthropic, OpenAI, Gemini, and custom providers.

## Design

### Constants (in `parse-statement.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `INTER_BATCH_DELAY_MS` | 1000 | Pause between batch dispatches (happy path) |
| `INITIAL_BACKOFF_MS` | 2000 | First retry delay after 429 |
| `MAX_BACKOFF_MS` | 30000 | Backoff cap |
| `MAX_RETRIES` | 3 | Per-batch retry attempts before surfacing error |

### Backoff formula

```
delay = min(INITIAL_BACKOFF_MS * 2^attempt, MAX_BACKOFF_MS) + random(0, delay * 0.5)
```

Doubles each retry (2s → 4s → 8s → 16s, capped at 30s) with 0–50% jitter.

### Behavior changes

1. **Inter-batch delay:** 1s `sleep()` between each batch dispatch in both concurrent and sequential paths. Spreads token consumption evenly across the rate window.

2. **Exponential backoff with jitter:** Replaces fixed 2s `RATE_LIMIT_BACKOFF_MS`. New `getBackoff(attempt)` helper computes delay.

3. **Retry budget:** Up to 3 retries per batch (up from 1). After exhausting retries, surfaces `rate_limited_with_fallback` error as before.

4. **Adaptive concurrency:** On first 429, drop to sequential (already exists, unchanged).

### Scope

- Only `parse-statement.ts` changes
- No provider code changes
- No error type changes
- No UI changes — `RateLimitedView` still shows after all retries exhausted

### Expected impact

For a 19-page / 4-batch import:
- Happy path adds ~3s (3 inter-batch delays) — negligible
- Rate-limited path: retries up to 3 times with increasing backoff instead of failing after 1 retry, giving the rate window time to reset
