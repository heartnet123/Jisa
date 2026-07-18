'use client';

import React, { useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Icon } from '@iconify-icon/react';
import { motion } from 'framer-motion';
import { useMangaTranslator, ALLOWED_IMAGE_TYPES } from '@/features/manga-translator/context/MangaTranslatorContext';
import { MangaFileItem } from '@/features/manga-translator/components/MangaFileItem';

export default function ProjectWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const {
    files,
    projects,
    isDragging,
    setIsDragging,
    isUploading,
    uploadBatch,
    handleUpdate,
    handleRemove,
    handleMovePage,
    handleRenameProject,
    handleDeleteProject
  } = useMangaTranslator();

  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState('');

  const cn = (...inputs: (string | boolean | undefined)[]) => inputs.filter(Boolean).join(" ");

  const activeProj = projects.find(p => p.id === projectId);

  const onDelete = async (id: string) => {
    await handleDeleteProject(id);
    router.push('/projects');
  };

  if (!activeProj) {
    return (
      <div className="bg-[#0b0b0b] border border-[#1c1c1c] rounded-lg p-16 flex flex-col items-center justify-center text-center space-y-4">
        <Icon icon="eos-icons:loading" className="text-3xl text-cyan-500 animate-spin" />
        <p className="text-[#555] font-mono text-xs uppercase tracking-widest mt-1">
          Hydrating chapter session workspace...
        </p>
      </div>
    );
  }

  let activeProjJobs = files.filter(f => f.project_id === projectId);
  
  // Sort activeProjJobs by the order defined in activeProj.page_order
  if (activeProj.page_order && activeProj.page_order.length > 0) {
    activeProjJobs = [...activeProjJobs].sort((a, b) => {
      const idxA = activeProj.page_order.indexOf(a.id);
      const idxB = activeProj.page_order.indexOf(b.id);
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }

  const completedCount = activeProjJobs.filter(f => f.status === 'completed').length;
  const processingCount = activeProjJobs.filter(f => ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting', 'uploading'].includes(f.status)).length;
  const failedCount = activeProjJobs.filter(f => ['failed', 'error'].includes(f.status)).length;
  const awaitingReviewCount = activeProjJobs.filter(f => f.status === 'awaiting_review').length;
  
  // Group jobs with their original sorted index
  const indexedJobs = activeProjJobs.map((file, index) => ({ file, index }));
  
  const needsAttention = indexedJobs.filter(item => 
    ['awaiting_review', 'failed', 'error', 'canceled'].includes(item.file.status)
  );
  const inPipeline = indexedJobs.filter(item => 
    ['queued', 'segmenting', 'ocr', 'translating', 'inpainting', 'typesetting', 'uploading'].includes(item.file.status)
  );
  const finalized = indexedJobs.filter(item => 
    item.file.status === 'completed'
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-6 w-full pb-12"
    >
      {/* Project Header Stats */}
      <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg flex flex-wrap justify-between items-center gap-4">
        <div className="space-y-1">
          {isEditingProjectName ? (
            <form 
              onSubmit={(e) => {
                e.preventDefault();
                handleRenameProject(activeProj.id, editingProjectName);
                setIsEditingProjectName(false);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={editingProjectName}
                onChange={(e) => setEditingProjectName(e.target.value)}
                className="text-xs font-mono px-2 py-1.5 border border-cyan-500 bg-[#121212] rounded text-white focus:outline-none uppercase"
                autoFocus
              />
              <button
                type="submit"
                className="p-1.5 bg-cyan-500 hover:bg-cyan-400 text-black rounded flex items-center justify-center cursor-pointer transition-colors"
                title="Save Name"
              >
                <Icon icon="mdi:check" className="text-xs font-bold" />
              </button>
              <button
                type="button"
                onClick={() => setIsEditingProjectName(false)}
                className="p-1.5 border border-[#333] hover:border-red-500 hover:text-red-500 rounded flex items-center justify-center cursor-pointer transition-colors"
                title="Cancel"
              >
                <Icon icon="mdi:close" className="text-xs" />
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 group/title">
              <h3 className="text-base font-black tracking-tight text-white uppercase font-mono">
                {activeProj.name}
              </h3>
              <button
                onClick={() => {
                  setEditingProjectName(activeProj.name);
                  setIsEditingProjectName(true);
                }}
                className="opacity-0 group-hover/title:opacity-100 p-1 text-[#666] hover:text-cyan-400 rounded transition-all cursor-pointer"
                title="Rename Session"
              >
                <Icon icon="mdi:pencil-outline" className="text-xs" />
              </button>
            </div>
          )}
          <p className="text-[9px] text-[#555] font-mono uppercase tracking-widest">
            ID: {projectId} {"//"} Created: {new Date(activeProj.created_at).toLocaleString()}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex gap-2 font-mono text-[10px]">
            <div className="bg-[#111] border border-[#222] px-3 py-2 rounded">
              <span className="text-[#555] uppercase block text-[8px] font-bold">Processed</span>
              <span className="text-green-400 font-bold text-sm">{completedCount}</span>
              <span className="text-[#444] text-[9px]"> / {activeProjJobs.length} pages</span>
            </div>
            <div className="bg-[#111] border border-[#222] px-3 py-2 rounded">
              <span className="text-[#555] uppercase block text-[8px] font-bold">In Progress</span>
              <span className="text-cyan-400 font-bold text-sm">{processingCount}</span>
              <span className="text-[#444] text-[9px]"> active</span>
            </div>
            {(failedCount > 0 || awaitingReviewCount > 0) && (
              <div className="bg-[#111] border border-[#222] px-3 py-2 rounded">
                <span className="text-[#555] uppercase block text-[8px] font-bold">Attention</span>
                <span className="text-yellow-500 font-bold text-sm">{failedCount + awaitingReviewCount}</span>
                <span className="text-[#444] text-[9px]"> items</span>
              </div>
            )}
          </div>

          <button
            onClick={() => onDelete(activeProj.id)}
            className="px-3 py-2 border border-[#222] hover:border-red-500/50 hover:text-red-500 hover:bg-red-500/5 transition-all text-[9px] font-mono uppercase tracking-widest rounded flex items-center gap-1 cursor-pointer"
            title="Delete Project Session"
          >
            <Icon icon="mdi:delete-outline" className="text-xs" />
            Delete
          </button>
        </div>
      </div>

      {/* Drag and Drop Uploader Scoped to Project */}
      <div className="bg-[#0b0b0b] border border-[#1c1c1c] p-6 rounded-lg space-y-4">
        <span className="font-mono text-xs text-[#666] uppercase tracking-widest font-bold block">
          Project Batch Ingestion
        </span>
        <div
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
              ALLOWED_IMAGE_TYPES.includes(file.type)
            );
            uploadBatch(droppedFiles, projectId);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
          }}
          onClick={() => {
            const input = document.createElement('input');
            input.type = 'file';
            input.multiple = true;
            input.accept = ALLOWED_IMAGE_TYPES.join(',');
            input.onchange = (e) => {
              const fileList = Array.from((e.target as HTMLInputElement).files || []);
              uploadBatch(fileList, projectId);
            };
            input.click();
          }}
          className={cn(
            "relative group cursor-pointer border border-dashed rounded-lg transition-all duration-500 flex flex-col items-center justify-center p-12",
            isDragging ? "border-cyan-500 bg-cyan-500/5 shadow-[0_0_20px_rgba(6,182,212,0.1)]" : "border-[#222] hover:border-cyan-500/30 bg-[#0a0a0a]",
            isUploading && "animate-pulse cursor-wait"
          )}
        >
          <div className="relative z-10 text-center">
            <Icon 
              icon={isUploading ? "eos-icons:loading" : "mdi:cloud-upload-outline"}
              className={cn("text-3xl text-[#444] mx-auto mb-2 group-hover:text-cyan-400 transition-colors", isUploading && "animate-pulse")}
            />
            <h4 className="text-xs font-bold uppercase tracking-tight text-white mb-1 font-mono">
              {isUploading ? "Uploading Batch..." : "Drop images to upload to this project"}
            </h4>
            <p className="text-[#555] font-mono text-[8px] uppercase tracking-wider">
              Click or drag files to add page sheets
            </p>
          </div>
        </div>
      </div>

      {/* Project Page Jobs */}
      <div className="space-y-8">
        <div className="border-b border-[#1c1c1c] pb-3 flex justify-between items-center">
          <span className="font-mono text-xs text-[#555] uppercase tracking-widest font-black block">
            Session Sheet Catalogue ({activeProjJobs.length})
          </span>
          <span className="text-[9px] text-[#444] font-mono uppercase tracking-widest">
            Stable page ordered session
          </span>
        </div>
        
        {activeProjJobs.length === 0 ? (
          <div className="p-8 border border-dashed border-[#1c1c1c] text-center text-xs text-[#555] font-mono uppercase bg-[#080808]">
            No sheets in session
            <span className="block text-[9px] text-[#444] mt-2 leading-relaxed">
              Upload page images above to begin translation pipeline orchestration.
            </span>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 1. Needs Attention Group */}
            {needsAttention.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-yellow-500/90 font-mono text-[10px] uppercase tracking-widest font-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
                  Needs Attention ({needsAttention.length})
                </div>
                <div className="grid grid-cols-1 gap-4 pl-4 border-l border-yellow-950/40">
                  {needsAttention.map(({ file, index }) => (
                    <div key={file.id} className="flex items-start gap-4 group">
                      <div className="flex flex-col items-center justify-center bg-[#0d0d0d] border border-[#1a1a1a] rounded p-2 min-w-[70px] h-24 shrink-0">
                        <span className="text-[8px] font-mono text-[#555] uppercase tracking-wider font-bold">PAGE</span>
                        <span className="text-base font-black font-mono text-cyan-400">#{index + 1}</span>
                        <div className="flex gap-1 mt-2">
                          <button 
                            disabled={index === 0}
                            onClick={() => handleMovePage(projectId, file.id, 'up')}
                            className="p-1 border border-[#222] bg-[#111] hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-20 disabled:hover:border-[#222] disabled:hover:text-inherit rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Move Page Up"
                          >
                            <Icon icon="mdi:arrow-up" className="text-xs" />
                          </button>
                          <button 
                            disabled={index === activeProjJobs.length - 1}
                            onClick={() => handleMovePage(projectId, file.id, 'down')}
                            className="p-1 border border-[#222] bg-[#111] hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-20 disabled:hover:border-[#222] disabled:hover:text-inherit rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Move Page Down"
                          >
                            <Icon icon="mdi:arrow-down" className="text-xs" />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <MangaFileItem 
                          item={file} 
                          onUpdate={handleUpdate} 
                          onRemove={handleRemove} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 2. In Pipeline Group */}
            {inPipeline.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-cyan-500/90 font-mono text-[10px] uppercase tracking-widest font-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-500 animate-pulse" />
                  In Pipeline ({inPipeline.length})
                </div>
                <div className="grid grid-cols-1 gap-4 pl-4 border-l border-cyan-950/30">
                  {inPipeline.map(({ file, index }) => (
                    <div key={file.id} className="flex items-start gap-4 group">
                      <div className="flex flex-col items-center justify-center bg-[#0d0d0d] border border-[#1a1a1a] rounded p-2 min-w-[70px] h-24 shrink-0">
                        <span className="text-[8px] font-mono text-[#555] uppercase tracking-wider font-bold">PAGE</span>
                        <span className="text-base font-black font-mono text-cyan-400">#{index + 1}</span>
                        <div className="flex gap-1 mt-2">
                          <button 
                            disabled={index === 0}
                            onClick={() => handleMovePage(projectId, file.id, 'up')}
                            className="p-1 border border-[#222] bg-[#111] hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-20 disabled:hover:border-[#222] disabled:hover:text-inherit rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Move Page Up"
                          >
                            <Icon icon="mdi:arrow-up" className="text-xs" />
                          </button>
                          <button 
                            disabled={index === activeProjJobs.length - 1}
                            onClick={() => handleMovePage(projectId, file.id, 'down')}
                            className="p-1 border border-[#222] bg-[#111] hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-20 disabled:hover:border-[#222] disabled:hover:text-inherit rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Move Page Down"
                          >
                            <Icon icon="mdi:arrow-down" className="text-xs" />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <MangaFileItem 
                          item={file} 
                          onUpdate={handleUpdate} 
                          onRemove={handleRemove} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. Completed Group */}
            {finalized.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-green-500/90 font-mono text-[10px] uppercase tracking-widest font-black">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  Finalized Publication Sheets ({finalized.length})
                </div>
                <div className="grid grid-cols-1 gap-4 pl-4 border-l border-green-950/30">
                  {finalized.map(({ file, index }) => (
                    <div key={file.id} className="flex items-start gap-4 group">
                      <div className="flex flex-col items-center justify-center bg-[#0d0d0d] border border-[#1a1a1a] rounded p-2 min-w-[70px] h-24 shrink-0">
                        <span className="text-[8px] font-mono text-[#555] uppercase tracking-wider font-bold">PAGE</span>
                        <span className="text-base font-black font-mono text-cyan-400">#{index + 1}</span>
                        <div className="flex gap-1 mt-2">
                          <button 
                            disabled={index === 0}
                            onClick={() => handleMovePage(projectId, file.id, 'up')}
                            className="p-1 border border-[#222] bg-[#111] hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-20 disabled:hover:border-[#222] disabled:hover:text-inherit rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Move Page Up"
                          >
                            <Icon icon="mdi:arrow-up" className="text-xs" />
                          </button>
                          <button 
                            disabled={index === activeProjJobs.length - 1}
                            onClick={() => handleMovePage(projectId, file.id, 'down')}
                            className="p-1 border border-[#222] bg-[#111] hover:border-cyan-500/30 hover:text-cyan-400 disabled:opacity-20 disabled:hover:border-[#222] disabled:hover:text-inherit rounded flex items-center justify-center transition-colors cursor-pointer"
                            title="Move Page Down"
                          >
                            <Icon icon="mdi:arrow-down" className="text-xs" />
                          </button>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <MangaFileItem 
                          item={file} 
                          onUpdate={handleUpdate} 
                          onRemove={handleRemove} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
