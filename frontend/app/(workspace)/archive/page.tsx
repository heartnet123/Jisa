'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@iconify-icon/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';
import type { ProcessedManga } from '@/features/manga-translator/types';

export default function ArchivePage() {
  const router = useRouter();
  const {
    files,
    handleRemove,
    healthLoading,
    loadInitialData
  } = useMangaTranslator();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [inspectItem, setInspectItem] = useState<ProcessedManga | null>(null);
  const [inspectMode, setInspectMode] = useState<'translated' | 'inpainted' | 'original'>('translated');

  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  // Filtered files for Archives & Queue list
  const filteredFiles = files.filter(f => {
    const matchesSearch = f.filename.toLowerCase().includes(searchQuery.toLowerCase()) || f.id.includes(searchQuery);
    if (!matchesSearch) return false;

    if (statusFilter === 'all') return true;
    if (statusFilter === 'processing') return ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting'].includes(f.status);
    if (statusFilter === 'awaiting_review') return f.status === 'awaiting_review';
    if (statusFilter === 'completed') return f.status === 'completed';
    if (statusFilter === 'failed') return ['failed', 'error'].includes(f.status);
    return true;
  });

  return (
    <>
      <header className="px-8 py-6 border-b border-[#1c1c1c] bg-[#0b0b0b]/40 flex justify-between items-center z-10">
        <div>
          <h2 className="text-lg font-black tracking-tight uppercase font-mono text-white">
            Manga Translation Archive Queue
          </h2>
          <p className="text-[10px] text-[#666] font-mono uppercase tracking-widest mt-1">
            Interactive catalog // side-by-side inspection // manual triggers
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
          className="space-y-6 max-w-6xl mx-auto"
        >
          {/* Search & Filter bar */}
          <div className="flex flex-col md:flex-row gap-4 justify-between items-center bg-[#0b0b0b] border border-[#1c1c1c] p-4 rounded-lg">
            <div className="relative w-full md:w-80">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-[#555]">
                <Icon icon="mdi:magnify" />
              </span>
              <input
                type="text"
                placeholder="Search archive filename or ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full text-xs font-mono pl-9 pr-4 py-2 border border-[#222] bg-[#121212] rounded text-white focus:outline-none focus:border-cyan-500 transition-colors"
              />
            </div>

            {/* Filter tabs */}
            <div className="flex flex-wrap gap-2 w-full md:w-auto">
              {[
                { id: 'all', label: 'ALL' },
                { id: 'processing', label: 'PROCESSING' },
                { id: 'awaiting_review', label: 'REVIEW REQUIRED' },
                { id: 'completed', label: 'COMPLETED' },
                { id: 'failed', label: 'FAILED' }
              ].map((filt) => (
                <button
                  key={filt.id}
                  onClick={() => setStatusFilter(filt.id)}
                  className={cn(
                    "px-3 py-1.5 text-[9px] font-mono font-bold rounded uppercase tracking-wider transition-all cursor-pointer border",
                    statusFilter === filt.id
                      ? "bg-cyan-500 text-black border-cyan-500"
                      : "bg-[#111] text-[#888] border-[#222] hover:text-white"
                  )}
                >
                  {filt.label}
                </button>
              ))}
            </div>
          </div>

          {/* High density records queue */}
          <div className="bg-[#0b0b0b] border border-[#1c1c1c] rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#1c1c1c] bg-[#111]/60 text-[10px] font-mono text-[#555] uppercase tracking-widest font-black">
                    <th className="py-4 px-6 w-16">Preview</th>
                    <th className="py-4 px-6">Filename & ID</th>
                    <th className="py-4 px-6 w-36">Status</th>
                    <th className="py-4 px-6 w-44">Progress</th>
                    <th className="py-4 px-6 w-44 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1c1c1c] text-xs font-mono">
                  {filteredFiles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-[#555] uppercase">
                        No matching files detected in Jisa Archive.
                      </td>
                    </tr>
                  ) : (
                    filteredFiles.map((file) => {
                      const isCompleted = file.status === 'completed';
                      const isAwaitingReview = file.status === 'awaiting_review';
                      const isFailed = ['failed', 'error'].includes(file.status);
                      const isProcessing = ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting', 'uploading'].includes(file.status);

                      return (
                        <tr key={file.id} className="hover:bg-[#111]/30 transition-colors group">
                          {/* Thumbnail */}
                          <td className="py-4 px-6">
                            <div className="w-10 h-14 bg-black border border-[#222] rounded overflow-hidden relative cursor-pointer"
                              onClick={() => {
                                if (isCompleted) {
                                  setInspectItem(file);
                                  setInspectMode('translated');
                                } else if (isAwaitingReview) {
                                  router.push(`/editor/${file.id}?from=/archive`);
                                }
                              }}
                            >
                              <img 
                                src={file.originalUrl || file.result_url || ''} 
                                alt="preview" 
                                className="w-full h-full object-cover grayscale-[0.3] hover:scale-110 transition-transform duration-300"
                              />
                            </div>
                          </td>

                          {/* Info */}
                          <td className="py-4 px-6">
                            <span className="text-white font-bold block uppercase text-xs truncate max-w-[240px]" title={file.filename}>
                              {file.filename}
                            </span>
                            <span className="text-[9px] text-[#444] uppercase tracking-tighter">
                              UUID: {file.id}
                            </span>
                          </td>

                          {/* Status Badges */}
                          <td className="py-4 px-6">
                            <span className={cn(
                              "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9px] font-black uppercase tracking-wider",
                              isCompleted && "bg-green-500/5 border-green-500/40 text-green-500",
                              isAwaitingReview && "bg-yellow-500/5 border-yellow-500/40 text-yellow-500 animate-pulse shadow-[0_0_8px_rgba(234,179,8,0.1)]",
                              isFailed && "bg-red-500/5 border-red-500/40 text-red-500",
                              isProcessing && "bg-cyan-500/5 border-cyan-500/40 text-cyan-500"
                            )}>
                              <span className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                isCompleted && "bg-green-500",
                                isAwaitingReview && "bg-yellow-500",
                                isFailed && "bg-red-500",
                                isProcessing && "bg-cyan-500 animate-pulse"
                              )} />
                              {file.status}
                            </span>
                          </td>

                          {/* Progress Gauge */}
                          <td className="py-4 px-6">
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-1.5 bg-[#111] border border-[#222] rounded overflow-hidden">
                                <div 
                                  className={cn(
                                    "h-full",
                                    isFailed ? "bg-red-500" : "bg-cyan-500 shadow-[0_0_5px_#06b6d4]"
                                  )}
                                  style={{ width: `${file.progress}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-[#666] font-mono">{file.progress}%</span>
                            </div>
                          </td>

                          {/* Actions Menu */}
                          <td className="py-4 px-6 text-right">
                            <div className="flex gap-2 justify-end">
                              {isAwaitingReview && (
                                <button
                                  onClick={() => router.push(`/editor/${file.id}?from=/archive`)}
                                  className="px-2.5 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black border border-yellow-500 rounded font-bold uppercase tracking-wider text-[8px] font-mono flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                                  title="Launch Studio editor"
                                >
                                  <Icon icon="mdi:translate" /> REVIEW
                                </button>
                              )}

                              {isCompleted && (
                                <button
                                  onClick={() => {
                                    setInspectItem(file);
                                    setInspectMode('translated');
                                  }}
                                  className="px-2.5 py-1.5 bg-[#111] hover:bg-[#1c1c1c] text-cyan-400 border border-[#222] hover:border-cyan-500/30 rounded font-bold uppercase tracking-wider text-[8px] font-mono flex items-center gap-1 cursor-pointer transition-colors"
                                  title="Inspect final typeset"
                                >
                                  <Icon icon="mdi:magnify" /> INSPECT
                                </button>
                              )}

                              {isCompleted && file.result_url && (
                                <a
                                  href={file.result_url}
                                  download={file.filename}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="p-1.5 border border-[#222] bg-[#111] hover:bg-[#1a1a1a] hover:border-cyan-500/20 text-[#888] hover:text-white rounded text-xs flex items-center justify-center transition-colors"
                                  title="Download publication sheet"
                                >
                                  <Icon icon="mdi:download" />
                                </a>
                              )}

                              <button
                                onClick={() => handleRemove(file.id)}
                                className="p-1.5 border border-[#222] text-[#444] hover:text-red-500 hover:border-red-500 hover:bg-red-500/5 rounded text-xs flex items-center justify-center transition-colors cursor-pointer"
                                title="Unlink and delete record"
                              >
                                <Icon icon="mdi:delete-outline" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      </div>

      {/* 🖼️ COMPLETED PUBLICATION MAGNIFY / INSPECT MODAL */}
      <AnimatePresence>
        {inspectItem && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-md flex flex-col font-sans overflow-hidden"
          >
            {/* Header control */}
            <header className="flex items-center justify-between px-6 py-4 border-b border-[#222] bg-[#0c0c0c] shrink-0">
              <div className="flex items-center gap-3">
                <Icon icon="mdi:magnify" className="text-xl text-cyan-500" />
                <h2 className="text-sm font-bold tracking-tight uppercase font-mono text-white">
                  Publication Inspector <span className="text-[#444]">{"//"}</span> Slide View
                </h2>
                <span className="text-[10px] font-mono bg-cyan-950 text-cyan-400 border border-cyan-800/40 px-2 py-0.5 rounded">
                  {inspectItem.filename}
                </span>
              </div>

              <div className="flex gap-4 items-center">
                {/* Layer toggles */}
                <div className="flex bg-[#111] border border-[#333] p-1 rounded">
                  {[
                    { id: 'original', label: 'RAW INPUT' },
                    { id: 'inpainted', label: 'CLEANED (INPAINT)' },
                    { id: 'translated', label: 'TYPESET PUBLICATION' }
                  ].map((mode) => (
                    <button
                      key={mode.id}
                      onClick={() => setInspectMode(mode.id as 'translated' | 'inpainted' | 'original')}
                      className={cn(
                        "px-3 py-1 text-[9px] font-mono font-bold transition-all cursor-pointer",
                        inspectMode === mode.id
                          ? "bg-cyan-500 text-black"
                          : "text-[#888] hover:text-white"
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>

                {inspectItem.result_url && (
                  <a
                    href={inspectItem.result_url}
                    download={inspectItem.filename}
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 border border-cyan-500/30 bg-cyan-500/10 hover:bg-cyan-500 hover:text-black font-bold uppercase tracking-widest text-[9px] font-mono transition-all rounded flex items-center gap-1.5"
                  >
                    <Icon icon="mdi:download" />
                    Download
                  </a>
                )}

                <button
                  onClick={() => setInspectItem(null)}
                  className="p-2 border border-[#333] hover:border-red-500 hover:text-red-500 hover:bg-red-500/5 transition-all text-xs rounded font-mono uppercase tracking-widest flex items-center gap-1"
                >
                  <Icon icon="mdi:close" /> Close
                </button>
              </div>
            </header>

            {/* Split comparison viewports */}
            <div className="flex-1 flex bg-[#060606] p-6 gap-6 justify-center items-center overflow-hidden">
              {/* Left Side: Original page */}
              <div className="flex-1 max-h-full aspect-[3/4] bg-black border border-[#222] overflow-hidden flex items-center justify-center relative rounded">
                <div className="absolute top-4 left-4 z-10 px-2 py-1 bg-black/85 border border-[#333] text-[9px] font-mono uppercase tracking-[0.2em] text-[#888] rounded">
                  Raw Input (Original)
                </div>
                <img 
                  src={inspectItem.originalUrl} 
                  alt="Original Raw" 
                  className="max-w-full max-h-full object-contain filter grayscale-[0.2]"
                />
              </div>

              {/* Right Side: Selected layer */}
              <div className="flex-1 max-h-full aspect-[3/4] bg-black border border-cyan-500/20 overflow-hidden flex items-center justify-center relative rounded shadow-2xl">
                <div className="absolute top-4 left-4 z-10 px-2.5 py-1 bg-cyan-950/90 border border-cyan-500/30 text-[9px] font-mono uppercase tracking-[0.2em] text-cyan-400 rounded">
                  {inspectMode === 'original' && "Raw Input layer"}
                  {inspectMode === 'inpainted' && "Cleaned Artwork (Inpainted)"}
                  {inspectMode === 'translated' && "Premium Typeset Translated"}
                </div>
                <img 
                  src={
                    inspectMode === 'translated' 
                      ? inspectItem.result_url || inspectItem.originalUrl 
                      : inspectMode === 'inpainted' 
                        ? inspectItem.inpainted_url || inspectItem.originalUrl 
                        : inspectItem.originalUrl
                  } 
                  alt="Inspector View" 
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
