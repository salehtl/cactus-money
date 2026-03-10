import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { TanStackRouterVite } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { Readable } from "stream";

// Route table: provider prefix → upstream origin
const PROXY_ROUTES: Record<string, string> = {
  anthropic: "https://api.anthropic.com",
  openai: "https://api.openai.com",
  gemini: "https://generativelanguage.googleapis.com",
};

function llmProxyPlugin(): PluginOption {
  return {
    name: "llm-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith("/api/llm/")) return next();

        const corsHeaders = {
          "Access-Control-Allow-Origin": "*",
          "Cross-Origin-Resource-Policy": "cross-origin",
        };

        // Handle CORS preflight
        if (req.method === "OPTIONS") {
          res.writeHead(204, {
            ...corsHeaders,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers":
              "Content-Type, Authorization, x-api-key, anthropic-version, x-goog-api-key, X-Target-URL",
            "Access-Control-Max-Age": "86400",
          });
          res.end();
          return;
        }

        // Parse /api/llm/{provider}/{rest}
        const match = req.url.match(/^\/api\/llm\/(\w+)(\/.*)?$/);
        if (!match) return next();

        const provider = match[1];
        const restPath = match[2] || "";

        // Determine upstream URL
        let upstreamOrigin: string;
        if (provider === "custom") {
          const customTarget = req.headers["x-target-url"] as string | undefined;
          if (!customTarget) {
            res.writeHead(400, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify({ error: { type: "proxy_error", message: "X-Target-URL header required for custom provider." } }));
            return;
          }
          upstreamOrigin = customTarget.replace(/\/$/, "");
        } else if (PROXY_ROUTES[provider]) {
          upstreamOrigin = PROXY_ROUTES[provider];
        } else {
          return next();
        }

        const upstreamUrl = `${upstreamOrigin}${restPath}`;

        // Collect request body
        const chunks: Buffer[] = [];
        const ac = new AbortController();
        const proxyTimeout = setTimeout(() => ac.abort(), 120_000); // proxy-side 2min ceiling
        req.on("error", () => ac.abort());
        // Abort upstream fetch if client disconnects before the pipe is set up (e.g. during await fetch())
        res.on("close", () => ac.abort());
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", async () => {
          try {
            const body = Buffer.concat(chunks);

            // Forward only relevant headers (strip browser headers)
            const headers: Record<string, string> = {
              "Content-Type": req.headers["content-type"] || "application/json",
            };
            if (req.headers["authorization"]) headers["Authorization"] = req.headers["authorization"] as string;
            if (req.headers["x-api-key"]) headers["x-api-key"] = req.headers["x-api-key"] as string;
            if (req.headers["anthropic-version"]) headers["anthropic-version"] = req.headers["anthropic-version"] as string;
            if (req.headers["x-goog-api-key"]) headers["x-goog-api-key"] = req.headers["x-goog-api-key"] as string;

            const upstream = await fetch(upstreamUrl, {
              method: req.method || "POST",
              headers,
              body,
              signal: ac.signal,
            });

            // Stream the response back (pipe Node readable stream)
            const contentType = upstream.headers.get("content-type") || "application/json";
            res.writeHead(upstream.status, { "Content-Type": contentType, ...corsHeaders });

            if (upstream.body) {
              // Convert Web ReadableStream to Node Readable and pipe
              const nodeStream = Readable.fromWeb(upstream.body as import("stream/web").ReadableStream);
              nodeStream.on("error", () => res.destroy());
              res.on("close", () => { clearTimeout(proxyTimeout); nodeStream.destroy(); });
              nodeStream.pipe(res);
            } else {
              clearTimeout(proxyTimeout);
              res.end();
            }
          } catch (e) {
            clearTimeout(proxyTimeout);
            if ((e as Error).name === "AbortError") return; // client disconnected — nothing to write to
            if (res.headersSent) return; // headers already sent, can't write error response
            res.writeHead(502, { "Content-Type": "application/json", ...corsHeaders });
            res.end(JSON.stringify({ error: { type: "proxy_error", message: "Failed to connect to upstream API." } }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    llmProxyPlugin(),
    TanStackRouterVite({
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "prompt",
      includeAssets: ["fonts/*.woff2", "meta-media/*"],
      manifest: {
        name: "Cactus Money",
        short_name: "Cactus",
        description: "Personal finance tracker - track spending, plan budgets, stay sharp.",
        theme_color: "#2D1CD1",
        background_color: "#ffffff",
        display: "standalone",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "meta-media/manifest-icon-192.jpg",
            sizes: "192x192",
            type: "image/jpeg",
          },
          {
            src: "meta-media/manifest-icon-512.jpg",
            sizes: "512x512",
            type: "image/jpeg",
          },
          {
            src: "meta-media/manifest-icon-512.jpg",
            sizes: "512x512",
            type: "image/jpeg",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,wasm,png,svg}"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: ["wa-sqlite"],
  },
});
