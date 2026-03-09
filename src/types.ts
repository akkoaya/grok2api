/**
 * Shared type definitions for grok2api Cloudflare Worker
 */

export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  ASSETS: Fetcher;
  BUILD_SHA: string;
  UPSTREAM_BASE_URL?: string;
}

export interface TokenRow {
  id: number;
  cookie: string;
  pool: string;
  status: string;
  fail_count: number;
  quota: string | null;
  use_count: number;
  tags: string | null;
  note: string | null;
}

export interface ApiKeyRow {
  key: string;
}

export interface ConfigRow {
  key: string;
  value: string;
  updated_at: string;
}

export interface ModelDef {
  id: string;
  grok_model: string;
  model_mode: string;
  tier: "basic" | "super";
  is_image: boolean;
  is_image_edit: boolean;
  is_video: boolean;
}

/** Shape stored in D1 config table (key = __config__) */
export interface AppConfig {
  app: {
    app_url: string;
    app_key: string;
    api_key: string;
    function_enabled: boolean;
    function_key: string;
    image_format: string;
    video_format: string;
    temporary: boolean;
    disable_memory: boolean;
    stream: boolean;
    thinking: boolean;
    dynamic_statsig: boolean;
    custom_instruction: string;
    filter_tags: string[];
  };
  proxy: {
    base_proxy_url: string;
    asset_proxy_url: string;
    cf_cookies: string;
    skip_proxy_ssl_verify: boolean;
    enabled: boolean;
    flaresolverr_url: string;
    refresh_interval: number;
    timeout: number;
    cf_clearance: string;
    browser: string;
    user_agent: string;
  };
  retry: {
    max_retry: number;
    retry_status_codes: number[];
    reset_session_status_codes: number[];
    retry_backoff_base: number;
    retry_backoff_factor: number;
    retry_backoff_max: number;
    retry_budget: number;
  };
  token: {
    auto_refresh: boolean;
    refresh_interval_hours: number;
    super_refresh_interval_hours: number;
    fail_threshold: number;
    save_delay_ms: number;
    usage_flush_interval_sec: number;
    reload_interval_sec: number;
  };
  cache: {
    enable_auto_clean: boolean;
    limit_mb: number;
  };
  chat: {
    concurrent: number;
    timeout: number;
    stream_timeout: number;
  };
  image: {
    timeout: number;
    stream_timeout: number;
    final_timeout: number;
    blocked_grace_seconds: number;
    nsfw: boolean;
    medium_min_bytes: number;
    final_min_bytes: number;
    blocked_parallel_attempts: number;
    blocked_parallel_enabled: boolean;
  };
  imagine_fast: {
    n: number;
    size: string;
    response_format: string;
  };
  video: {
    concurrent: number;
    timeout: number;
    stream_timeout: number;
    upscale_timing: string;
  };
  voice: {
    timeout: number;
  };
  asset: {
    upload_concurrent: number;
    upload_timeout: number;
    download_concurrent: number;
    download_timeout: number;
    list_concurrent: number;
    list_timeout: number;
    list_batch_size: number;
    delete_concurrent: number;
    delete_timeout: number;
    delete_batch_size: number;
  };
  nsfw: {
    concurrent: number;
    batch_size: number;
    timeout: number;
  };
  usage: {
    concurrent: number;
    batch_size: number;
    timeout: number;
  };
  [key: string]: unknown;
}
