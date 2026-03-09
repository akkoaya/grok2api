/**
 * D1-backed configuration storage with defaults from config.defaults.toml
 */

import type { AppConfig, ConfigRow } from "./types";

const CONFIG_KEY = "__config__";

/**
 * Default configuration – mirrors config.defaults.toml
 */
export const DEFAULT_CONFIG: AppConfig = {
  app: {
    app_url: "",
    app_key: "grok2api",
    api_key: "",
    function_enabled: false,
    function_key: "",
    image_format: "url",
    video_format: "html",
    temporary: true,
    disable_memory: true,
    stream: true,
    thinking: true,
    dynamic_statsig: true,
    custom_instruction: "",
    filter_tags: ["xaiartifact", "xai:tool_usage_card", "grok:render"],
  },
  proxy: {
    base_proxy_url: "",
    asset_proxy_url: "",
    cf_cookies: "",
    skip_proxy_ssl_verify: false,
    enabled: false,
    flaresolverr_url: "",
    refresh_interval: 3600,
    timeout: 60,
    cf_clearance: "",
    browser: "chrome136",
    user_agent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
  },
  retry: {
    max_retry: 3,
    retry_status_codes: [401, 429, 403],
    reset_session_status_codes: [403],
    retry_backoff_base: 0.5,
    retry_backoff_factor: 2.0,
    retry_backoff_max: 20.0,
    retry_budget: 60.0,
  },
  token: {
    auto_refresh: true,
    refresh_interval_hours: 8,
    super_refresh_interval_hours: 2,
    fail_threshold: 5,
    save_delay_ms: 500,
    usage_flush_interval_sec: 5,
    reload_interval_sec: 30,
  },
  cache: {
    enable_auto_clean: true,
    limit_mb: 512,
  },
  chat: {
    concurrent: 50,
    timeout: 60,
    stream_timeout: 60,
  },
  image: {
    timeout: 60,
    stream_timeout: 60,
    final_timeout: 15,
    blocked_grace_seconds: 10,
    nsfw: true,
    medium_min_bytes: 30000,
    final_min_bytes: 100000,
    blocked_parallel_attempts: 5,
    blocked_parallel_enabled: true,
  },
  imagine_fast: {
    n: 1,
    size: "1024x1024",
    response_format: "url",
  },
  video: {
    concurrent: 100,
    timeout: 60,
    stream_timeout: 60,
    upscale_timing: "complete",
  },
  voice: {
    timeout: 60,
  },
  asset: {
    upload_concurrent: 100,
    upload_timeout: 60,
    download_concurrent: 100,
    download_timeout: 60,
    list_concurrent: 100,
    list_timeout: 60,
    list_batch_size: 50,
    delete_concurrent: 100,
    delete_timeout: 60,
    delete_batch_size: 50,
  },
  nsfw: {
    concurrent: 60,
    batch_size: 30,
    timeout: 60,
  },
  usage: {
    concurrent: 100,
    batch_size: 50,
    timeout: 60,
  },
};

/**
 * Deep-merge source into target (mutates target).
 * Arrays are replaced, not concatenated.
 */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      tv !== null &&
      typeof tv === "object" &&
      !Array.isArray(tv)
    ) {
      target[key] = deepMerge(
        { ...(tv as Record<string, unknown>) },
        sv as Record<string, unknown>,
      );
    } else {
      target[key] = sv;
    }
  }
  return target;
}

/**
 * Load config from D1, deep-merged with DEFAULT_CONFIG.
 */
export async function loadConfig(db: D1Database): Promise<AppConfig> {
  try {
    const row = await db
      .prepare("SELECT value FROM config WHERE key = ?")
      .bind(CONFIG_KEY)
      .first<ConfigRow>();
    if (row?.value) {
      const stored = JSON.parse(row.value) as Record<string, unknown>;
      const merged = deepMerge(
        JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as Record<string, unknown>,
        stored,
      );
      return merged as unknown as AppConfig;
    }
  } catch {
    // If table doesn't exist or parse fails, fall back to defaults
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as AppConfig;
}

/**
 * Save the full config object into D1.
 */
export async function saveConfig(db: D1Database, config: AppConfig): Promise<void> {
  const value = JSON.stringify(config);
  await db
    .prepare(
      "INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(CONFIG_KEY, value)
    .run();
}

/**
 * Get a nested config value using dot notation (e.g. "app.api_key").
 */
export function getConfigValue(config: AppConfig, path: string, defaultValue?: unknown): unknown {
  const parts = path.split(".");
  let current: unknown = config;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return defaultValue;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current ?? defaultValue;
}

/**
 * Merge partial update into existing config (like Python config.update).
 */
export async function mergeAndSaveConfig(
  db: D1Database,
  partial: Record<string, unknown>,
): Promise<AppConfig> {
  const existing = await loadConfig(db);
  const merged = deepMerge(
    existing as unknown as Record<string, unknown>,
    sanitizeProxyConfig(partial),
  );
  const result = merged as unknown as AppConfig;
  await saveConfig(db, result);
  return result;
}

// ---------------------------------------------------------------------------
// Config sanitization – mirrors Python _sanitize_proxy_config_payload
// ---------------------------------------------------------------------------

const CFG_CHAR_MAP: Record<string, string> = {
  "\u2010": "-",
  "\u2011": "-",
  "\u2012": "-",
  "\u2013": "-",
  "\u2014": "-",
  "\u2212": "-",
  "\u2018": "'",
  "\u2019": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u00a0": " ",
  "\u2007": " ",
  "\u202f": " ",
  "\u200b": "",
  "\u200c": "",
  "\u200d": "",
  "\ufeff": "",
};

function sanitizeText(value: unknown, removeAllSpaces = false): string {
  let text = value == null ? "" : String(value);
  for (const [from, to] of Object.entries(CFG_CHAR_MAP)) {
    text = text.split(from).join(to);
  }
  if (removeAllSpaces) {
    text = text.replace(/\s+/g, "");
  } else {
    text = text.trim();
  }
  // Filter to latin-1 range
  return Array.from(text)
    .filter((ch) => ch.charCodeAt(0) <= 0xff)
    .join("");
}

function sanitizeProxyConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!data || typeof data !== "object") return data;
  const payload = { ...data };
  const proxy = payload.proxy;
  if (!proxy || typeof proxy !== "object" || Array.isArray(proxy)) return payload;

  const sanitized = { ...(proxy as Record<string, unknown>) };
  let changed = false;

  if ("user_agent" in sanitized) {
    const raw = sanitized.user_agent;
    const val = sanitizeText(raw);
    if (val !== raw) {
      sanitized.user_agent = val;
      changed = true;
    }
  }
  if ("cf_cookies" in sanitized) {
    const raw = sanitized.cf_cookies;
    const val = sanitizeText(raw);
    if (val !== raw) {
      sanitized.cf_cookies = val;
      changed = true;
    }
  }
  if ("cf_clearance" in sanitized) {
    const raw = sanitized.cf_clearance;
    const val = sanitizeText(raw, true);
    if (val !== raw) {
      sanitized.cf_clearance = val;
      changed = true;
    }
  }
  if (changed) {
    payload.proxy = sanitized;
  }
  return payload;
}
