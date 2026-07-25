'use client';

import React, { useState, useEffect } from 'react';
import { Icon } from '@iconify-icon/react';
import { motion } from 'framer-motion';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';
import { ThaiText } from '@/features/manga-translator/components/ThaiText';
import type { ProviderTemplate, BYOKConfig, BYOKTestResult } from '@/features/manga-translator/types/byok';
import {
  getBYOKConfig,
  saveBYOKConfig,
  fetchBYOKProviders,
  testBYOKConnection,
} from '@/features/manga-translator/api/byok';

// ponytail: static fallback provider options if API is loading or unreachable
const DEFAULT_PROVIDERS: ProviderTemplate[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    default_model: 'gpt-5.4-mini',
    models: [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ],
    default_base: 'https://api.openai.com/v1',
    requires_key: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    default_model: 'claude-sonnet-5',
    models: [
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-haiku-4-5',
      'claude-3-7-sonnet-20250219',
    ],
    default_base: 'https://api.anthropic.com',
    requires_key: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    default_model: 'gemini-3.6-flash',
    models: [
      'gemini-3.6-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-3.1-pro',
      'gemini-3-flash',
      'gemini-3.1-flash-lite',
    ],
    default_base: 'https://generativelanguage.googleapis.com',
    requires_key: true,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    default_model: 'anthropic/claude-sonnet-5',
    models: [
      'anthropic/claude-sonnet-5',
      'anthropic/claude-fable-5',
      'google/gemini-3.6-flash',
      'deepseek/deepseek-v4-pro',
      'deepseek/deepseek-v4-flash',
      'meta-llama/llama-3.3-70b-instruct',
      'qwen/qwen-2.5-72b-instruct',
    ],
    default_base: 'https://openrouter.ai/api/v1',
    requires_key: true,
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    default_model: 'deepseek-v4-flash',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    default_base: 'https://api.deepseek.com/v1',
    requires_key: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    default_model: 'llama3.3',
    models: ['llama3.3', 'llama3.2', 'qwen2.5-coder', 'deepseek-r1:8b', 'mistral', 'gemma2'],
    default_base: 'http://localhost:11434',
    requires_key: false,
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    default_model: 'default',
    models: ['default'],
    default_base: 'http://localhost:8000/v1',
    requires_key: false,
  },
];

