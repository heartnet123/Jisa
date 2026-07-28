export interface BYOKConfig {
  provider: string;
  apiKey?: string;
  model: string;
  apiBase?: string;
  customHeaders?: Record<string, string>;
  apiKeys?: Record<string, string>;
}

export interface ProviderTemplate {
  id: string;
  name: string;
  default_model: string;
  models: string[];
  default_base: string;
  requires_key: boolean;
}

export const DEFAULT_PROVIDERS: ProviderTemplate[] = [
  {
    id: "openai",
    name: "OpenAI",
    default_model: "gpt-5.4-mini",
    models: [
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ],
    default_base: "https://api.openai.com/v1",
    requires_key: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    default_model: "claude-sonnet-5",
    models: [
      "claude-sonnet-5",
      "claude-fable-5",
      "claude-opus-4-8",
      "claude-haiku-4-5",
      "claude-3-7-sonnet-20250219",
    ],
    default_base: "https://api.anthropic.com",
    requires_key: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    default_model: "gemini-3.6-flash",
    models: [
      "gemini-3.6-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
      "gemini-3.1-pro",
      "gemini-3-flash",
      "gemini-3.1-flash-lite",
    ],
    default_base: "https://generativelanguage.googleapis.com",
    requires_key: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    default_model: "anthropic/claude-sonnet-5",
    models: [
      "anthropic/claude-sonnet-5",
      "anthropic/claude-fable-5",
      "google/gemini-3.6-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      "meta-llama/llama-3.3-70b-instruct",
      "qwen/qwen-2.5-72b-instruct",
    ],
    default_base: "https://openrouter.ai/api/v1",
    requires_key: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    default_model: "deepseek-v4-flash",
    models: ["deepseek-v4-flash", "deepseek-v4-pro"],
    default_base: "https://api.deepseek.com/v1",
    requires_key: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    default_model: "llama3.3",
    models: ["llama3.3", "llama3.2", "qwen2.5-coder", "deepseek-r1:8b", "mistral", "gemma2"],
    default_base: "http://localhost:11434",
    requires_key: false,
  },
  {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    default_model: "default",
    models: ["default"],
    default_base: "http://localhost:8000/v1",
    requires_key: false,
  },
];


export interface BYOKTestResult {
  status: "success" | "error";
  message: string;
  reply?: string;
  config?: {
    provider: string;
    model: string;
    api_base?: string;
  };
}
