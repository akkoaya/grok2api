/**
 * /v1/chat/completions – streaming proxy to Grok upstream
 */

import type { Env, ModelDef, TokenRow } from "../types";
import { MODEL_MAP } from "../models";
import { jsonResponse, errorResponse } from "../helpers";
import { loadConfig } from "../config";

// ---------------------------------------------------------------------------
// Token pool (round-robin)
// ---------------------------------------------------------------------------

let tokenIndex = 0;

async function pickToken(db: D1Database, pool: string): Promise<TokenRow | null> {
  const rows = await db
    .prepare(
      "SELECT id, cookie, pool, status, fail_count FROM tokens WHERE pool = ? AND status = 'active' ORDER BY id",
    )
    .bind(pool)
    .all<TokenRow>();

  const tokens = rows.results;
  if (!tokens || tokens.length === 0) return null;

  const token = tokens[tokenIndex % tokens.length]!;
  tokenIndex++;
  return token;
}

function poolForModel(model: ModelDef): string {
  return model.tier === "super" ? "ssoSuper" : "ssoBasic";
}

function fallbackPool(pool: string): string | null {
  if (pool === "ssoBasic") return "ssoSuper";
  if (pool === "ssoSuper") return "ssoBasic";
  return null;
}

// ---------------------------------------------------------------------------
// Upstream response parsing helpers
// ---------------------------------------------------------------------------

function extractTokenFromLine(line: string): string | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.result && typeof parsed.result === "object") {
      const result = parsed.result as Record<string, unknown>;
      if (typeof result.token === "string") {
        return result.token;
      }
      if (result.response && typeof result.response === "object") {
        const resp = result.response as Record<string, unknown>;
        if (typeof resp.token === "string") {
          return resp.token;
        }
      }
    }
    if (typeof parsed.token === "string") {
      return parsed.token;
    }
  } catch {
    // Not JSON – ignore
  }
  return null;
}

function extractContentFromUpstream(text: string): string {
  const lines = text.split("\n");
  let content = "";
  for (const line of lines) {
    const token = extractTokenFromLine(line.trim());
    if (token !== null) {
      content += token;
    }
  }
  return content;
}

// ---------------------------------------------------------------------------
// Build upstream payload
// ---------------------------------------------------------------------------

function buildUpstreamPayload(
  messages: Array<{ role: string; content: string }>,
  model: ModelDef,
  systemPrompt: string,
): Record<string, unknown> {
  // Concatenate conversation history for context
  const conversationParts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // handled separately
    if (msg.role === "assistant") {
      conversationParts.push(`Assistant: ${msg.content}`);
    } else {
      conversationParts.push(`${msg.content}`);
    }
  }

  // Use last user message as the primary message, include history as context
  const lastUserMsg = messages.filter((m) => m.role !== "system").pop();
  let message: string;
  if (messages.filter((m) => m.role !== "system").length > 1) {
    // Multi-turn: include full conversation
    message = conversationParts.join("\n\n");
  } else {
    message = lastUserMsg?.content ?? "";
  }

  return {
    temporary: true,
    modelSlug: model.grok_model,
    message,
    fileAttachments: [],
    imageAttachments: [],
    disableSearch: false,
    enableImageGeneration: model.is_image,
    enableImageStreaming: model.is_image,
    imageGenerationCount: model.is_image ? 1 : 0,
    isPreset: false,
    sendFinalMetadata: true,
    customInstructions: systemPrompt,
    deepsearchPreset: "",
    isReasoning: false,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleChatCompletions(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const modelId = String(body.model ?? "");
  const model = MODEL_MAP.get(modelId);
  if (!model) {
    return errorResponse(`Model '${modelId}' not found`, 404);
  }

  const primaryPool = poolForModel(model);
  let token = await pickToken(env.DB, primaryPool);

  // Fallback to other pool if primary is empty
  if (!token) {
    const fb = fallbackPool(primaryPool);
    if (fb) {
      token = await pickToken(env.DB, fb);
    }
  }

  if (!token) {
    return errorResponse("No available tokens in pool", 503);
  }

  const config = await loadConfig(env.DB);
  const upstreamBase = (env.UPSTREAM_BASE_URL ?? "https://grok.x.ai").replace(/\/+$/, "");
  const upstreamUrl = `${upstreamBase}/rest/app-chat/conversations/new`;

  const stream = Boolean(body.stream);
  const messages = body.messages as Array<{ role: string; content: string }> | undefined;
  if (!messages || messages.length === 0) {
    return errorResponse("messages is required and must be non-empty", 400);
  }

  const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";
  const upstreamPayload = buildUpstreamPayload(messages, model, systemPrompt);

  const userAgent =
    config.proxy.user_agent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    Cookie: token.cookie,
    "User-Agent": userAgent,
  };

  // Retry logic: try current token, then fallback on 401/429
  const maxRetries = config.retry.max_retry ?? 3;
  const retryStatusCodes = config.retry.retry_status_codes ?? [401, 429, 403];

  let upstreamResponse: Response | null = null;
  let currentToken = token;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    upstreamHeaders.Cookie = currentToken.cookie;

    upstreamResponse = await fetch(upstreamUrl, {
      method: "POST",
      headers: upstreamHeaders,
      body: JSON.stringify(upstreamPayload),
    });

    if (upstreamResponse.ok) break;

    // Mark token failure
    await env.DB
      .prepare(
        "UPDATE tokens SET fail_count = fail_count + 1, updated_at = datetime('now') WHERE id = ?",
      )
      .bind(currentToken.id)
      .run();

    if (!retryStatusCodes.includes(upstreamResponse.status)) break;
    if (attempt === maxRetries) break;

    // Try another token from the same pool or fallback
    const nextToken = await pickToken(env.DB, currentToken.pool);
    if (nextToken && nextToken.id !== currentToken.id) {
      currentToken = nextToken;
    } else {
      const fb = fallbackPool(currentToken.pool);
      if (fb) {
        const fbToken = await pickToken(env.DB, fb);
        if (fbToken) {
          currentToken = fbToken;
        }
      }
    }
  }

  if (!upstreamResponse || !upstreamResponse.ok) {
    const status = upstreamResponse?.status ?? 502;
    return errorResponse(`Upstream error: ${status}`, 502);
  }

  if (!stream) {
    return handleNonStreamingResponse(upstreamResponse, modelId);
  }

  return handleStreamingResponse(upstreamResponse, modelId);
}

// ---------------------------------------------------------------------------
// Response handlers
// ---------------------------------------------------------------------------

async function handleNonStreamingResponse(
  upstream: Response,
  modelId: string,
): Promise<Response> {
  const text = await upstream.text();
  const content = extractContentFromUpstream(text);

  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  return jsonResponse({
    id: completionId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  });
}

function handleStreamingResponse(upstream: Response, modelId: string): Response {
  const completionId = `chatcmpl-${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const encoder = new TextEncoder();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const sendSSE = async (data: unknown): Promise<void> => {
    await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
  };

  const processStream = async (): Promise<void> => {
    try {
      const reader = upstream.body?.getReader();
      if (!reader) {
        await writer.close();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          const token = extractTokenFromLine(trimmed);
          if (token !== null) {
            await sendSSE({
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [
                {
                  index: 0,
                  delta: { content: token },
                  finish_reason: null,
                },
              ],
            });
          }
        }
      }

      // Final chunk
      await sendSSE({
        id: completionId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: "stop",
          },
        ],
      });
      await writer.write(encoder.encode("data: [DONE]\n\n"));
    } catch {
      // Best-effort close
    } finally {
      try {
        await writer.close();
      } catch {
        // already closed
      }
    }
  };

  processStream();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
