import type { LLMProvider, ModelOption } from "../llm-provider.ts";
import { readSSEStream } from "./sse.ts";
import { classifyHttpError, throwNetworkError, FETCH_TIMEOUT_MS, EXTRACT_PROMPT } from "./shared.ts";

export const GEMINI_MODELS: ModelOption[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", description: "Fast and affordable" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", description: "Most capable" },
];

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

const ERROR_MAPPINGS = [
  { status: 400, code: "api_error" as const, title: "Bad Request", message: "The Gemini API rejected the request.", suggestion: "This can mean an invalid API key, unsupported model, or malformed request. Check your settings." },
  { status: 403, code: "api_error" as const, title: "Access Denied", message: "The Gemini API denied access.", suggestion: "Ensure the Generative Language API is enabled in your Google Cloud project and the key has access." },
  { status: 429, code: "rate_limited" as const, title: "Rate Limited", message: "Too many requests to the Gemini API.", suggestion: "Wait a minute, then try again." },
];

export const geminiProvider: LLMProvider = {
  async stream(config, systemPrompt, images, onText) {
    const model = config.model || GEMINI_DEFAULT_MODEL;
    const baseUrl = config.baseUrl || `${window.location.origin}/api/llm/gemini`;

    const imageParts = images.map((data) => ({
      inline_data: { mime_type: "image/png", data },
    }));

    const body = {
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [
        {
          role: "user",
          parts: [
            ...imageParts,
            { text: EXTRACT_PROMPT },
          ],
        },
      ],
      generation_config: { max_output_tokens: 8192 },
    };

    const url = `${baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (e) {
      throwNetworkError(e, "Could not reach the Gemini API.");
    }

    if (!response.ok) {
      throw await classifyHttpError(response.status, "Gemini", ERROR_MAPPINGS, response);
    }

    return readSSEStream(response, (data) => {
      try {
        const parsed = JSON.parse(data);
        return parsed.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
      } catch {
        return null;
      }
    }, onText);
  },
};
