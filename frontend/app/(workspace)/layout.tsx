'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Icon } from '@iconify-icon/react';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';
import { TranslationEditor } from '@/features/manga-translator/components/TranslationEditor';

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { files, projects, systemHealth, activeHITLItem, setActiveHITLItem, handleUpdate, sseStatus, bootstrapError } = useMangaTranslator();



  const activeJobs = files.filter(f => 
    ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting', 'uploading'].includes(f.status)
  );
  const awaitingReviewCount = files.filter(f => f.status === 'awaiting_review').length;

  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  const isLinkActive = (path: string) => {
    if (path === '/projects') {
      return pathname.startsWith('/projects');
    }
    return pathname === path;
  };

  return (
    <div className="flex h-screen bg-[#070707] text-[#ededed] font-sans selection:bg-cyan-500/30 overflow-hidden">
      
      {/* 🚀 SIDEBAR COMMAND CONTROL */}
      <aside className="w-80 border-r border-[#1c1c1c] bg-[#0b0b0b] flex flex-col justify-between shrink-0 select-none z-20">
        <div className="flex flex-col overflow-y-auto">
          {/* Logo & Header */}
          <div className="p-6 border-b border-[#1c1c1c] bg-black/40">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-cyan-500 flex items-center justify-center rounded shadow-[0_0_15px_rgba(6,182,212,0.6)]">
                <Icon icon="mdi:translate-variant" className="text-black text-xl font-bold" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tighter uppercase italic text-transparent bg-clip-text bg-gradient-to-r from-white via-[#e1e1e1] to-cyan-400">
                  JISA STUDIO
                </h1>
                <p className="text-[10px] text-[#555] font-mono tracking-widest uppercase">
                  Manga Synthesis v1.0
                </p>
              </div>
            </div>
          </div>

          {/* Navigation Commands */}
          <nav className="p-4 space-y-2 mt-4">
            <span className="px-3 text-[9px] font-mono text-[#444] uppercase tracking-[0.25em] font-black block mb-2">
              Command Suite
            </span>
            
            <Link
              href="/overview"
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                isLinkActive('/overview')
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:view-dashboard-outline" className={cn("text-lg", isLinkActive('/overview') ? "text-cyan-400" : "text-[#555]")} />
              Overview Statistics
              {activeJobs.length > 0 && (
                <span className="absolute right-4 w-4 h-4 bg-cyan-500 text-black text-[9px] font-black font-sans rounded-full flex items-center justify-center animate-pulse">
                  {activeJobs.length}
                </span>
              )}
            </Link>

            <Link
              href="/projects"
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                isLinkActive('/projects')
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:view-grid-plus-outline" className={cn("text-lg", isLinkActive('/projects') ? "text-cyan-400" : "text-[#555]")} />
              Project Workspace
              {projects.length > 0 && (
                <span className="absolute right-4 w-4 h-4 bg-cyan-950 text-cyan-400 border border-cyan-800/40 text-[9px] font-black font-sans rounded-full flex items-center justify-center">
                  {projects.length}
                </span>
              )}
            </Link>

            <Link
              href="/archive"
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                isLinkActive('/archive')
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:folder-multiple-image" className={cn("text-lg", isLinkActive('/archive') ? "text-cyan-400" : "text-[#555]")} />
              Archives & Queue
              {awaitingReviewCount > 0 && (
                <span className="absolute right-4 px-1.5 py-0.5 bg-yellow-500 text-black text-[8px] font-black font-sans rounded-full flex items-center justify-center animate-bounce shadow-[0_0_8px_#eab308]">
                  REVIEW
                </span>
              )}
            </Link>

            <Link
              href="/config"
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded text-left transition-all duration-300 font-mono text-xs uppercase tracking-wider relative group",
                isLinkActive('/config')
                  ? "bg-[#151b22] text-cyan-400 border border-cyan-500/20 shadow-[0_0_15px_rgba(6,182,212,0.05)]"
                  : "text-[#888] hover:text-[#eee] hover:bg-[#111]"
              )}
            >
              <Icon icon="mdi:tune-variant" className={cn("text-lg", isLinkActive('/config') ? "text-cyan-400" : "text-[#555]")} />
              Linguistic Engine
            </Link>
          </nav>
        </div>

        {/* Hardware Status Bottom Bar */}
        <div className="p-4 border-t border-[#1c1c1c] bg-black/20 space-y-3 font-mono text-[9px] text-[#555]">
          <span className="text-[#333] uppercase tracking-[0.2em] font-black block">System Profile</span>
          <div className="flex justify-between">
            <span>Hardware:</span>
            <span className="text-cyan-500/80 font-bold">{systemHealth?.hardware?.device_name || "RTX 4060 Ready"}</span>
          </div>
          <div className="flex justify-between">
            <span>CUDA Accel:</span>
            <span className={systemHealth?.hardware?.cuda_available ? "text-green-500" : "text-amber-500"}>
              {systemHealth?.hardware?.cuda_available ? "ACTIVE" : "CPU ONLY"}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Torch Framework:</span>
            <span>{systemHealth?.hardware?.torch_version || "PyTorch 2.4.1"}</span>
          </div>
        </div>
      </aside>

      {/* 🖥️ MAIN WORKSPACE VIEWPORT */}
      <main className="flex-1 flex flex-col overflow-hidden bg-[#070707] relative">
        {sseStatus === 'reconnecting' && (
          <div role="alert" className="bg-yellow-950/40 border-b border-yellow-500/35 px-8 py-2 text-xs font-mono text-yellow-400 flex items-center gap-2 shrink-0">
            <Icon icon="eos-icons:loading" className="animate-spin text-sm" />
            <span>Connection lost. Reconnecting to live update stream...</span>
          </div>
        )}
        {bootstrapError && (
          <div role="alert" className="bg-red-950/40 border-b border-red-500/35 px-8 py-2 text-xs font-mono text-red-400 flex items-center gap-2 shrink-0">
            <Icon icon="mdi:alert-circle-outline" className="text-sm" />
            <span>Failed to bootstrap initial workspace data: {bootstrapError}</span>
          </div>
        )}
        {children}
      </main>

      {activeHITLItem && (
        <TranslationEditor
          item={activeHITLItem}
          onClose={() => setActiveHITLItem(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
