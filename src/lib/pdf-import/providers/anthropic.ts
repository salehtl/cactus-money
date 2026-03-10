import type { LLMProvider, ModelOption } from "../llm-provider.ts";
import { readSSEStream } from "./sse.ts";
import { classifyHttpError, throwNetworkError, FETCH_TIMEOUT_MS, EXTRACT_PROMPT } from "./shared.ts";

export const ANTHROPIC_MODELS: ModelOption[] = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: "Fastest, cheapest" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Best balance" },
  { id: "claude-opus-4-6", label: "Opus 4.6", description: "Most capable, slowest" },
];

export const ANTHROPIC_DEFAULT_MODEL = "claude-sonnet-4-6";

const ERROR_MAPPINGS = [
  { status: 401, code: "invalid_api_key" as const, title: "Invalid API Key", message: "The API key was rejected by Anthropic.", suggestion: "Check that your key is correct in Settings. Keys start with sk-ant-." },
  { status: 403, code: "api_error" as const, title: "Access Denied", message: "The Anthropic API rejected this request. This can happen if you've hit a usage limit, your account lacks credits, or repeated requests triggered rate protection.", suggestion: "Wait a minute and retry. If it persists, check your credit balance and usage limits at console.anthropic.com." },
  { status: 429, code: "rate_limited" as const, title: "Rate Limited", message: "Too many requests to the Anthropic API.", suggestion: "Wait a minute, then try again." },
  { status: 529, code: "api_error" as const, title: "API Overloaded", message: "Anthropic's API is temporarily overloaded.", suggestion: "Wait a moment and retry." },
];

export const anthropicProvider: LLMProvider = {
  async stream(config, systemPrompt, images, onText) {
    const baseUrl = config.baseUrl || `${window.location.origin}/api/llm/anthropic`;

    const imageContent = images.map((data) => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: "image/png" as const, data },
    }));

    const body = {
      model: config.model || ANTHROPIC_DEFAULT_MODEL,
      max_tokens: 8192,
      stream: true,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            ...imageContent,
            { type: "text", text: EXTRACT_PROMPT },
          ],
        },
      ],
    };

    let response: Response;
    try {
      response = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throwNetworkError(e, "Could not reach the API.");
    }

    if (!response.ok) {
      throw classifyHttpError(response.status, "Anthropic", ERROR_MAPPINGS);
    }

    return readSSEStream(response, (data) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          return event.delta.text;
        }
      } catch {
        // skip malformed SSE data
      }
      return null;
    }, onText);
  },
};
