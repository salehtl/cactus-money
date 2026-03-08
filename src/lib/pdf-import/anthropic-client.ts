import Anthropic from "@anthropic-ai/sdk";

export interface AnthropicConfig {
  apiKey: string;
  proxyUrl: string;
  model?: string;
}

export const AVAILABLE_MODELS = [
  { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5", description: "Fastest, cheapest" },
  { id: "claude-sonnet-4-6", label: "Sonnet 4.6", description: "Best balance (recommended)" },
  { id: "claude-opus-4-6", label: "Opus 4.6", description: "Most capable, slowest" },
] as const;

export const DEFAULT_MODEL = "claude-sonnet-4-6";

export type ImportErrorCode =
  | "no_api_key"
  | "invalid_api_key"
  | "credits_exhausted"
  | "rate_limited"
  | "network_error"
  | "pdf_error"
  | "parse_error"
  | "no_transactions"
  | "api_error";

export class ImportError extends Error {
  code: ImportErrorCode;
  title: string;
  suggestion: string;

  constructor(code: ImportErrorCode, title: string, message: string, suggestion: string) {
    super(message);
    this.code = code;
    this.title = title;
    this.suggestion = suggestion;
  }
}

function classifyApiError(err: unknown): ImportError {
  if (err instanceof Anthropic.AuthenticationError) {
    return new ImportError(
      "invalid_api_key",
      "Invalid API Key",
      "The API key was rejected by Anthropic.",
      "Check that your key is correct in Settings. Keys start with sk-ant-.",
    );
  }

  if (err instanceof Anthropic.PermissionDeniedError) {
    const msg = err.message.toLowerCase();
    if (msg.includes("credit") || msg.includes("billing") || msg.includes("balance")) {
      return new ImportError(
        "credits_exhausted",
        "No API Credits",
        "Your Anthropic account has insufficient credits.",
        "Add credits at console.anthropic.com, then try again.",
      );
    }
    return new ImportError(
      "network_error",
      "Access Forbidden",
      "The server rejected the request. Your account may not have permission for this action.",
      "Check your proxy URL in Settings. If using a proxy, make sure it allows requests to the Anthropic API.",
    );
  }

  if (err instanceof Anthropic.RateLimitError) {
    return new ImportError(
      "rate_limited",
      "Rate Limited",
      "Too many requests to the Anthropic API.",
      "Wait a minute, then try again.",
    );
  }

  if (err instanceof Anthropic.InternalServerError && err.status === 529) {
    return new ImportError(
      "api_error",
      "API Overloaded",
      "Anthropic's API is temporarily overloaded.",
      "Wait a moment and retry.",
    );
  }

  if (err instanceof Anthropic.APIConnectionError) {
    return new ImportError(
      "network_error",
      "Connection Failed",
      "Could not reach the API. The request may have been blocked or the network is down.",
      "Check the proxy URL in Settings, or verify your internet connection.",
    );
  }

  if (err instanceof Anthropic.APIError) {
    return new ImportError(
      "api_error",
      "API Error",
      "Something went wrong while contacting the API.",
      "If this persists, check your proxy URL in Settings.",
    );
  }

  return new ImportError(
    "api_error",
    "Unexpected Error",
    "Something went wrong.",
    "Try again. If this persists, check your Settings.",
  );
}

function makeClient(config: AnthropicConfig): Anthropic {
  const baseURL = config.proxyUrl
    ? config.proxyUrl.replace(/\/$/, "")
    : `${window.location.origin}/api/anthropic`;

  return new Anthropic({
    apiKey: config.apiKey,
    dangerouslyAllowBrowser: true,
    baseURL,
  });
}


/**
 * Stream a Claude response, calling onObject for each complete JSON object
 * found in the streamed array. Returns the full accumulated text.
 */
export async function callClaudeStreaming(
  config: AnthropicConfig,
  systemPrompt: string,
  imageContents: { type: "image"; source: { type: "base64"; media_type: "image/png"; data: string } }[],
  onObject?: (obj: unknown) => void,
): Promise<string> {
  const client = makeClient(config);

  try {
    const stream = client.messages.stream({
      model: config.model || DEFAULT_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            ...imageContents,
            { type: "text", text: "Extract all transactions from these bank statement pages. Output JSON only." },
          ],
        },
      ],
    });

    let accumulated = "";
    let parseOffset = 0; // how far we've successfully parsed

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        accumulated += event.delta.text;

        // Try to extract complete JSON objects from the stream
        if (onObject) {
          parseOffset = extractStreamedObjects(accumulated, parseOffset, onObject);
        }
      }
    }

    if (!accumulated.trim()) {
      throw new ImportError(
        "parse_error",
        "Empty Response",
        "The AI returned an empty response.",
        "Try again — this is usually a transient issue.",
      );
    }

    return accumulated;
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw classifyApiError(e);
  }
}

/**
 * Incrementally extract complete JSON objects from a streaming JSON array.
 * Tracks brace depth to find object boundaries without parsing partial JSON.
 * Returns the new parse offset.
 */
function extractStreamedObjects(
  text: string,
  offset: number,
  onObject: (obj: unknown) => void,
): number {
  let i = offset;

  // Skip to first '[' if we haven't started
  if (i === 0) {
    const start = text.indexOf("[");
    if (start === -1) return 0;
    i = start + 1;
  }

  while (i < text.length) {
    // Skip whitespace and commas between objects
    const ch = text[i];
    if (ch === " " || ch === "\n" || ch === "\r" || ch === "\t" || ch === ",") {
      i++;
      continue;
    }

    // End of array
    if (ch === "]") break;

    // Start of an object
    if (ch === "{") {
      let depth = 0;
      let inString = false;
      let escaped = false;
      let j = i;

      for (; j < text.length; j++) {
        const c = text[j]!;
        if (escaped) { escaped = false; continue; }
        if (c === "\\") { escaped = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === "{") depth++;
        if (c === "}") {
          depth--;
          if (depth === 0) {
            // Found a complete object
            try {
              const obj = JSON.parse(text.slice(i, j + 1));
              onObject(obj);
            } catch {
              // Malformed object, skip it
            }
            i = j + 1;
            break;
          }
        }
      }

      // If we didn't close the object, stop — need more data
      if (depth > 0) break;
    } else {
      i++;
    }
  }

  return i;
}
