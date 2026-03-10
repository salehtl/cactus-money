import type { ProviderId, LLMProvider, ModelOption } from "../llm-provider.ts";
import { anthropicProvider, ANTHROPIC_MODELS, ANTHROPIC_DEFAULT_MODEL } from "./anthropic.ts";
import { openaiProvider, OPENAI_MODELS, OPENAI_DEFAULT_MODEL } from "./openai.ts";
import { geminiProvider, GEMINI_MODELS, GEMINI_DEFAULT_MODEL } from "./gemini.ts";
import { customProvider } from "./custom.ts";

const providers: Record<ProviderId, LLMProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
  custom: customProvider,
};

export const DEFAULT_PROVIDER: ProviderId = "anthropic";

export function getProvider(id: ProviderId): LLMProvider {
  return providers[id];
}

export const PROVIDER_MODELS: Record<ProviderId, ModelOption[]> = {
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
  gemini: GEMINI_MODELS,
  custom: [],
};

export const PROVIDER_DEFAULTS: Record<ProviderId, string> = {
  anthropic: ANTHROPIC_DEFAULT_MODEL,
  openai: OPENAI_DEFAULT_MODEL,
  gemini: GEMINI_DEFAULT_MODEL,
  custom: "",
};

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  custom: "Custom (OpenAI-compatible)",
};

export const PROVIDER_KEY_PLACEHOLDERS: Record<ProviderId, string> = {
  anthropic: "sk-ant-...",
  openai: "sk-...",
  gemini: "AIza...",
  custom: "Optional",
};

/** Links to each provider's rate limit documentation. */
export const PROVIDER_RATE_LIMIT_URLS: Record<Exclude<ProviderId, "custom">, string> = {
  anthropic: "https://docs.anthropic.com/en/api/rate-limits",
  openai: "https://platform.openai.com/docs/guides/rate-limits",
  gemini: "https://ai.google.dev/gemini-api/docs/rate-limits",
};

/**
 * Fallback model per provider+model when rate limited.
 * Maps "current model" → "cheaper model". If not in map, no fallback available.
 */
export const PROVIDER_FALLBACK_MODELS: Partial<Record<ProviderId, Record<string, string>>> = {
  anthropic: {
    "claude-opus-4-6": "claude-sonnet-4-6",
    "claude-sonnet-4-6": "claude-haiku-4-5-20251001",
  },
  openai: {
    "o3": "gpt-4.1",
    "gpt-4.1": "gpt-4.1-mini",
  },
  gemini: {
    "gemini-2.5-pro": "gemini-2.5-flash",
  },
};

/** Get the human-readable label for a model ID, or return the ID itself. */
export function getModelLabel(provider: ProviderId, modelId: string): string {
  const model = PROVIDER_MODELS[provider].find(m => m.id === modelId);
  return model?.label ?? modelId;
}

export { ANTHROPIC_MODELS, ANTHROPIC_DEFAULT_MODEL } from "./anthropic.ts";
export { OPENAI_MODELS, OPENAI_DEFAULT_MODEL } from "./openai.ts";
export { GEMINI_MODELS, GEMINI_DEFAULT_MODEL } from "./gemini.ts";
