export type MangaStatus =
  | "uploading"
  | "queued"
  | "segmenting"
  | "ocr"
  | "translating"
  | "awaiting_review"
  | "inpainting"
  | "typesetting"
  | "completed"
  | "error"
  | "canceled"
  | "failed";

export interface NormalizedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TextAlign = "left" | "center" | "right";

export interface TypesettingSettings {
  font_name?: string | null;
  font_size?: number | null;
  auto_fit: boolean;
  text_align: TextAlign;
  padding_ratio: number;
}

export interface BlockItem {
  id: string;
  box: NormalizedBox;
  source: "detected" | "manual";
  text?: string;
  translated_text?: string;
  mask_available?: boolean;
  typesetting?: TypesettingSettings;
}

export interface TypesettingFontItem {
  name: string;
  label: string;
}

export interface IntRange {
  min: number;
  max: number;
}

export interface FloatRange {
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface TypesettingOptionsResponse {
  fonts: TypesettingFontItem[];
  default_font_name?: string | null;
  font_size: IntRange;
  padding_ratio: FloatRange;
  alignments: TextAlign[];
}

export interface TypesetPreviewRequest {
  client_revision: number;
  translated_text?: string;
  typesetting: TypesettingSettings;
}

export interface TypesetPreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TypesetPreviewResponse {
  client_revision: number;
  mime_type: string;
  overlay_base64: string;
  bounds_px: TypesetPreviewBounds;
  lines: string[];
  requested_font_size?: number | null;
  resolved_font_size: number;
  auto_shrunk: boolean;
  overflow: boolean;
  truncated: boolean;
}

export interface RegionCollectionResponse {
  region_mode: "detected" | "manual_override";
  regions: BlockItem[];
}

export interface MaskPreviewResponse {
  url: string;
  revision: number;
}

export interface ProcessedManga {
  id: string;
  filename: string;
  originalUrl: string;
  original_url?: string;
  result_url?: string;
  inpainted_url?: string;
  ocr_text?: string;
  translated_text?: string;
  error?: string;
  message?: string;
  status: MangaStatus;
  progress: number;
  blocks?: BlockItem[];
  project_id?: string;
  sequence_id?: number;
  region_mode?: "detected" | "manual_override";
  mask_preview_url?: string;
  preview_revision?: number;
}

export interface BatchUploadResponse {
  id: string;
  status: string;
  jobs?: ProcessedManga[];
}

export interface TranslationConfig {
  // ponytail: support all LiteLLM providers (openai, anthropic, gemini, openrouter, deepseek, ollama, custom)
  provider: string;
  model: string;
  systemPrompt: string;
  apiKey?: string;
  apiBase?: string;
}

export interface Project {
  id: string;
  name: string;
  created_at: string;
  job_ids: string[];
  page_order: string[];
}

export interface SystemHealth {
  ollama: {
    status: string;
    models: string[];
    ocr_model: string;
  };
  translation: {
    byok_configured: boolean;
    model: string;
    page_context_translation: boolean;
  };
  hardware: {
    cuda_available: boolean;
    device: string;
    device_name: string;
    torch_version: string;
  };
  assets: {
    fonts: string[];
  };
  stats: {
    total: number;
    active: number;
    awaiting_review: number;
    completed: number;
    failed: number;
  };
}

