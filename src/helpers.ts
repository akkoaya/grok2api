/**
 * Shared helper functions for grok2api Cloudflare Worker
 */

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS, ...headers },
  });
}

export function errorResponse(message: string, status: number): Response {
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

export function handleCorsPreFlight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
