/**
 * /v1/function/* – Function API endpoints (function_key authenticated)
 */

import type { Env } from "../types";
import { authenticateFunctionKey } from "../auth";
import { jsonResponse, errorResponse } from "../helpers";
import { handleChatCompletions } from "./chat";

export async function handleFunctionRoutes(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  // GET /v1/function/verify
  if (path === "/v1/function/verify" && request.method === "GET") {
    const authErr = await authenticateFunctionKey(request, env.DB);
    if (authErr) return authErr;
    return jsonResponse({ status: "success" });
  }

  // POST /v1/function/chat/completions
  if (path === "/v1/function/chat/completions" && request.method === "POST") {
    const authErr = await authenticateFunctionKey(request, env.DB);
    if (authErr) return authErr;
    return handleChatCompletions(request, env);
  }

  return null; // not a function route we handle
}
