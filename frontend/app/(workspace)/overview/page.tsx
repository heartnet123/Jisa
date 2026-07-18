'use client';

import React, { useCallback } from 'react';
import { Icon } from '@iconify-icon/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useMangaTranslator, ALLOWED_IMAGE_TYPES } from '@/features/manga-translator/context/MangaTranslatorContext';
import { MangaFileItem } from '@/features/manga-translator/components/MangaFileItem';

export default function OverviewPage() {
  const {
    files,
    isDragging,
    setIsDragging,
    isUploading,
    uploadBatch,
    handleUpdate,
    handleRemove,
    healthLoading,
    loadInitialData
  } = useMangaTranslator();

  // Helper utility for class names within the component file
  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  const totalUploaded = files.length;
  const activeJobs = files.filter(f => 
    ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting'].includes(f.status)
  );
  const completedJobsCount = files.filter(f => f.status === 'completed').length;
  const awaitingReviewCount = files.filter(f => f.status === 'awaiting_review').length;
  const successRate = totalUploaded > 0 
    ? Math.round((completedJobsCount / totalUploaded) * 100) 
    : 100;

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
      ALLOWED_IMAGE_TYPES.includes(file.type),
    );
    uploadBatch(droppedFiles);
  }, [uploadBatch, setIsDragging]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, [setIsDragging]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, [setIsDragging]);

  return (
    <>
      <header className="px-8 py-6 border-b border-[#1c1c1c] bg-[#0b0b0b]/40 flex justify-between items-center z-10">
        <div>
          <h2 className="text-lg font-black tracking-tight uppercase font-mono text-white">
            Dashboard Control center
          </h2>
          <p className="text-[10px] text-[#666] font-mono uppercase tracking-widest mt-1">
            Active jobs // Hardware health // Quick uploads
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
          className="space-y-8 max-w-6xl mx-auto"
        >
          {/* Stats Card Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Stat Card 1: Completed */}
            <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg relative overflow-hidden group hover:border-green-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-6xl text-green-500 font-black">
                <Icon icon="mdi:checkbox-marked-circle-outline" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Finalized Publications
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-green-400 group-hover:scale-105 transition-transform duration-300">
                  {completedJobsCount}
                </span>
                <span className="text-xs text-[#444] font-mono">pages</span>
              </div>
              <p className="text-[10px] text-[#666] mt-3 font-mono">typeset and rendered</p>
            </div>

            {/* Stat Card 2: Active */}
            <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg relative overflow-hidden group hover:border-cyan-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-6xl text-cyan-500 font-black">
                <Icon icon="eos-icons:loading" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Active Synthesis In-Flight
              </span>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-3xl font-black font-mono group-hover:scale-105 transition-transform duration-300",
                  activeJobs.length > 0 ? "text-cyan-400" : "text-[#777]"
                )}>
                  {activeJobs.length}
                </span>
                <span className="text-xs text-[#444] font-mono">running</span>
              </div>
              <p className="text-[10px] text-[#666] mt-3 font-mono">under GPU segmentation</p>
            </div>

            {/* Stat Card 3: Awaiting HITL */}
            <div className={cn(
              "border p-5 rounded-lg relative overflow-hidden group transition-all duration-300 bg-[#0b0b0b] border-[#1c1c1c]",
              awaitingReviewCount > 0 && "bg-yellow-950/15 border-yellow-500/35 hover:border-yellow-400/50 shadow-[0_0_15px_rgba(234,179,8,0.03)]"
            )}>
              <div className="absolute top-0 right-0 p-3 opacity-[0.04] text-6xl text-yellow-500 font-black">
                <Icon icon="mdi:translate" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Human Review Gates
              </span>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-3xl font-black font-mono group-hover:scale-105 transition-transform duration-300",
                  awaitingReviewCount > 0 ? "text-yellow-400 animate-pulse" : "text-[#777]"
                )}>
                  {awaitingReviewCount}
                </span>
                <span className="text-xs text-[#444] font-mono">pending</span>
              </div>
              <p className={cn(
                "text-[10px] mt-3 font-mono",
                awaitingReviewCount > 0 ? "text-yellow-400/70" : "text-[#666]"
              )}>
                {awaitingReviewCount > 0 ? "Awaiting manual translation studio" : "zero blocks locked"}
              </p>
            </div>

            {/* Stat Card 4: Success Rate */}
            <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-5 rounded-lg relative overflow-hidden group hover:border-purple-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-6xl text-purple-500 font-black">
                <Icon icon="mdi:percent" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Success Rate (Yield)
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-black font-mono text-[#d946ef] group-hover:scale-105 transition-transform duration-300">
                  {successRate}%
                </span>
              </div>
              <p className="text-[10px] text-[#666] mt-3 font-mono">out of {totalUploaded} pages uploaded</p>
            </div>
          </div>

          {/* Grid layout for Uploader and Live processing files */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left columns (2): Drag Drop Upload */}
            <div className="lg:col-span-2 space-y-6">
              <div className="p-4 border-b border-[#1c1c1c] bg-[#0c0c0c] flex items-center justify-between rounded-t">
                <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold">
                  Ingestion Console
                </span>
                <span className="text-[9px] font-mono text-[#444] uppercase tracking-widest">
                  Drag or click file target
                </span>
              </div>

              <section
                onDrop={onDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.accept = ALLOWED_IMAGE_TYPES.join(',');
                  input.onchange = (e) => {
                    const fileList = Array.from((e.target as HTMLInputElement).files || []);
                    uploadBatch(fileList);
                  };
                  input.click();
                }}
                className={cn(
                  "relative group cursor-pointer border border-dashed rounded-lg transition-all duration-500 flex flex-col items-center justify-center p-20",
                  isDragging ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_20px_rgba(6,182,212,0.1)]" : "border-[#222] hover:border-cyan-500/30 bg-[#0a0a0a]",
                  isUploading && "animate-pulse cursor-wait"
                )}
              >
                <div className="absolute inset-0 opacity-0 group-hover:opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-cyan-500 via-transparent to-transparent transition-opacity duration-500" />
                
                <div className="relative z-10 text-center">
                  <div className="w-16 h-16 rounded-full bg-[#111] border border-[#222] group-hover:border-cyan-500/40 flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-all duration-300">
                    <Icon 
                      icon={isUploading ? "eos-icons:loading" : "mdi:cloud-upload-outline"}
                      className={cn("text-3xl text-[#666] transition-colors group-hover:text-cyan-400", isDragging && "text-cyan-500 animate-pulse")}
                    />
                  </div>
                  <h3 className="text-sm font-bold uppercase tracking-tight text-white mb-2 font-mono">
                    {isUploading ? "Uploading Batch..." : "Drop raw manga sheets here"}
                  </h3>
                  <p className="text-[#555] font-mono text-[9px] uppercase tracking-wider">
                    Support: PNG // JPG // WEBP // BMP (Multi-Select)
                  </p>
                </div>
              </section>
            </div>

            {/* Right Column (1): Active Job Queue Timeline */}
            <div className="space-y-6">
              <div className="p-4 border-b border-[#1c1c1c] bg-[#0c0c0c] flex items-center justify-between rounded-t">
                <span className="font-mono text-xs text-cyan-400 uppercase tracking-widest font-bold">
                  Pipeline Monitor ({activeJobs.length})
                </span>
                <span className="w-2 h-2 bg-cyan-500 rounded-full animate-ping" />
              </div>

              <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                <AnimatePresence initial={false}>
                  {activeJobs.length === 0 ? (
                    <div className="p-8 border border-dashed border-[#1c1c1c] text-center text-xs text-[#555] font-mono uppercase">
                      No Active Pipelines
                      <span className="block text-[9px] text-[#444] mt-2 leading-relaxed">
                        Uploaded pages processing automatically under RTX synthetics will display here.
                      </span>
                    </div>
                  ) : (
                    activeJobs.map((file) => (
                      <div 
                        key={file.id} 
                        className="p-4 bg-[#0a0a0a] border border-[#1c1c1c] rounded relative overflow-hidden group shadow"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-mono text-xs truncate max-w-[120px] font-bold text-white uppercase tracking-wider">
                            {file.filename}
                          </span>
                          <span className="text-[8px] font-mono font-bold bg-[#111] px-2 py-0.5 border border-[#222] uppercase tracking-wider text-cyan-400">
                            {file.status}
                          </span>
                        </div>
                        <p className="text-[10px] text-[#666] font-mono mb-3 uppercase tracking-tighter">
                          {file.message || "Synthesis initial logic..."}
                        </p>

                        {/* Progress bar */}
                        <div className="h-1 bg-[#111] w-full rounded overflow-hidden">
                          <motion.div 
                            className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.8)]"
                            initial={{ width: 0 }}
                            animate={{ width: `${file.progress}%` }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          {/* Grid of full file inspect items in progress */}
          {files.filter(f => f.status === 'awaiting_review' || ['failed', 'error'].includes(f.status)).length > 0 && (
            <div className="space-y-6 pt-6">
              <span className="font-mono text-xs text-[#555] uppercase tracking-widest font-black block border-b border-[#1c1c1c] pb-3">
                Action Items Awaiting Intervention
              </span>
              <div className="grid grid-cols-1 gap-8">
                {files
                  .filter(f => f.status === 'awaiting_review' || ['failed', 'error'].includes(f.status))
                  .map(file => (
                    <MangaFileItem 
                      key={file.id} 
                      item={file} 
                      onUpdate={handleUpdate} 
                      onRemove={handleRemove} 
                    />
                  ))
                }
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
}
