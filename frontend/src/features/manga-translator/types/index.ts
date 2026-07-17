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

export interface BlockItem {
  id: string;
  box: number[];
  text?: string;
  translated_text?: string;
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
}

export interface TranslationConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  systemPrompt: string;
  apiKey?: string;
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

