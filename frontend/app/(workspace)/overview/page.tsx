'use client';

import React from 'react';
import { Icon } from '@iconify-icon/react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { useMangaTranslator } from '@/features/manga-translator/context/MangaTranslatorContext';

export default function OverviewPage() {
  const {
    files,
    projects,
    setActiveHITLItem,
    healthLoading,
    loadInitialData
  } = useMangaTranslator();

  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  const totalUploaded = files.length;
  const activeJobs = files.filter(f => 
    ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting', 'uploading'].includes(f.status)
  );
  const completedJobsCount = files.filter(f => f.status === 'completed').length;
  const awaitingReviewCount = files.filter(f => f.status === 'awaiting_review').length;
  const successRate = totalUploaded > 0 
    ? Math.round((completedJobsCount / totalUploaded) * 100) 
    : 100;

  const reviewPendingJobs = files.filter(f => f.status === 'awaiting_review');

  return (
    <>
      <header className="px-8 py-6 border-b border-[#1c1c1c] bg-[#0b0b0b]/40 flex justify-between items-center z-10 font-mono">
        <div>
          <h2 className="text-lg font-black tracking-tight uppercase text-main flex items-center gap-2 font-mono">
            <span className="w-2.5 h-2.5 bg-accent rounded-sm"></span> Dashboard
          </h2>
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
            <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-4 rounded relative overflow-hidden group hover:border-green-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-5xl text-green-500 font-black">
                <Icon icon="mdi:checkbox-marked-circle-outline" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Finalized Publications
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black font-mono text-green-400 group-hover:scale-105 transition-transform duration-300">
                  {completedJobsCount}
                </span>
                <span className="text-[10px] text-[#444] font-mono">pages</span>
              </div>
            </div>

            {/* Stat Card 2: Active */}
            <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-4 rounded relative overflow-hidden group hover:border-cyan-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-5xl text-cyan-500 font-black">
                <Icon icon="eos-icons:loading" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Active Pipelines
              </span>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-2xl font-black font-mono group-hover:scale-105 transition-transform duration-300",
                  activeJobs.length > 0 ? "text-cyan-400" : "text-[#777]"
                )}>
                  {activeJobs.length}
                </span>
                <span className="text-[10px] text-[#444] font-mono">running</span>
              </div>
            </div>

            {/* Stat Card 3: Awaiting HITL */}
            <div className={cn(
              "border p-4 rounded relative overflow-hidden group transition-all duration-300 bg-[#0b0b0b] border-[#1c1c1c]",
              awaitingReviewCount > 0 && "bg-yellow-950/15 border-yellow-500/35 hover:border-yellow-400/50 shadow-[0_0_15px_rgba(234,179,8,0.03)]"
            )}>
              <div className="absolute top-0 right-0 p-3 opacity-[0.04] text-5xl text-yellow-500 font-black">
                <Icon icon="mdi:translate" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Review Pending
              </span>
              <div className="flex items-baseline gap-2">
                <span className={cn(
                  "text-2xl font-black font-mono group-hover:scale-105 transition-transform duration-300",
                  awaitingReviewCount > 0 ? "text-yellow-400 animate-pulse" : "text-[#777]"
                )}>
                  {awaitingReviewCount}
                </span>
                <span className="text-[10px] text-[#444] font-mono">pending</span>
              </div>
            </div>

            {/* Stat Card 4: Success Rate */}
            <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-4 rounded relative overflow-hidden group hover:border-purple-500/20 transition-all duration-300">
              <div className="absolute top-0 right-0 p-3 opacity-[0.03] text-5xl text-purple-500 font-black">
                <Icon icon="mdi:percent" />
              </div>
              <span className="text-[9px] font-mono text-[#555] uppercase tracking-widest font-black block mb-2">
                Success Rate
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black font-mono text-[#d946ef] group-hover:scale-105 transition-transform duration-300">
                  {successRate}%
                </span>
              </div>
            </div>
          </div>

          {/* Redesigned Dashboard Split-Panel Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            
            {/* LEFT 3 COLS: Awaiting Review Action Center */}
            <div className="lg:col-span-3 space-y-4">
              <div className="border-b border-[#1c1c1c] pb-2 flex justify-between items-center font-mono">
                <h3 className="text-xs font-black uppercase text-[#aaa] tracking-wider flex items-center gap-2">
                  <Icon icon="mdi:alert-circle" className="text-yellow-500 text-base" />
                  งานค้างรอการรีวิว (Awaiting Review Center)
                </h3>
                <span className="text-[9px] bg-yellow-950 text-yellow-400 px-2 py-0.5 rounded border border-yellow-500/25">
                  {reviewPendingJobs.length} หน้าค้าง
                </span>
              </div>

              {reviewPendingJobs.length === 0 ? (
                <div className="p-12 border border-dashed border-[#1c1c1c] rounded-lg bg-[#0b0b0b]/40 text-center text-xs text-[#555] font-mono uppercase">
                  ไม่มีงานค้างรีวิวในระบบในขณะนี้
                </div>
              ) : (
                <div className="space-y-3 max-h-[480px] overflow-y-auto pr-2 custom-scroll">
                  {reviewPendingJobs.map((file) => {
                    const project = projects.find(p => p.id === file.project_id);
                    return (
                      <div key={file.id} className="p-4 bg-[#0b0b0b] border border-[#1c1c1c] hover:border-yellow-500/30 rounded flex justify-between items-center transition-all group">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-14 bg-black border border-[#222] rounded overflow-hidden shrink-0 flex items-center justify-center relative">
                            {file.originalUrl ? (
                              <img src={file.originalUrl} alt="" className="w-full h-full object-cover grayscale-[0.2] group-hover:grayscale-0 transition-all" />
                            ) : (
                              <Icon icon="mdi:file-image" className="text-lg text-[#333]" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-xs uppercase text-white block truncate" title={file.filename}>
                              {file.filename}
                            </span>
                            <span className="text-[9px] font-mono text-yellow-500 uppercase tracking-widest block truncate">
                              Project: {project ? project.name : 'Unassigned'}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => setActiveHITLItem(file)}
                          className="px-3 py-1.5 bg-yellow-500 hover:bg-yellow-400 text-black font-bold font-mono text-[10px] uppercase rounded transition-all shrink-0 cursor-pointer"
                        >
                          REVIEW
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* RIGHT 2 COLS: Active Projects Progress List */}
            <div className="lg:col-span-2 space-y-4">
              <div className="border-b border-[#1c1c1c] pb-2 font-mono">
                <h3 className="text-xs font-black uppercase text-[#aaa] tracking-wider">
                  โปรเจกต์มังงะคืบหน้า (Active Projects)
                </h3>
              </div>

              {projects.length === 0 ? (
                <div className="p-12 border border-dashed border-[#1c1c1c] rounded-lg bg-[#0b0b0b]/40 text-center text-xs text-[#555] font-mono uppercase">
                  ไม่มีโปรเจกต์ที่กำลังดำเนินการ
                </div>
              ) : (
                <div className="space-y-4 max-h-[480px] overflow-y-auto pr-2 custom-scroll">
                  {projects.map((proj) => {
                    const projJobs = files.filter(f => f.project_id === proj.id);
                    const pagesCompleted = projJobs.filter(f => f.status === 'completed').length;
                    const progress = projJobs.length > 0 ? Math.round((pagesCompleted / projJobs.length) * 100) : 0;

                    return (
                      <div key={proj.id} className="p-4 bg-[#0b0b0b] border border-[#1c1c1c] rounded space-y-3 hover:border-cyan-500/20 transition-colors">
                        <div className="flex justify-between items-center gap-2">
                          <span className="font-bold text-xs text-white uppercase truncate block">
                            {proj.name}
                          </span>
                          <span className="text-[9px] font-mono text-cyan-400 shrink-0 font-bold">
                            {progress}% ({pagesCompleted}/{projJobs.length} หน้า)
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-[#151515] rounded-full overflow-hidden">
                          <div 
                            className="bg-cyan-500/60 shadow-[0_0_8px_rgba(6,182,212,0.4)] h-full transition-all duration-500" 
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex justify-end pt-1">
                          <Link 
                            href={`/projects/${proj.id}`}
                            className="flex items-center gap-1 text-[9px] font-mono text-cyan-400 hover:text-cyan-300 uppercase tracking-wider"
                          >
                            ENTER WORKSPACE <Icon icon="mdi:arrow-right-thin" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

          </div>
        </motion.div>
      </div>
    </>
  );
}
