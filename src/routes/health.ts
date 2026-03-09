/**
 * /health endpoint
 */

import type { Env } from "../types";
import { jsonResponse } from "../helpers";

export function handleHealth(env: Env): Response {
  return jsonResponse({
    status: "ok",
    build_sha: env.BUILD_SHA ?? "dev",
    timestamp: new Date().toISOString(),
  });
}
