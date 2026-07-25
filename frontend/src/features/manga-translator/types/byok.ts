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
