/**
 * grok2api Cloudflare Worker
 *
 * Lightweight API-compatible proxy that forwards OpenAI-style requests
 * to the Grok API, using tokens stored in D1.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  BUILD_SHA: string;
  UPSTREAM_BASE_URL?: string;
}

interface TokenRow {
  id: number;
  cookie: string;
  pool: string;
  status: string;
  fail_count: number;
}

interface ApiKeyRow {
  key: string;
}

interface ModelDef {
  id: string;
  grok_model: string;
  model_mode: string;
  tier: "basic" | "super";
  is_image: boolean;
  is_image_edit: boolean;
  is_video: boolean;
}

// ---------------------------------------------------------------------------
// Model catalog – keep in sync with app/services/grok/services/model.py
// ---------------------------------------------------------------------------

// __MODEL_CATALOG_START__
const MODEL_CATALOG: ModelDef[] = [
  { id: "grok-3", grok_model: "grok-3", model_mode: "MODEL_MODE_GROK_3", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-3-mini", grok_model: "grok-3", model_mode: "MODEL_MODE_GROK_3_MINI_THINKING", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-3-thinking", grok_model: "grok-3", model_mode: "MODEL_MODE_GROK_3_THINKING", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4", grok_model: "grok-4", model_mode: "MODEL_MODE_GROK_4", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4-thinking", grok_model: "grok-4", model_mode: "MODEL_MODE_GROK_4_THINKING", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4-heavy", grok_model: "grok-4", model_mode: "MODEL_MODE_HEAVY", tier: "super", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4.1-mini", grok_model: "grok-4-1-thinking-1129", model_mode: "MODEL_MODE_GROK_4_1_MINI_THINKING", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4.1-fast", grok_model: "grok-4-1-thinking-1129", model_mode: "MODEL_MODE_FAST", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4.1-expert", grok_model: "grok-4-1-thinking-1129", model_mode: "MODEL_MODE_EXPERT", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4.1-thinking", grok_model: "grok-4-1-thinking-1129", model_mode: "MODEL_MODE_GROK_4_1_THINKING", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-4.20-beta", grok_model: "grok-420", model_mode: "MODEL_MODE_GROK_420", tier: "basic", is_image: false, is_image_edit: false, is_video: false },
  { id: "grok-imagine-1.0-fast", grok_model: "grok-3", model_mode: "MODEL_MODE_FAST", tier: "basic", is_image: true, is_image_edit: false, is_video: false },
  { id: "grok-imagine-1.0", grok_model: "grok-3", model_mode: "MODEL_MODE_FAST", tier: "basic", is_image: true, is_image_edit: false, is_video: false },
  { id: "grok-imagine-1.0-edit", grok_model: "imagine-image-edit", model_mode: "MODEL_MODE_FAST", tier: "basic", is_image: false, is_image_edit: true, is_video: false },
  { id: "grok-imagine-1.0-video", grok_model: "grok-3", model_mode: "MODEL_MODE_FAST", tier: "basic", is_image: false, is_image_edit: false, is_video: true },
];
// __MODEL_CATALOG_END__

const MODEL_MAP = new Map(MODEL_CATALOG.map((m) => [m.id, m]));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function errorResponse(message: string, status: number): Response {
  return jsonResponse(
    {
      error: {
        message,
        type: status === 401 ? "authentication_error" : "invalid_request_error",
        code: status === 401 ? "invalid_api_key" : null,
      },
    },
    status,
  );
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function authenticate(request: Request, db: D1Database): Promise<Response | null> {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return errorResponse("Missing or malformed Authorization header", 401);
  }
  const key = auth.slice(7).trim();
  if (!key) {
    return errorResponse("Empty API key", 401);
  }

  const row = await db.prepare("SELECT key FROM api_keys WHERE key = ?").bind(key).first<ApiKeyRow>();
  if (!row) {
    return errorResponse("Invalid API key", 401);
  }
  return null; // authenticated
}

// ---------------------------------------------------------------------------
// Token pool (round-robin)
// ---------------------------------------------------------------------------

let tokenIndex = 0;

async function pickToken(db: D1Database, pool: string): Promise<TokenRow | null> {
  const rows = await db
    .prepare("SELECT id, cookie, pool, status, fail_count FROM tokens WHERE pool = ? AND status = 'active' ORDER BY id")
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

// ---------------------------------------------------------------------------
// /v1/models
// ---------------------------------------------------------------------------

function handleModels(): Response {
  const now = Math.floor(Date.now() / 1000);
  const data = MODEL_CATALOG.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: now,
    owned_by: "xai",
  }));
  return jsonResponse({ object: "list", data });
}

// ---------------------------------------------------------------------------
// /v1/chat/completions – streaming proxy
// ---------------------------------------------------------------------------

async function handleChatCompletions(request: Request, env: Env): Promise<Response> {
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

  const pool = poolForModel(model);
  const token = await pickToken(env.DB, pool);
  if (!token) {
    return errorResponse("No available tokens in pool", 503);
  }

  const upstreamBase = (env.UPSTREAM_BASE_URL ?? "https://grok.x.ai").replace(/\/+$/, "");
  const upstreamUrl = `${upstreamBase}/rest/app-chat/conversations/new`;

  const stream = Boolean(body.stream);
  const messages = body.messages as Array<{ role: string; content: string }> | undefined;
  if (!messages || messages.length === 0) {
    return errorResponse("messages is required and must be non-empty", 400);
  }

  // Build upstream payload
  const lastMessage = messages[messages.length - 1]!;
  const systemPrompt = messages.find((m) => m.role === "system")?.content ?? "";

  const upstreamPayload = {
    temporary: true,
    modelSlug: model.grok_model,
    message: lastMessage.content,
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

  const upstreamHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "Cookie": token.cookie,
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  };

  const upstreamResponse = await fetch(upstreamUrl, {
    method: "POST",
    headers: upstreamHeaders,
    body: JSON.stringify(upstreamPayload),
  });

  if (!upstreamResponse.ok) {
    // Mark token as potentially failed
    await env.DB
      .prepare("UPDATE tokens SET fail_count = fail_count + 1, updated_at = datetime('now') WHERE id = ?")
      .bind(token.id)
      .run();

    return errorResponse(`Upstream error: ${upstreamResponse.status}`, 502);
  }

  if (!stream) {
    return handleNonStreamingResponse(upstreamResponse, modelId);
  }

  return handleStreamingResponse(upstreamResponse, modelId);
}

async function handleNonStreamingResponse(upstream: Response, modelId: string): Promise<Response> {
  const text = await upstream.text();
  // Parse the streaming response lines and collect all text tokens
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

      // Send final chunk with finish_reason
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

  // Fire-and-forget the stream processing
  processStream();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
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
      // Handle response token nested in different paths
      if (result.response && typeof result.response === "object") {
        const resp = result.response as Record<string, unknown>;
        if (typeof resp.token === "string") {
          return resp.token;
        }
      }
    }
    // Direct token field
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
// /health
// ---------------------------------------------------------------------------

function handleHealth(env: Env): Response {
  return jsonResponse({
    status: "ok",
    build_sha: env.BUILD_SHA ?? "dev",
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Root – landing page
    if (path === "/") {
      return jsonResponse({
        service: "grok2api",
        version: env.BUILD_SHA ?? "dev",
        endpoints: {
          chat: "/v1/chat/completions",
          models: "/v1/models",
          health: "/health",
        },
      });
    }

    // Health check – no auth required
    if (path === "/health") {
      return handleHealth(env);
    }

    // Models endpoint
    if (path === "/v1/models") {
      const authError = await authenticate(request, env.DB);
      if (authError) return authError;
      return handleModels();
    }

    // Chat completions
    if (path === "/v1/chat/completions") {
      const authError = await authenticate(request, env.DB);
      if (authError) return authError;
      return handleChatCompletions(request, env);
    }

    return errorResponse("Not found", 404);
  },
} satisfies ExportedHandler<Env>;
