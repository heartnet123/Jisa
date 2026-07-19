'use client';

import React from 'react';
import { Icon } from '@iconify-icon/react';
import { motion } from 'framer-motion';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';
import { ThaiText } from '@/features/manga-translator/components/ThaiText';
import type { TranslationConfig } from '@/features/manga-translator/types';

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
    runSandboxTest
  } = useMangaTranslator();

  return (
    <>
      <header className="px-8 py-6 border-b border-[#1c1c1c] bg-[#0b0b0b]/40 flex justify-between items-center z-10">
        <div>
          <h2 className="text-lg font-black tracking-tight uppercase font-mono text-white">
            Fine-Tuning Configuration & Sandbox
          </h2>
          <p className="text-[10px] text-[#666] font-mono uppercase tracking-widest mt-1">
            Model selection // prompt editing // sandboxed testing
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
          {/* Configuration Panel */}
          <div className="space-y-6 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg">
            <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between">
              <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
                Fine-Tuning linguistic profile
              </span>
              <Icon icon="mdi:cog" className="text-cyan-500 text-lg" />
            </div>

            <div className="space-y-4 font-mono text-xs">
              {/* Provider Select */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">API LLM provider</label>
                <select 
                  value={config.provider}
                  onChange={(e) => setConfig(prev => ({ ...prev, provider: e.target.value as TranslationConfig['provider'] }))}
                  className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs cursor-pointer"
                >
                  <option value="openai">OpenAI (GPT BYOK)</option>
                  <option value="ollama">Ollama (Local LLM)</option>
                  <option value="anthropic">Anthropic (Claude BYOK)</option>
                </select>
              </div>

              {/* Model Selector */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">Linguistic model</label>
                {config.provider === 'ollama' && systemHealth && systemHealth.ollama && systemHealth.ollama.models.length > 0 ? (
                  <select
                    value={config.model}
                    onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                    className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs cursor-pointer"
                  >
                    {systemHealth.ollama.models.map((m: string) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={config.model}
                    onChange={(e) => setConfig(prev => ({ ...prev, model: e.target.value }))}
                    placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                    className="w-full bg-[#121212] border border-[#222] p-2.5 rounded text-white focus:outline-none focus:border-cyan-500 text-xs"
                  />
                )}
              </div>

              {/* Default Typesetting font selection */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">Primary typesetting font</label>
                <div className="grid grid-cols-2 gap-2 bg-[#121212] p-1 border border-[#222] rounded">
                  <button className="py-2 text-[10px] bg-cyan-500 text-black font-black uppercase rounded tracking-widest">
                    ITIM REGULAR
                  </button>
                  <button className="py-2 text-[10px] text-[#888] font-bold uppercase rounded tracking-widest hover:text-white" disabled>
                    IANNNNN COW
                  </button>
                </div>
                <span className="text-[9px] text-[#444] block uppercase leading-relaxed mt-1">
                  Fonts matched dynamically in assets folder. Itim-Regular provides standard publication quality.
                </span>
              </div>

              {/* System Prompt config */}
              <div className="space-y-2">
                <label className="text-[10px] text-[#555] uppercase tracking-widest block font-bold">System instructions (Translator Prompt)</label>
                <textarea
                  value={config.systemPrompt}
                  onChange={(e) => setConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                  className="w-full bg-[#121212] border border-[#222] p-3 h-48 rounded text-white focus:outline-none focus:border-cyan-500 font-sans leading-relaxed text-xs resize-none"
                />
              </div>
            </div>
          </div>

          {/* Ad-Hoc Text translation testing Sandbox */}
          <div className="space-y-6 bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg flex flex-col">
            <div className="border-b border-[#1c1c1c] pb-4 flex items-center justify-between">
              <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
                Context Translation Sandbox
              </span>
              <Icon icon="mdi:test-tube" className="text-cyan-500 text-lg" />
            </div>

            <div className="flex-1 flex flex-col justify-between space-y-4">
              {/* Sandbox Input */}
              <div className="space-y-2">
                <label className="text-[10px] text-cyan-500/80 font-mono uppercase tracking-widest block font-bold">Japanese Dialogue Block</label>
                <textarea
                  value={sandboxText}
                  onChange={(e) => setSandboxText(e.target.value)}
                  placeholder="พิมพ์ภาษาญี่ปุ่นเพื่อทดสอบคำแปล..."
                  className="w-full bg-[#121212] border border-[#222] hover:border-[#333] focus:border-cyan-500 p-3 h-28 rounded text-white focus:outline-none text-sm leading-relaxed"
                />
              </div>

              {/* Run action */}
              <button
                onClick={runSandboxTest}
                disabled={sandboxLoading || !sandboxText.trim()}
                className="w-full flex items-center justify-center gap-2 py-3 bg-cyan-500 hover:bg-cyan-400 disabled:bg-[#1a1a1a] disabled:text-[#444] text-black font-black uppercase tracking-widest font-mono rounded transition-colors shadow-lg shadow-cyan-500/10 cursor-pointer"
              >
                {sandboxLoading ? (
                  <>
                    <Icon icon="eos-icons:loading" className="text-base" /> Running context Translation...
                  </>
                ) : (
                  <>
                    <Icon icon="mdi:play" className="text-base" /> Run Translation Test
                  </>
                )}
              </button>

              {/* Sandbox Output */}
              <div className="space-y-2 flex-1 flex flex-col justify-end">
                <div className="flex justify-between items-center">
                  <label className="text-[10px] text-[#555] font-mono uppercase tracking-widest block font-bold">Thai Output Draft</label>
                  {sandboxTime && (
                    <span className="text-[9px] text-cyan-500/60 font-mono font-bold uppercase tracking-wider">
                      SPEED: {sandboxTime}ms
                    </span>
                  )}
                </div>

                <div className="w-full bg-black/40 border border-[#222] p-4 rounded min-h-[140px] flex flex-col justify-center relative select-all">
                  {sandboxLoading ? (
                    <div className="text-center text-xs text-[#555] font-mono animate-pulse">
                      Processing deep LLM structures...
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
          </div>
        </motion.div>
      </div>

      {/* 🏢 Bottom Info Grid Footer */}
      <footer className="px-8 py-4 border-t border-[#1c1c1c] bg-[#0b0b0b]/40 text-center flex flex-wrap justify-between items-center shrink-0">
        <span className="text-[#333] font-mono text-[9px] uppercase tracking-widest font-black">
          JISA SYSTEMS INC // SECURE LOCALHOST PIPELINE
        </span>
        <p className="text-[#333] font-mono text-[9px] uppercase tracking-widest flex items-center gap-4">
          <span className="flex items-center gap-1"><Icon icon="logos:nextjs-icon" /> Next.js 16</span>
          <span className="flex items-center gap-1"><Icon icon="logos:fastapi" /> FastAPI</span>
          <span className="flex items-center gap-1 text-cyan-500/70"><Icon icon="mdi:nvidia" /> RTX 4060 READY</span>
        </p>
      </footer>
    </>
  );
}
