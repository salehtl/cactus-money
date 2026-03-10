import { ImportError } from "../errors.ts";
import type { LLMProvider, ModelOption } from "../llm-provider.ts";
import { readSSEStream } from "./sse.ts";
import { classifyHttpError, openaiExtractText, EXTRACT_PROMPT } from "./shared.ts";

export const OPENAI_MODELS: ModelOption[] = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 Mini", description: "Fast and affordable" },
  { id: "gpt-4.1", label: "GPT-4.1", description: "Best balance" },
  { id: "o3", label: "o3", description: "Most capable, slowest" },
];

export const OPENAI_DEFAULT_MODEL = "gpt-4.1-mini";

const ERROR_MAPPINGS = [
  { status: 401, code: "invalid_api_key" as const, title: "Invalid API Key", message: "The API key was rejected by OpenAI.", suggestion: "Check that your key is correct in Settings. Keys start with sk-." },
  { status: 429, code: "rate_limited" as const, title: "Rate Limited", message: "Too many requests to the OpenAI API.", suggestion: "Wait a minute, then try again." },
  { status: 403, code: "credits_exhausted" as const, title: "No API Credits", message: "Your OpenAI account has insufficient credits or permissions.", suggestion: "Add credits at platform.openai.com, then try again." },
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
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new ImportError(
        "network_error",
        (e as Error).name === "TimeoutError" ? "Request Timed Out" : "Connection Failed",
        (e as Error).name === "TimeoutError"
          ? "The API did not respond within 60 seconds."
          : "Could not reach the OpenAI API.",
        "Check your internet connection or proxy URL in Settings.",
      );
    }

    if (!response.ok) {
      throw classifyHttpError(response.status, "OpenAI", ERROR_MAPPINGS);
    }

    return readSSEStream(response, openaiExtractText, onText);
  },
};
