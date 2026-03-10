export type ImportErrorCode =
  | "no_api_key"
  | "invalid_api_key"
  | "credits_exhausted"
  | "rate_limited"
  | "rate_limited_with_fallback"
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
