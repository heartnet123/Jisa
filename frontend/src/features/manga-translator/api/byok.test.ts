import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fetchBYOKProviders, testBYOKConnection } from "./byok";
import { DEFAULT_PROVIDERS } from "../types/byok";

describe("BYOK API and providers configuration", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetchBYOKProviders makes request to API_BASE_URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ providers: [{ id: "test", name: "Test" }] }),
    });
    global.fetch = mockFetch;

    const providers = await fetchBYOKProviders();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/byok/providers");
    expect(providers).toEqual([{ id: "test", name: "Test" }]);
  });

  it("testBYOKConnection makes POST request to API_BASE_URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: "success", message: "Connected" }),
    });
    global.fetch = mockFetch;

    const res = await testBYOKConnection({ provider: "openai", apiKey: "sk-test", model: "gpt-4o" });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("/api/byok/test");
    expect(res.status).toBe("success");
  });

  it("DEFAULT_PROVIDERS defines valid default_base for ollama and custom", () => {
    const ollama = DEFAULT_PROVIDERS.find((p) => p.id === "ollama");
    const custom = DEFAULT_PROVIDERS.find((p) => p.id === "custom");

    expect(ollama).toBeDefined();
    expect(ollama?.default_base).toContain("11434");

    expect(custom).toBeDefined();
    if (custom?.default_base) {
      expect(custom?.default_base).toMatch(/^https?:\/\/.*\/v1$/);
      expect(custom?.default_base).not.toContain("//v1");
    } else {
      expect(custom?.default_base).toBe("");
    }
  });
});
