# Cloudflare Workers AI for PDF Import — Discovery

**Date:** 2026-03-08
**Status:** Paused — needs decision on multi-provider key ownership model

## Goal

Add an open-source model option for bank statement parsing via Cloudflare Workers AI, so users don't need to provide their own Anthropic API key. Coexists with the existing Anthropic option — user picks their provider in Settings.

## Current Architecture

- PDF pages rendered to base64 PNG images via pdfjs-dist
- Batched 5 pages/batch, up to 3 batches concurrent
- Sent to Claude via Anthropic SDK (`client.messages.stream()`)
- Streaming JSON parsed incrementally (`extractStreamedObjects()`)
- Proxy plugin in `vite.config.ts` forwards `/api/anthropic/*` to `api.anthropic.com` (required by COEP)
- API key stored in SQLite `settings` table
- Key files: `src/lib/pdf-import/anthropic-client.ts`, `src/components/pdf-import/PdfImportModal.tsx`, `vite.config.ts`

## Decisions Made

- **Hosting:** You host a shared Cloudflare Worker with usage controls
- **Auth:** Anonymous with IP-based rate limiting (5 imports/day)
- **Repo layout:** Monorepo subfolder (`/worker`)
- **Coexistence:** User explicitly picks provider in Settings (neither is default)
- **Model selection:** Users can choose between available models

## Available Vision Models on Workers AI

| Model | Params | Context | Pricing (input/output per M tokens) | Notes |
|-------|--------|---------|--------------------------------------|-------|
| `@cf/meta/llama-3.2-11b-vision-instruct` | 11B | 128k | $0.049 / $0.68 | LoRA support, most tested vision model |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 24B | — | — | Vision + tool calling, most capable |
| `@cf/google/gemma-3-12b-it` | 12B | 128k | — | Vision, 140+ languages |

**Constraint:** Workers AI vision models support max 4 images per request at 512x512. Current pipeline sends 5 pages/batch — needs adjustment to 4 pages/batch.

## Rate Limiting

Cloudflare has a native `ratelimit` binding for Workers (GA since Sep 2025). No need for KV-based workarounds.

```jsonc
// wrangler.jsonc
{
  "ratelimits": [{
    "name": "IMPORT_LIMITER",
    "namespace_id": "1001",
    "simple": { "limit": 5, "period": 86400 }
  }]
}
```

## Proposed Architecture (Approach A — Direct Workers AI Binding)

```
Browser → POST /api/parse (images + system prompt)
  → Worker receives request
  → env.IMPORT_LIMITER.limit({ key: ip })
  → env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", ...)
  → Stream JSON response back to browser
```

- Worker lives in `/worker` directory (monorepo)
- Native `env.AI.run()` binding — no external API calls
- Rate limiting via `ratelimit` binding
- Streaming response back to client

## Alternatives Considered

**Approach B: OpenAI-Compatible API via AI Gateway** — Use `/v1/chat/completions` endpoint with AI Gateway for dashboards/caching. Rejected: caching won't help (unique statements), adds unnecessary complexity.

**Approach C: Hybrid (Workers AI + AI Gateway)** — Direct binding with AI Gateway for observability. Viable but overkill for current scale.

## Open Questions

1. **Multi-provider support:** User expressed interest in supporting "many models from many companies." Needs decision on key ownership model:
   - Users bring their own keys (BYOK) for premium providers, Workers AI is the free option
   - App owner pays for all providers
   - Mix: free tier (Workers AI) + BYOK for others
2. **512x512 image limit:** May reduce OCR accuracy on dense bank statements. Needs testing with real statements.
3. **Model accuracy:** Open-source vision models haven't been validated against Claude for structured financial data extraction. Should test before committing.
4. **Production proxy:** Current Vite proxy only works in dev. If deploying the PWA, need the Cloudflare Worker to also serve as the Anthropic proxy (or a separate solution).
