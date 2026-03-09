/**
 * HTML page routes – serves static pages via env.ASSETS
 */

import type { Env } from "../types";
import { isFunctionEnabled } from "../auth";
import { errorResponse } from "../helpers";
import { loadConfig } from "../config";

/**
 * Serve a static HTML file via the ASSETS binding.
 * The ASSETS binding serves files relative to the configured assets directory.
 */
async function serveAsset(env: Env, assetPath: string): Promise<Response> {
  const url = new URL(assetPath, "https://dummy.host");
  const req = new Request(url.toString());
  try {
    const resp = await env.ASSETS.fetch(req);
    if (resp.status === 404) {
      return errorResponse("Page not found", 404);
    }
    return resp;
  } catch {
    return errorResponse("Page not found", 404);
  }
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location } });
}

export async function handlePageRoutes(
  request: Request,
  env: Env,
  path: string,
): Promise<Response | null> {
  const config = await loadConfig(env.DB);
  const funcEnabled = Boolean(config.app.function_enabled);

  // Root
  if (path === "/") {
    return funcEnabled ? redirect("/login") : redirect("/admin/login");
  }

  // Favicon
  if (path === "/favicon.ico") {
    return redirect("/static/common/img/favicon/favicon.ico");
  }

  // Function pages (require function_enabled)
  if (path === "/login") {
    if (!funcEnabled) return errorResponse("Not Found", 404);
    return serveAsset(env, "/function/pages/login.html");
  }
  if (path === "/chat") {
    if (!funcEnabled) return errorResponse("Not Found", 404);
    return serveAsset(env, "/function/pages/chat.html");
  }
  if (path === "/imagine") {
    if (!funcEnabled) return errorResponse("Not Found", 404);
    return serveAsset(env, "/function/pages/imagine.html");
  }
  if (path === "/video") {
    if (!funcEnabled) return errorResponse("Not Found", 404);
    return serveAsset(env, "/function/pages/video.html");
  }
  if (path === "/voice") {
    if (!funcEnabled) return errorResponse("Not Found", 404);
    return serveAsset(env, "/function/pages/voice.html");
  }

  // Admin pages
  if (path === "/admin") {
    return redirect("/admin/login");
  }
  if (path === "/admin/login") {
    return serveAsset(env, "/admin/pages/login.html");
  }
  if (path === "/admin/config") {
    return serveAsset(env, "/admin/pages/config.html");
  }
  if (path === "/admin/cache") {
    return serveAsset(env, "/admin/pages/cache.html");
  }
  if (path === "/admin/token") {
    return serveAsset(env, "/admin/pages/token.html");
  }

  // Static assets – pass through to ASSETS binding
  if (path.startsWith("/static/")) {
    return serveAsset(env, path);
  }

  return null; // not a page route
}
