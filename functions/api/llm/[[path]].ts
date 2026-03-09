// Cloudflare Pages Function: proxies /api/llm/{provider}/* to upstream LLM APIs.
// Mirrors the Vite dev server plugin for production use.
// Required because COEP (require-corp) blocks direct browser→API calls.

interface Env {}

const PROXY_ROUTES: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cross-Origin-Resource-Policy": "cross-origin",
} as const;

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, x-api-key, anthropic-version, x-goog-api-key, X-Target-URL",
      "Access-Control-Max-Age": "86400",
    },
  });
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { params, request } = context;
  const pathSegments = params.path as string[];

  if (pathSegments.length === 0) {
    return errorResponse(400, "Missing provider in URL path.");
  }

  const provider = pathSegments[0];
  const restPath = "/" + pathSegments.slice(1).join("/");

  // Determine upstream URL
  let upstreamOrigin: string;
  if (provider === "custom") {
    const customTarget = request.headers.get("x-target-url");
    if (!customTarget) {
      return errorResponse(
        400,
        "X-Target-URL header required for custom provider.",
      );
    }
    try {
      const parsed = new URL(customTarget);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return errorResponse(400, "X-Target-URL must use http or https.");
      }
      upstreamOrigin = parsed.origin;
    } catch {
      return errorResponse(400, "X-Target-URL is not a valid URL.");
    }
  } else if (PROXY_ROUTES[provider]) {
    upstreamOrigin = PROXY_ROUTES[provider];
  } else {
    return errorResponse(400, `Unknown provider: ${provider}`);
  }

  const upstreamUrl = `${upstreamOrigin}${restPath}`;

  // Forward only relevant headers (strip browser headers)
  const headers: Record<string, string> = {
    "Content-Type": request.headers.get("content-type") || "application/json",
  };

  const fwd = (name: string) => {
    const val = request.headers.get(name);
    if (val) headers[name] = val;
  };
  fwd("authorization");
  fwd("x-api-key");
  fwd("anthropic-version");
  fwd("x-goog-api-key");

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: request.body,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("content-type") || "application/json",
        ...CORS_HEADERS,
      },
    });
  } catch {
    return errorResponse(502, "Failed to connect to upstream API.");
  }
};

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ error: { type: "proxy_error", message } }),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    },
  );
}
