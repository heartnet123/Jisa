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
}

export interface TranslationConfig {
  provider: 'ollama' | 'openai' | 'anthropic';
  model: string;
  systemPrompt: string;
  apiKey?: string;
}
