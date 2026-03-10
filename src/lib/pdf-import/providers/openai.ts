import type { LLMProvider, ModelOption } from "../llm-provider.ts";
import { readSSEStream } from "./sse.ts";
import { classifyHttpError, openaiExtractText, throwNetworkError, FETCH_TIMEOUT_MS, EXTRACT_PROMPT } from "./shared.ts";

export const OPENAI_MODELS: ModelOption[] = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", description: "Fast and affordable" },
  { id: "gpt-4.1", label: "GPT-4.1", description: "Best balance" },
  { id: "o3", label: "o3", description: "Most capable, slowest" },
];

export const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";

const ERROR_MAPPINGS = [
  { status: 401, code: "invalid_api_key" as const, title: "Invalid API Key", message: "The API key was rejected by OpenAI.", suggestion: "Check that your key is correct in Settings. Keys start with sk-." },
  { status: 429, code: "rate_limited" as const, title: "Rate Limited", message: "Too many requests or quota exceeded.", suggestion: "Wait a minute and try again. If this persists, check your usage limits at platform.openai.com." },
  { status: 403, code: "api_error" as const, title: "Access Denied", message: "OpenAI rejected the request.", suggestion: "This can mean insufficient quota, org-level restrictions, or missing model access. Check platform.openai.com for details." },
];

export const openaiProvider: LLMProvider = {
  async stream(config, systemPrompt, images, onText) {
    const baseUrl = config.baseUrl || `${window.location.origin}/api/llm/openai`;

    const imageContent = images.map((data) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${data}` },
    }));

    const body = {
      model: config.model || OPENAI_DEFAULT_MODEL,
      max_tokens: 8192,
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
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
      response = await fetch(`${baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throwNetworkError(e, "Could not reach the OpenAI API.");
    }

    if (!response.ok) {
      throw await classifyHttpError(response.status, "OpenAI", ERROR_MAPPINGS, response);
    }

    return readSSEStream(response, openaiExtractText, onText);
  },
};
