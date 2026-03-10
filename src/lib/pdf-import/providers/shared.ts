import { ImportError, type ImportErrorCode } from "../errors.ts";

interface ErrorMapping {
  status: number;
  code: ImportErrorCode;
  title: string;
  message: string;
  suggestion: string;
}

/**
 * Classify an HTTP error status into an ImportError using provider-specific mappings.
 * Falls back to a generic API error if no mapping matches.
 */
export function classifyHttpError(
  status: number,
  providerName: string,
  mappings: ErrorMapping[],
): ImportError {
  const match = mappings.find((m) => m.status === status);
  if (match) {
    return new ImportError(match.code, match.title, match.message, match.suggestion);
  }
  return new ImportError(
    "api_error",
    "API Error",
    `Something went wrong while contacting the ${providerName} API.`,
    "If this persists, check your settings.",
  );
}

/** OpenAI-compatible SSE text extractor (used by OpenAI and custom providers). */
export function openaiExtractText(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

/** Timeout applied to all provider fetch calls. */
export const FETCH_TIMEOUT_MS = 60_000;

/** Throw an ImportError for network/timeout failures. */
export function throwNetworkError(e: unknown, unreachableMsg: string, suggestion?: string): never {
  const isTimeout = (e as Error).name === "TimeoutError";
  throw new ImportError(
    "network_error",
    isTimeout ? "Request Timed Out" : "Connection Failed",
    isTimeout ? "The API did not respond within 60 seconds." : unreachableMsg,
    suggestion ?? "Check your internet connection or proxy URL in Settings.",
  );
}

/** Shared user prompt appended to images in all providers. */
export const EXTRACT_PROMPT = "Extract all transactions from these bank statement pages. Output JSON only.";
