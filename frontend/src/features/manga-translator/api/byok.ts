import { BYOKConfig, ProviderTemplate, BYOKTestResult } from "../types/byok";

const STORAGE_KEY = "jisa_byok_config";

export function getBYOKConfig(): BYOKConfig | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error("Failed to parse BYOK config from localStorage", e);
    return null;
  }
}

export function saveBYOKConfig(config: BYOKConfig): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (e) {
    console.error("Failed to save BYOK config to localStorage", e);
  }
}

export function clearBYOKConfig(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.error("Failed to clear BYOK config from localStorage", e);
  }
}

export function getBYOKHeaders(customConfig?: BYOKConfig | null): Record<string, string> {
  const config = customConfig || getBYOKConfig();
  if (!config) return {};

  const headers: Record<string, string> = {};
  if (config.provider) headers["X-BYOK-Provider"] = config.provider;
  if (config.apiKey) headers["X-BYOK-Key"] = config.apiKey;
  if (config.model) headers["X-BYOK-Model"] = config.model;
  if (config.apiBase) headers["X-BYOK-Api-Base"] = config.apiBase;

  return headers;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export async function fetchBYOKProviders(): Promise<ProviderTemplate[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/byok/providers`);
    if (!res.ok) throw new Error(`HTTP error ${res.status}`);
    const data = await res.json();
    return data.providers || [];
  } catch (e) {
    console.error("Failed to fetch BYOK providers:", e);
    return [];
  }
}

export async function testBYOKConnection(config: BYOKConfig): Promise<BYOKTestResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/byok/test`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        provider: config.provider,
        api_key: config.apiKey,
        model: config.model,
        api_base: config.apiBase,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        status: "error",
        message: data.detail || "Connection test failed.",
      };
    }
    return {
      status: "success",
      message: data.message || "Connection successful!",
      reply: data.reply,
      config: data.config,
    };
  } catch (e: any) {
    return {
      status: "error",
      message: e.message || "Network error while testing connection.",
    };
  }
}
