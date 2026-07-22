import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Icon } from "@iconify-icon/react";
import { BYOKConfig, ProviderTemplate, BYOKTestResult } from "../types/byok";
import {
  getBYOKConfig,
  saveBYOKConfig,
  clearBYOKConfig,
  fetchBYOKProviders,
  testBYOKConnection,
} from "../api/byok";

interface BYOKSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfigSaved?: (config: BYOKConfig | null) => void;
}

const DEFAULT_PROVIDERS: ProviderTemplate[] = [
  {
    id: "openai",
    name: "OpenAI",
    default_model: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "o3-mini"],
    default_base: "https://api.openai.com/v1",
    requires_key: true,
  },
  {
    id: "anthropic",
    name: "Anthropic",
    default_model: "claude-3-5-sonnet-20241022",
    models: ["claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
    default_base: "https://api.anthropic.com",
    requires_key: true,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    default_model: "gemini-1.5-flash",
    models: ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash-exp"],
    default_base: "https://generativelanguage.googleapis.com",
    requires_key: true,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    default_model: "anthropic/claude-3.5-sonnet",
    models: [
      "anthropic/claude-3.5-sonnet",
      "google/gemini-flash-1.5",
      "deepseek/deepseek-r1",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    default_base: "https://openrouter.ai/api/v1",
    requires_key: true,
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    default_model: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    default_base: "https://api.deepseek.com/v1",
    requires_key: true,
  },
  {
    id: "ollama",
    name: "Ollama (Local)",
    default_model: "llama3.2",
    models: ["llama3.2", "mistral", "qwen2.5-coder"],
    default_base: "http://localhost:11434",
    requires_key: false,
  },
  {
    id: "custom",
    name: "Custom OpenAI-Compatible",
    default_model: "default",
    models: [],
    default_base: "http://localhost:8000/v1",
    requires_key: false,
  },
];

export const BYOKSettingsModal: React.FC<BYOKSettingsModalProps> = ({
  isOpen,
  onClose,
  onConfigSaved,
}) => {
  const [providers, setProviders] = useState<ProviderTemplate[]>(DEFAULT_PROVIDERS);
  const [provider, setProvider] = useState<string>("openai");
  const [apiKey, setApiKey] = useState<string>("");
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [apiBase, setApiBase] = useState<string>("https://api.openai.com/v1");

  const [showKey, setShowKey] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<BYOKTestResult | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Load available providers from backend
      fetchBYOKProviders().then((res) => {
        if (res && res.length > 0) setProviders(res);
      });

      // Load saved BYOK config
      const saved = getBYOKConfig();
      if (saved) {
        setProvider(saved.provider || "openai");
        setApiKey(saved.apiKey || "");
        setModel(saved.model || "gpt-4o-mini");
        setApiBase(saved.apiBase || "https://api.openai.com/v1");
      }
      setTestResult(null);
    }
  }, [isOpen]);

  const activeProvider = providers.find((p) => p.id === provider) || DEFAULT_PROVIDERS[0];

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    setProvider(selectedId);
    const found = providers.find((p) => p.id === selectedId);
    if (found) {
      setModel(found.default_model);
      setApiBase(found.default_base);
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const config: BYOKConfig = {
      provider,
      apiKey: apiKey.trim() || undefined,
      model: model.trim(),
      apiBase: apiBase.trim() || undefined,
    };

    const result = await testBYOKConnection(config);
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = () => {
    const config: BYOKConfig = {
      provider,
      apiKey: apiKey.trim() || undefined,
      model: model.trim(),
      apiBase: apiBase.trim() || undefined,
    };

    saveBYOKConfig(config);
    if (onConfigSaved) onConfigSaved(config);
    onClose();
  };

  const handleClear = () => {
    clearBYOKConfig();
    setApiKey("");
    setProvider("openai");
    setModel("gpt-4o-mini");
    setApiBase("https://api.openai.com/v1");
    setTestResult(null);
    if (onConfigSaved) onConfigSaved(null);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          />

          {/* Modal Container */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 15 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 15 }}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl bg-zinc-900 border border-zinc-800 p-6 text-zinc-100 shadow-2xl z-10"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4 mb-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600/20 text-violet-400 border border-violet-500/30">
                  <Icon icon="solar:key-minimalistic-square-bold-duotone" className="text-2xl" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-zinc-100">AI Provider & BYOK Settings</h3>
                  <p className="text-xs text-zinc-400">Configure your custom API Key and Model</p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
              >
                <Icon icon="solar:close-circle-bold" className="text-xl" />
              </button>
            </div>

            {/* Form Fields */}
            <div className="space-y-4 text-sm">
              {/* Provider Selection */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">AI Provider</label>
                <select
                  value={provider}
                  onChange={handleProviderChange}
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-zinc-100 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key */}
              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="text-xs font-medium text-zinc-300">
                    API Key {activeProvider.requires_key && <span className="text-rose-400">*</span>}
                  </label>
                  <span className="text-[11px] text-zinc-500">Stored in browser localStorage</span>
                </div>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={activeProvider.requires_key ? "sk-..." : "Optional / None"}
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 pr-10 text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                  >
                    <Icon icon={showKey ? "solar:eye-bold" : "solar:eye-closed-bold"} className="text-lg" />
                  </button>
                </div>
              </div>

              {/* Model Input & Selector */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Model Name / ID</label>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g. gpt-4o-mini, claude-3-5-sonnet, llama3.2"
                    className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2.5 text-zinc-100 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all"
                  />
                  {activeProvider.models.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[11px] text-zinc-500 py-0.5">Presets:</span>
                      {activeProvider.models.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setModel(m)}
                          className={`text-xs px-2.5 py-0.5 rounded-full border transition-all ${
                            model === m
                              ? "bg-violet-600/30 text-violet-300 border-violet-500/50"
                              : "bg-zinc-800/60 text-zinc-400 border-zinc-700/50 hover:bg-zinc-800 hover:text-zinc-200"
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Base URL (Optional / Advanced) */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">API Base URL</label>
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                  className="w-full rounded-xl bg-zinc-950 border border-zinc-800 px-3.5 py-2 text-xs text-zinc-300 placeholder:text-zinc-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 transition-all font-mono"
                />
              </div>

              {/* Connection Test Output */}
              {testResult && (
                <div
                  className={`rounded-xl p-3.5 text-xs border ${
                    testResult.status === "success"
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
                      : "bg-rose-500/10 text-rose-300 border-rose-500/30"
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium">
                    <Icon
                      icon={
                        testResult.status === "success"
                          ? "solar:check-circle-bold"
                          : "solar:danger-triangle-bold"
                      }
                      className="text-base"
                    />
                    <span>{testResult.message}</span>
                  </div>
                  {testResult.reply && (
                    <p className="mt-1.5 text-[11px] opacity-80 border-t border-emerald-500/20 pt-1.5 font-mono">
                      Provider Reply: &quot;{testResult.reply}&quot;
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between border-t border-zinc-800 mt-6 pt-4">
              <button
                type="button"
                onClick={handleClear}
                className="text-xs text-zinc-500 hover:text-rose-400 transition-colors px-2 py-1"
              >
                Reset / Clear Key
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={testing}
                  onClick={handleTestConnection}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800 px-3.5 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-all disabled:opacity-50"
                >
                  {testing ? (
                    <>
                      <Icon icon="svg-spinners:ring-resize" className="text-sm" />
                      <span>Testing...</span>
                    </>
                  ) : (
                    <>
                      <Icon icon="solar:bolt-bold" className="text-sm text-amber-400" />
                      <span>Test Connection</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSave}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-violet-600 px-4 py-2 text-xs font-medium text-white hover:bg-violet-500 transition-all shadow-lg shadow-violet-600/25"
                >
                  <span>Save Config</span>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