export default function ConfigPage() {
  const {
    config,
    setConfig,
    systemHealth,
    healthLoading,
    loadInitialData,
    sandboxText,
    setSandboxText,
    sandboxResult,
    sandboxLoading,
    sandboxError,
    sandboxTime,
    runSandboxTest,
  } = useMangaTranslator();

  const [providers, setProviders] = useState<ProviderTemplate[]>(DEFAULT_PROVIDERS);
  const [apiKey, setApiKey] = useState<string>('');
  const [showKey, setShowKey] = useState<boolean>(false);
  const [testing, setTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<BYOKTestResult | null>(null);

  // ponytail: load providers from backend & saved BYOK config on mount
  useEffect(() => {
    fetchBYOKProviders().then((res) => {
      if (res && res.length > 0) setProviders(res);
    });

    const saved = getBYOKConfig();
    if (saved) {
      const activeProv = saved.provider || config.provider || 'openai';
      const keyForProv =
        saved.apiKeys?.[activeProv] ?? (saved.provider === activeProv ? saved.apiKey : '') ?? '';
      setApiKey(keyForProv);
    }
  }, []);

  const activeProvider = providers.find((p) => p.id === config.provider) || DEFAULT_PROVIDERS[0];

  // Resolve available models (ensure config.model is always included in option list)
  const rawModels =
    config.provider === 'ollama' && systemHealth?.ollama?.models?.length
      ? systemHealth.ollama.models
      : activeProvider.models;

  const availableModels =
    config.model && !rawModels.includes(config.model)
      ? [config.model, ...rawModels]
      : rawModels;

  const handleProviderChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    const found = providers.find((p) => p.id === selectedId) || DEFAULT_PROVIDERS[0];
    const defaultModel = found.default_model || found.models[0] || 'default';

    const saved = getBYOKConfig();
    const providerKey =
      saved?.apiKeys?.[selectedId] ?? (saved?.provider === selectedId ? saved.apiKey : '') ?? '';
    setApiKey(providerKey);

    setConfig((prev) => ({
      ...prev,
      provider: selectedId,
      model: defaultModel,
      apiKey: providerKey || undefined,
      apiBase: found.default_base,
    }));
    setTestResult(null);
  };

  const handleApiKeyChange = (val: string) => {
    setApiKey(val);
    setConfig((prev) => ({
      ...prev,
      apiKey: val.trim() || undefined,
    }));
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);

    const byokConfig: BYOKConfig = {
      provider: config.provider,
      apiKey: apiKey.trim() || undefined,
      model: config.model,
      apiBase: activeProvider.default_base,
    };

    const result = await testBYOKConnection(byokConfig);
    setTestResult(result);
    setTesting(false);
  };

  const handleSaveConfig = () => {
    const byokConfig: BYOKConfig = {
      provider: config.provider,
      apiKey: apiKey.trim() || undefined,
      model: config.model,
      apiBase: activeProvider.default_base,
    };

    saveBYOKConfig(byokConfig);
    setConfig((prev) => ({
      ...prev,
      provider: byokConfig.provider,
      model: byokConfig.model,
      apiKey: byokConfig.apiKey,
      apiBase: byokConfig.apiBase,
    }));
  };

  return (
    <>
      <header className="px-8 py-6 border-b border-[#1c1c1c] bg-[#0b0b0b]/40 flex justify-between items-center z-10">
        <div>
          <h2 className="text-lg font-black tracking-tight uppercase font-mono text-white">
            LiteLLM Fine-Tuning & Sandbox
          </h2>
          <p className="text-[10px] text-[#666] font-mono uppercase tracking-widest mt-1">
            LiteLLM Provider Routing // BYOK Key Manager // Sandboxed Test
          </p>
        </div>

        <div className="flex gap-3">
          {healthLoading ? (
            <span className="flex items-center gap-1.5 text-xs text-[#555] font-mono">
              <Icon icon="eos-icons:loading" className="text-cyan-500" /> Connecting API...
            </span>
          ) : (
            <button
              onClick={loadInitialData}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[#222] bg-[#111] hover:bg-[#181818] transition-all rounded text-[10px] font-mono uppercase tracking-widest text-[#aaa] cursor-pointer"
            >
              <Icon icon="mdi:refresh" /> Refresh API
            </button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 relative">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-6xl mx-auto"
        >
          {/* Left Column: Config Panel */}
          <div className="space-y-6">
            {/* Card 1: Provider & API Keys */}
            <div className="space-y-4 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg font-mono text-xs">
              <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between">
                <span className="text-[#666] uppercase tracking-widest font-bold block">
                  Provider & API Keys
                </span>
                <span className="text-[10px] text-[#444] uppercase">BYOK Mode</span>
              </div>

              {/* Provider Selection */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">
                  Provider
                </label>
                <select
                  value={config.provider}
                  onChange={handleProviderChange}
                  className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs cursor-pointer"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* API Key Input */}
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">
                    API Key{' '}
                    {activeProvider.requires_key && <span className="text-rose-400">*</span>}
                  </label>
                  <span className="text-[9px] text-[#444]">Stored in localStorage</span>
                </div>
                <div className="relative">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(e) => handleApiKeyChange(e.target.value)}
                    placeholder={activeProvider.requires_key ? 'sk-...' : 'Optional / None'}
                    className="w-full bg-[#121212] border border-[#222] p-2.5 pr-10 rounded text-white focus:outline-none focus:border-cyan-500 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#555] hover:text-[#aaa]"
                  >
                    <Icon icon={showKey ? 'mdi:eye' : 'mdi:eye-off'} className="text-sm" />
                  </button>
                </div>
              </div>

              {/* Model Dropdown */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">
                  Model
                </label>
                <select
                  value={config.model}
                  onChange={(e) => setConfig((prev) => ({ ...prev, model: e.target.value }))}
                  className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs cursor-pointer"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Test & Save Actions */}
              <div className="flex gap-3 pt-2 border-t border-[#1c1c1c]">
                <button
                  type="button"
                  disabled={testing}
                  onClick={handleTestConnection}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 border border-[#222] bg-[#111] hover:bg-[#181818] transition-all rounded text-[10px] font-mono uppercase tracking-widest text-[#aaa] cursor-pointer disabled:opacity-50"
                >
                  {testing ? (
                    <>
                      <Icon icon="eos-icons:loading" className="text-cyan-500" /> Testing...
                    </>
                  ) : (
                    <span>Test Connection</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSaveConfig}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-cyan-500 hover:bg-cyan-400 text-black font-black uppercase tracking-widest rounded transition-all text-[10px] cursor-pointer"
                >
                  Save Config
                </button>
              </div>

              {/* Test Result Output Banner */}
              {testResult && (
                <div
                  className={`p-3 rounded text-[11px] border ${
                    testResult.status === 'success'
                      ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400'
                      : 'bg-rose-950/30 border-rose-500/30 text-rose-400'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-bold">
                    <Icon
                      icon={
                        testResult.status === 'success'
                          ? 'mdi:check-circle'
                          : 'mdi:alert-circle'
                      }
                    />
                    <span>{testResult.message}</span>
                  </div>
                  {testResult.reply && (
                    <p className="mt-1 text-[10px] opacity-80 border-t border-emerald-500/20 pt-1 font-mono">
                      Provider Reply: &quot;{testResult.reply}&quot;
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Card 2: Linguistic Profile & Font */}
            <div className="space-y-4 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg font-mono text-xs">
              <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between">
                <span className="text-[#666] uppercase tracking-widest font-bold block">
                  2. Linguistic Profile & Font
                </span>
                <Icon icon="mdi:cog" className="text-cyan-500 text-lg" />
              </div>

              {/* Default Typesetting font selection */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">
                  Primary typesetting font
                </label>
                <div className="grid grid-cols-2 gap-2 bg-[#121212] p-1 border border-[#222] rounded">
                  <button className="py-2 text-[10px] bg-cyan-500 text-black font-black uppercase rounded tracking-widest">
                    ITIM REGULAR
                  </button>
                  <button
                    className="py-2 text-[10px] text-[#888] font-bold uppercase rounded tracking-widest hover:text-white"
                    disabled
                  >
                    IANNNNN COW
                  </button>
                </div>
                <span className="text-[9px] text-[#444] block uppercase leading-relaxed mt-1">
                  Fonts matched dynamically in assets folder. Itim-Regular provides standard publication quality.
                </span>
              </div>

              {/* System Prompt config */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">
                  System instructions (Translator Prompt)
                </label>
                <textarea
                  value={config.systemPrompt}
                  onChange={(e) =>
                    setConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))
                  }
                  className="w-full bg-[#121212] border border-[#222] p-3 h-36 rounded text-white focus:outline-none focus:border-cyan-500 font-sans leading-relaxed text-xs resize-none"
                />
              </div>
            </div>
          </div>

          {/* Right Column: Context Translation Sandbox */}
          <div className="space-y-6 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg flex flex-col justify-between">
            <div>
              <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between mb-4">
                <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
                  3. Context Translation Sandbox
                </span>
                <Icon icon="mdi:test-tube" className="text-cyan-500 text-lg" />
              </div>

              {/* Sandbox Input */}
              <div className="space-y-2 mb-4">
                <label className="text-[10px] text-cyan-500/80 font-mono uppercase tracking-widest block font-bold">
                  Japanese Dialogue Block
                </label>
                <textarea
                  value={sandboxText}
                  onChange={(e) => setSandboxText(e.target.value)}
                  placeholder="พิมพ์ภาษาญี่ปุ่นเพื่อทดสอบคำแปล..."
                  className="w-full bg-[#121212] border border-[#222] hover:border-[#333] focus:border-cyan-500 p-3 h-28 rounded text-white focus:outline-none text-sm leading-relaxed"
                />
              </div>

              {/* Run Action */}
              <button
                onClick={runSandboxTest}
                disabled={sandboxLoading || !sandboxText.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-[#1a1a1a] disabled:text-[#444] text-black font-black uppercase tracking-widest font-mono rounded transition-colors shadow-lg shadow-cyan-500/10 cursor-pointer"
              >
                {sandboxLoading ? (
                  <>
                    <Icon icon="eos-icons:loading" className="text-base" /> Running LiteLLM Translation...
                  </>
                ) : (
                  <>
                    <Icon icon="mdi:play" className="text-base" /> Run Translation Test
                  </>
                )}
              </button>
            </div>

            {/* Sandbox Output */}
            <div className="space-y-2 mt-6">
              <div className="flex justify-between items-center">
                <label className="text-[10px] text-[#555] font-mono uppercase tracking-widest block font-bold">
                  Thai Output Draft
                </label>
                {sandboxTime && (
                  <span className="text-[9px] text-cyan-500/60 font-mono font-bold uppercase tracking-wider">
                    SPEED: {sandboxTime}ms
                  </span>
                )}
              </div>

              <div className="w-full bg-black/40 border border-[#222] p-4 rounded min-h-[140px] flex flex-col justify-center relative select-all">
                {sandboxLoading ? (
                  <div className="text-center text-xs text-[#555] font-mono animate-pulse">
                    Routing translation request via LiteLLM...
                  </div>
                ) : sandboxError ? (
                  <div className="text-xs text-red-500 font-mono leading-relaxed bg-red-950/20 border border-red-500/20 p-2">
                    Sandbox Error: {sandboxError}
                  </div>
                ) : sandboxResult ? (
                  <div className="p-1">
                    <ThaiText className="text-cyan-400 text-sm leading-relaxed block font-medium">
                      {sandboxResult}
                    </ThaiText>
                  </div>
                ) : (
                  <div className="text-center text-xs text-[#444] font-mono uppercase tracking-widest select-none">
                    Awaiting sandbox simulation execution
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <footer className="px-8 py-4 border-t border-[#1c1c1c] bg-[#0b0b0b]/40 text-center flex flex-wrap justify-between items-center shrink-0">
        <span className="text-[#333] font-mono text-[9px] uppercase tracking-widest font-black">
          JISA SYSTEMS INC // LITELLM ROUTER INTEGRATION
        </span>
        <p className="text-[#333] font-mono text-[9px] uppercase tracking-widest flex items-center gap-4">
          <span className="flex items-center gap-1">
            <Icon icon="logos:nextjs-icon" /> Next.js 16
          </span>
          <span className="flex items-center gap-1">
            <Icon icon="logos:fastapi" /> FastAPI BYOK
          </span>
          <span className="flex items-center gap-1 text-cyan-500/70">
            <Icon icon="mdi:nvidia" /> RTX 4060 READY
          </span>
        </p>
      </footer>
    </>
  );
}
