import { ImportError } from "../errors.ts";
import type { LLMProvider } from "../llm-provider.ts";
import { readSSEStream } from "./sse.ts";
import { classifyHttpError, openaiExtractText, EXTRACT_PROMPT } from "./shared.ts";

const ERROR_MAPPINGS = [
  { status: 401, code: "invalid_api_key" as const, title: "Invalid API Key", message: "The endpoint rejected the API key.", suggestion: "Check your API key in Settings." },
];

export const customProvider: LLMProvider = {
  async stream(config, systemPrompt, images, onText) {
    if (!config.baseUrl) {
      throw new ImportError(
        "api_error",
        "Base URL Required",
        "Custom provider requires a base URL.",
        "Set the base URL in Settings (e.g. http://localhost:11434/v1).",
      );
    }

    const baseUrl = config.baseUrl.replace(/\/$/, "");

    // Uses OpenAI-compatible format (Ollama, vLLM, LM Studio, etc.)
    const imageContent = images.map((data) => ({
      type: "image_url" as const,
      image_url: { url: `data:image/png;base64,${data}` },
    }));

    const body = {
      model: config.model,
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

    // If the base URL is on the same origin, call directly.
    // Otherwise route through the proxy with X-Target-URL header.
    const isSameOrigin = baseUrl.startsWith(window.location.origin);
    const fetchUrl = isSameOrigin
      ? `${baseUrl}/v1/chat/completions`
      : `${window.location.origin}/api/llm/custom/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }
    if (!isSameOrigin) {
      headers["X-Target-URL"] = baseUrl;
    }

    let response: Response;
    try {
      response = await fetch(fetchUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new ImportError(
        "network_error",
        (e as Error).name === "TimeoutError" ? "Request Timed Out" : "Connection Failed",
        (e as Error).name === "TimeoutError"
          ? "The endpoint did not respond within 60 seconds."
          : "Could not reach the custom endpoint.",
        "Check that the base URL is correct and the server is running.",
      );
    }

    if (!response.ok) {
      throw classifyHttpError(response.status, "custom endpoint", ERROR_MAPPINGS);
    }

    return readSSEStream(response, openaiExtractText, onText);
  },
};
