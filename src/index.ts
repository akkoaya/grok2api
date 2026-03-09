/**
 * grok2api Cloudflare Worker – Router entry point
 *
 * All logic is delegated to modules under src/ and src/routes/.
 */

import type { Env } from "./types";
import { errorResponse, handleCorsPreFlight } from "./helpers";
import { authenticateApiKey } from "./auth";
import { handlePageRoutes } from "./routes/pages";
import { handleHealth } from "./routes/health";
import { handleModels } from "./routes/models";
import { handleChatCompletions } from "./routes/chat";
import { handleAdminRoutes } from "./routes/admin";
import { handleFunctionRoutes } from "./routes/function";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return handleCorsPreFlight();
    }

    const url = new URL(request.url);
    const path = url.pathname;

    // -----------------------------------------------------------------------
    // Health check – no auth required
    // -----------------------------------------------------------------------
    if (path === "/health") {
      return handleHealth(env);
    }

    // -----------------------------------------------------------------------
    // Admin API routes (/v1/admin/*)
    // -----------------------------------------------------------------------
    if (path.startsWith("/v1/admin/")) {
      const resp = await handleAdminRoutes(request, env, path);
      if (resp) return resp;
    }

    // -----------------------------------------------------------------------
    // Function API routes (/v1/function/*)
    // -----------------------------------------------------------------------
    if (path.startsWith("/v1/function/")) {
      const resp = await handleFunctionRoutes(request, env, path);
      if (resp) return resp;
    }

    // -----------------------------------------------------------------------
    // OpenAI-compatible endpoints (api_key authenticated)
    // -----------------------------------------------------------------------
    if (path === "/v1/models") {
      const authError = await authenticateApiKey(request, env.DB);
      if (authError) return authError;
      return handleModels();
    }

    if (path === "/v1/chat/completions") {
      const authError = await authenticateApiKey(request, env.DB);
      if (authError) return authError;
      return handleChatCompletions(request, env);
    }

    // -----------------------------------------------------------------------
    // Page routes (HTML pages, static assets, redirects)
    // -----------------------------------------------------------------------
    const pageResp = await handlePageRoutes(request, env, path);
    if (pageResp) return pageResp;

    return errorResponse("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
