/**
 * Authentication module – 3 auth methods matching Python app/core/auth.py
 */

import type { Env, AppConfig } from "./types";
import { loadConfig } from "./config";
import { errorResponse } from "./helpers";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractBearer(request: Request): string | null {
  const auth = request.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const key = auth.slice(7).trim();
  return key || null;
}

/**
 * Constant-time string comparison using crypto.subtle.
 * Falls back to simple === if lengths differ (already leaks length but that's OK).
 */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const aBuf = enc.encode(a);
  const bBuf = enc.encode(b);
  const key = await crypto.subtle.importKey(
    "raw",
    aBuf,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, bBuf);
  const expected = await crypto.subtle.sign("HMAC", key, aBuf);
  const sigArr = new Uint8Array(sig);
  const expArr = new Uint8Array(expected);
  if (sigArr.length !== expArr.length) return false;
  let result = 0;
  for (let i = 0; i < sigArr.length; i++) {
    result |= sigArr[i]! ^ expArr[i]!;
  }
  return result === 0;
}

function normalizeApiKeys(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value
      .filter((v): v is string => typeof v === "string" && v.trim() !== "")
      .map((v) => v.trim());
  }
  return [];
}

// ---------------------------------------------------------------------------
// API Key auth (for /v1/chat/completions, /v1/models)
// ---------------------------------------------------------------------------

/**
 * Authenticate using api_key from config (comma-separated) + api_keys D1 table.
 * Returns null on success, or an error Response.
 * If no api_key is configured and no keys in DB, authentication is skipped.
 */
export async function authenticateApiKey(
  request: Request,
  db: D1Database,
  config?: AppConfig,
): Promise<Response | null> {
  const cfg = config ?? (await loadConfig(db));
  const apiKeys = normalizeApiKeys(cfg.app.api_key);

  // Check if any keys are configured (config or DB)
  let hasDbKeys = false;
  if (apiKeys.length === 0) {
    try {
      const count = await db
        .prepare("SELECT COUNT(*) as cnt FROM api_keys")
        .first<{ cnt: number }>();
      hasDbKeys = (count?.cnt ?? 0) > 0;
    } catch {
      // Table may not exist yet
    }
  }

  // No keys configured at all → skip auth
  if (apiKeys.length === 0 && !hasDbKeys) {
    return null;
  }

  const bearer = extractBearer(request);
  if (!bearer) {
    return errorResponse("Missing or malformed Authorization header", 401);
  }

  // Check config keys
  for (const key of apiKeys) {
    if (await timingSafeEqual(bearer, key)) {
      return null;
    }
  }

  // Check D1 api_keys table
  try {
    const row = await db
      .prepare("SELECT key FROM api_keys WHERE key = ?")
      .bind(bearer)
      .first<{ key: string }>();
    if (row) return null;
  } catch {
    // Table may not exist
  }

  return errorResponse("Invalid API key", 401);
}

// ---------------------------------------------------------------------------
// App Key auth (for /v1/admin/*)
// ---------------------------------------------------------------------------

/**
 * Authenticate using app_key (backend admin password).
 * app_key must be configured; returns error Response on failure, null on success.
 */
export async function authenticateAppKey(
  request: Request,
  db: D1Database,
  config?: AppConfig,
): Promise<Response | null> {
  const cfg = config ?? (await loadConfig(db));
  const appKey = (cfg.app.app_key ?? "").trim();

  if (!appKey) {
    return errorResponse("App key is not configured", 401);
  }

  const bearer = extractBearer(request);
  if (!bearer) {
    return errorResponse("Missing authentication token", 401);
  }

  if (!(await timingSafeEqual(bearer, appKey))) {
    return errorResponse("Invalid authentication token", 401);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Function Key auth (for /v1/function/*)
// ---------------------------------------------------------------------------

/**
 * Authenticate using function_key.
 * - If function_key is empty and function_enabled=true → allow (no auth)
 * - If function_key is empty and function_enabled=false → deny
 * - If function_key is set → require Bearer match
 */
export async function authenticateFunctionKey(
  request: Request,
  db: D1Database,
  config?: AppConfig,
): Promise<Response | null> {
  const cfg = config ?? (await loadConfig(db));
  const functionKey = (cfg.app.function_key ?? "").trim();
  const functionEnabled = Boolean(cfg.app.function_enabled);

  if (!functionKey) {
    if (functionEnabled) {
      return null; // open access
    }
    return errorResponse("Function access is disabled", 401);
  }

  const bearer = extractBearer(request);
  if (!bearer) {
    return errorResponse("Missing authentication token", 401);
  }

  if (!(await timingSafeEqual(bearer, functionKey))) {
    return errorResponse("Invalid authentication token", 401);
  }

  return null;
}

/**
 * Check if function mode is enabled.
 */
export async function isFunctionEnabled(db: D1Database, config?: AppConfig): Promise<boolean> {
  const cfg = config ?? (await loadConfig(db));
  return Boolean(cfg.app.function_enabled);
}
