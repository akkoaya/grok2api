/**
 * /v1/admin/* – Admin API endpoints (app_key authenticated)
 */

import type { Env, TokenRow } from "../types";
import { authenticateAppKey } from "../auth";
import { loadConfig, mergeAndSaveConfig } from "../config";
import { jsonResponse, errorResponse } from "../helpers";

// ---------------------------------------------------------------------------
// Token text sanitization – mirrors Python _sanitize_token_text
// ---------------------------------------------------------------------------

const TOKEN_CHAR_MAP: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u00a0": " ",
  "\u2007": " ",
  "\u202f": " ",
  "\u200b": "",
  "\u200c": "",
  "\u200d": "",
  "\ufeff": "",
};

function sanitizeTokenText(value: unknown): string {
  let token = value == null ? "" : String(value);
  for (const [from, to] of Object.entries(TOKEN_CHAR_MAP)) {
    token = token.split(from).join(to);
  }
  token = token.replace(/\s+/g, "");
  if (token.startsWith("sso=")) {
    token = token.slice(4);
  }
  // Keep only ASCII
  return Array.from(token)
    .filter((ch) => ch.charCodeAt(0) <= 0x7f)
    .join("");
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function handleAdminRoutes(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  // All admin routes require app_key auth
  const authErr = await authenticateAppKey(request, env.DB);
  if (authErr) return authErr;

  // GET /v1/admin/verify
  if (path === "/v1/admin/verify" && request.method === "GET") {
    return jsonResponse({ status: "success" });
  }

  // GET /v1/admin/storage
  if (path === "/v1/admin/storage" && request.method === "GET") {
    return jsonResponse({ type: "d1" });
  }

  // GET /v1/admin/config
  if (path === "/v1/admin/config" && request.method === "GET") {
    const config = await loadConfig(env.DB);
    return jsonResponse(config);
  }

  // POST /v1/admin/config
  if (path === "/v1/admin/config" && request.method === "POST") {
    let data: Record<string, unknown>;
    try {
      data = (await request.json()) as Record<string, unknown>;
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }
    try {
      await mergeAndSaveConfig(env.DB, data);
      return jsonResponse({ status: "success", message: "配置已更新" });
    } catch (e) {
      return errorResponse(String(e), 500);
    }
  }

  // GET /v1/admin/tokens
  if (path === "/v1/admin/tokens" && request.method === "GET") {
    return handleGetTokens(env);
  }

  // POST /v1/admin/tokens
  if (path === "/v1/admin/tokens" && request.method === "POST") {
    return handlePostTokens(request, env);
  }

  return null; // not an admin route we handle
}

// ---------------------------------------------------------------------------
// GET /v1/admin/tokens – return tokens grouped by pool
// ---------------------------------------------------------------------------

interface FullTokenRow {
  id: number;
  cookie: string;
  pool: string;
  status: string;
  fail_count: number;
  quota: string | null;
  use_count: number;
  tags: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

async function handleGetTokens(env: Env): Promise<Response> {
  try {
    const rows = await env.DB.prepare(
      "SELECT id, cookie, pool, status, fail_count, quota, use_count, tags, note, created_at, updated_at FROM tokens ORDER BY pool, id",
    ).all<FullTokenRow>();

    const grouped: Record<string, Array<Record<string, unknown>>> = {};
    for (const row of rows.results ?? []) {
      const pool = row.pool ?? "ssoBasic";
      if (!grouped[pool]) grouped[pool] = [];

      let parsedTags: string[] = [];
      if (row.tags) {
        try {
          parsedTags = JSON.parse(row.tags);
        } catch {
          // ignore
        }
      }

      grouped[pool].push({
        token: row.cookie,
        status: row.status,
        fail_count: row.fail_count,
        quota: row.quota ?? null,
        use_count: row.use_count ?? 0,
        tags: parsedTags,
        note: row.note ?? "",
        created_at: row.created_at,
        updated_at: row.updated_at,
      });
    }

    return jsonResponse(grouped);
  } catch (e) {
    return errorResponse(String(e), 500);
  }
}

// ---------------------------------------------------------------------------
// POST /v1/admin/tokens – upsert tokens { pool: [entries] }
// ---------------------------------------------------------------------------

async function handlePostTokens(request: Request, env: Env): Promise<Response> {
  let data: Record<string, unknown>;
  try {
    data = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  try {
    // Load existing tokens for merge
    const existingRows = await env.DB.prepare(
      "SELECT id, cookie, pool, status, fail_count, quota, use_count, tags, note FROM tokens",
    ).all<FullTokenRow>();

    const existingMap = new Map<string, Map<string, FullTokenRow>>();
    for (const row of existingRows.results ?? []) {
      if (!existingMap.has(row.pool)) existingMap.set(row.pool, new Map());
      existingMap.get(row.pool)!.set(row.cookie, row);
    }

    // Clear existing tokens for pools being updated
    const poolsToUpdate = Object.keys(data).filter(
      (k) => Array.isArray(data[k]),
    );
    if (poolsToUpdate.length > 0) {
      for (const pool of poolsToUpdate) {
        await env.DB.prepare("DELETE FROM tokens WHERE pool = ?").bind(pool).run();
      }
    }

    // Insert new tokens
    for (const poolName of poolsToUpdate) {
      const entries = data[poolName] as unknown[];
      for (const item of entries) {
        let tokenData: Record<string, unknown>;
        if (typeof item === "string") {
          tokenData = { token: item };
        } else if (item && typeof item === "object") {
          tokenData = { ...(item as Record<string, unknown>) };
        } else {
          continue;
        }

        const rawToken = tokenData.token;
        const sanitized = sanitizeTokenText(rawToken);
        if (!sanitized) continue;

        // Merge with existing data if available
        const existing = existingMap.get(poolName)?.get(sanitized);

        const status = String(tokenData.status ?? existing?.status ?? "active");
        const failCount = Number(tokenData.fail_count ?? existing?.fail_count ?? 0);
        const quota = tokenData.quota != null ? String(tokenData.quota) : (existing?.quota ?? null);
        const useCount = Number(tokenData.use_count ?? existing?.use_count ?? 0);
        const tags = tokenData.tags != null
          ? JSON.stringify(Array.isArray(tokenData.tags) ? tokenData.tags : [])
          : (existing?.tags ?? "[]");
        const note = tokenData.note != null ? String(tokenData.note) : (existing?.note ?? "");

        await env.DB.prepare(
          "INSERT INTO tokens (cookie, pool, status, fail_count, quota, use_count, tags, note, created_at, updated_at) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))",
        )
          .bind(sanitized, poolName, status, failCount, quota, useCount, tags, note)
          .run();
      }
    }

    return jsonResponse({ status: "success", message: "Token 已更新" });
  } catch (e) {
    return errorResponse(String(e), 500);
  }
}
