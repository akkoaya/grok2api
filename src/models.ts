/**
 * Model catalog – keep in sync with app/services/grok/services/model.py
 */

import type { ModelDef } from "./types";

// __MODEL_CATALOG_START__
export const MODEL_CATALOG: ModelDef[] = [
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

export const MODEL_MAP = new Map(MODEL_CATALOG.map((m) => [m.id, m]));
