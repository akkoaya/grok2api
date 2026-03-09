/**
 * /v1/models endpoint
 */

import { MODEL_CATALOG } from "../models";
import { jsonResponse } from "../helpers";

export function handleModels(): Response {
  const now = Math.floor(Date.now() / 1000);
  const data = MODEL_CATALOG.map((m) => ({
    id: m.id,
    object: "model" as const,
    created: now,
    owned_by: "xai",
  }));
  return jsonResponse({ object: "list", data });
}
